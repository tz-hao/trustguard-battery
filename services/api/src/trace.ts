import type { Asset } from './types.js';
import type { AuthenticatedActor } from './types.js';
import { Database } from './database.js';
import { FabricService } from './gateway.js';

export interface AssemblyEdge { id: string; parentId: string; childId: string; activeFrom: string; activeTo: string | null; revision: number; txId: string }
export function affectedPacks(cells: Asset[], assets: Asset[], edges: AssemblyEdge[], history: boolean) {
  const byId = new Map(assets.map(a => [a.id,a]));
  const parents = new Map<string, AssemblyEdge[]>();
  for (const edge of edges) {
    if (!history && edge.activeTo !== null) continue;
    const list = parents.get(edge.childId) ?? []; list.push(edge); parents.set(edge.childId,list);
  }
  const paths: { cellId: string; moduleId: string; packId: string; edgeIds: string[]; historical: boolean }[] = [];
  for (const cell of cells) for (const moduleEdge of parents.get(cell.id) ?? []) {
    if (byId.get(moduleEdge.parentId)?.type !== 'MODULE') continue;
    for (const packEdge of parents.get(moduleEdge.parentId) ?? []) {
      if (byId.get(packEdge.parentId)?.type !== 'PACK') continue;
      const from = Math.max(Date.parse(moduleEdge.activeFrom),Date.parse(packEdge.activeFrom));
      const to = Math.min(moduleEdge.activeTo === null ? Infinity : Date.parse(moduleEdge.activeTo),packEdge.activeTo === null ? Infinity : Date.parse(packEdge.activeTo));
      if (from > to) continue;
      paths.push({cellId:cell.id,moduleId:moduleEdge.parentId,packId:packEdge.parentId,edgeIds:[moduleEdge.id,packEdge.id],historical:moduleEdge.activeTo!==null||packEdge.activeTo!==null});
    }
  }
  paths.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  return { packIds:[...new Set(paths.map(p=>p.packId))].sort(),paths };
}

export class TraceService {
  constructor(private readonly db: Database,private readonly fabric: FabricService,private readonly channel: string) {}
  async batch(actor: AuthenticatedActor,batchId: string) {
    const indexed = await this.db.pool.query<{body:Asset}>('SELECT body FROM asset_index');
    const assets = indexed.rows.map(r=>r.body);
    const cells = assets.filter(a=>a.type==='CELL'&&a.batchId===batchId);
    const edgeRows = await this.db.pool.query<{body:AssemblyEdge}>("SELECT body FROM state_index WHERE state_key LIKE 'edge:%'");
    const edges = edgeRows.rows.map(r=>r.body);
    const current = affectedPacks(cells,assets,edges,false), historical = affectedPacks(cells,assets,edges,true);
    const packs = [];
    for (const id of historical.packIds) packs.push(await this.fabric.query<Asset>(actor.identity,'asset',id));
    const cursor = await this.db.pool.query<{next_block:string;updated_at:Date}>('SELECT next_block,updated_at FROM index_cursors WHERE channel=$1',[this.channel]);
    const ledgerHeight = await this.fabric.height(actor.identity);
    const next = BigInt(cursor.rows[0]?.next_block??'0');
    return {batchId,current,historical,packs,source:'FABRIC_REBUILDABLE_INDEX',indexedBlock:next>0n?(next-1n).toString():null,
      ledgerHeight:ledgerHeight.toString(),stale:next<ledgerHeight,updatedAt:cursor.rows[0]?.updated_at??null};
  }
}

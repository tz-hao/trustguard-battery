import { HttpException } from '@nestjs/common';
import type { AuthenticatedActor,ClientIdentity } from './types.js';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { InternalClient } from './internal-client.js';
import { canonicalJson, sha256 } from './config.js';

export class RiskService {
  constructor(private readonly db: Database, private readonly fabric: FabricService, private readonly internal: InternalClient,private readonly identities:ClientIdentity[]=[] ) {}
  async assertAvailable(){
    try{
      const result=await this.internal.post<{ready:boolean}>(process.env.TRUSTGUARD_RISK_URL??'https://localhost:18000','/readiness',{});
      if(!result.ready)throw new Error('RISK_UNAVAILABLE');
    }catch{throw new HttpException({code:'RISK_UNAVAILABLE',message:'风控不可用，自动放行已暂停'},503);}
  }
  async forRelease(actor: AuthenticatedActor, releaseId: string, packId: string) {
    const snapshot = await this.fabric.query<{ hash: string; assets: { id: string; type: string }[] }>(actor.identity, 'snapshot', packId);
    const policy = await this.fabric.query<{ version: number; maxRiskSeconds: number }>(actor.identity, 'policy');
    const cellIds = snapshot.assets.filter(a => a.type === 'CELL').map(a => a.id);
    const { rows } = await this.db.pool.query<{ body: Record<string, unknown> }>(`SELECT DISTINCT ON (asset_id) body FROM measurements
      WHERE asset_id=ANY($1::text[]) ORDER BY asset_id,created_at DESC`, [cellIds]);
    const base = process.env.TRUSTGUARD_RISK_URL ?? 'https://localhost:18000';
    try {
      const quality = rows.length ? await this.internal.post<{ results: { reviewRequired: boolean }[] }>(base, '/quality/analyze', { measurements: rows.map(row => row.body) }) : { results: [] };
      const qualityReview = rows.length !== cellIds.length || quality.results.some(row => row.reviewRequired);
      const history = await this.db.pool.query<{actor_hash:string;command:{action:string;data:Record<string,unknown>};stage:string;created_at:Date}>(`SELECT actor_hash,command,stage,created_at
        FROM transaction_requests WHERE created_at>now()-interval '5 minutes' ORDER BY created_at LIMIT 5000`);
      const ids=history.rows.filter(row=>['ApproveRelease','ApprovePolicy','ApproveLifecycleCorrection'].includes(row.command.action)).map(row=>row.command.data.id).filter((id):id is string=>typeof id==='string');
      const parents=ids.length?await this.db.pool.query<{actor_hash:string;command:{data:{id:string}};created_at:Date}>(`SELECT actor_hash,command,created_at FROM transaction_requests WHERE stage='ledger-verified'
        AND command->>'action' IN ('RequestRelease','ProposePolicy','ProposeLifecycleCorrection') AND command->'data'->>'id'=ANY($1::text[])`,[ids]):{rows:[]};
      const owners=new Map(this.identities.map(i=>[sha256(i.mspId+':'+i.clientFingerprint),i.mspId]));
      const requests=new Map(parents.rows.map(row=>[row.command.data.id,row]));
      const results=new Map<string,string>();
      const events=history.rows.flatMap(row=>{
        const org=owners.get(row.actor_hash);if(!org)return [];
        const parent=requests.get(String(row.command.data.id));
        const successful=row.stage==='ledger-verified';
        const previous=results.get(String(row.command.data.assetId));
        const reversal=successful&&row.command.action==='SubmitInspection'&&previous!==undefined&&previous!==row.command.data.result;
        if(successful&&row.command.action==='SubmitInspection')results.set(String(row.command.data.assetId),String(row.command.data.result));
        return [{action:row.command.action,at:row.created_at.toISOString(),actor_msp:org,rejected:['rejected','invalid'].includes(row.stage),report_reversal:reversal,
          target_msp:successful&&parent?owners.get(parent.actor_hash)??null:null,
          approval_latency_seconds:successful&&parent?Math.max(0,Math.floor((row.created_at.valueOf()-parent.created_at.valueOf())/1000)):null}];
      });
      const operations = await this.internal.post<{ reviewRequired: boolean }>(base, '/operations/analyze', {
        as_of: new Date().toISOString(), operations:events,
      });
      const evidenceHash = sha256(canonicalJson({ snapshotHash: snapshot.hash, quality, operations }));
      const attestation = await this.internal.post<Record<string, unknown> & { id: string }>(base, '/attestations', {
        requestId: releaseId, assetId: packId, snapshotHash: snapshot.hash, policyVersion: policy.version,
        quality_review_required: qualityReview, operation_review_required: operations.reviewRequired,
        evidenceHash, ttl_seconds: Math.min(policy.maxRiskSeconds, 300),
      });
      await this.db.pool.query(`INSERT INTO risk_results(id,request_id,asset_id,snapshot_hash,policy_version,body) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [attestation.id, releaseId, packId, snapshot.hash, policy.version, JSON.stringify(attestation)]);
      return attestation;
    } catch {
      throw new HttpException({ code: 'RISK_UNAVAILABLE', message: '风控不可用，自动放行已暂停' }, 503);
    }
  }
}

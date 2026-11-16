import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import {Database} from './database.js';
import {FabricService} from './gateway.js';
import {InternalClient} from './internal-client.js';
import {canonicalJson,sha256} from './config.js';
import type {Asset,AuthenticatedActor} from './types.js';

const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/);
const schema=z.object({requestId:id,sourceId:id,id,assetId:id,measuredAt:z.string().max(30),sohBasisPoints:z.number().int().min(0).max(10000),
  cycleCount:z.number().int().min(0).max(2147483647),simulation:z.boolean(),signature:z.string().max(256)}).strict();

export class HealthService{
  constructor(private readonly db:Database,private readonly fabric:FabricService,private readonly internal:InternalClient){}
  async ingest(actor:AuthenticatedActor,body:unknown){
    if(actor.identity.mspId!=='LabOrgMSP'||actor.identity.role!=='inspector')throw new HttpException({code:'FORBIDDEN'},403);
    const {requestId,...input}=schema.parse(body),payloadHash=sha256(canonicalJson({kind:'health',...input}));
    const replay=await this.db.pool.query('SELECT payload_hash,result FROM import_receipts WHERE actor_hash=$1 AND request_id=$2',[actor.actorHash,requestId]);
    if(replay.rows[0]){if(replay.rows[0].payload_hash!==payloadHash)throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);return replay.rows[0].result;}
    const verified=await this.internal.post<Record<string,unknown>&{sourceHash:string}>(process.env.TRUSTGUARD_RISK_URL??'https://localhost:18000','/ingestion/health',input);
    const asset=await this.fabric.query<Asset>(actor.identity,'asset',input.assetId);
    if(asset.simulation!==input.simulation||Date.parse(input.measuredAt)<Date.parse(asset.manufacturedAt+'T00:00:00Z'))throw new HttpException({code:'HEALTH_ASSET_MISMATCH'},400);
    const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actor.actorHash+':'+requestId]);
      const previous=await client.query('SELECT payload_hash,result FROM import_receipts WHERE actor_hash=$1 AND request_id=$2',[actor.actorHash,requestId]);
      if(previous.rows[0]){if(previous.rows[0].payload_hash!==payloadHash)throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);await client.query('COMMIT');return previous.rows[0].result;}
      const existing=await client.query('SELECT source_hash FROM health_snapshots WHERE id=$1',[input.id]);
      if(existing.rows[0]&&existing.rows[0].source_hash!==verified.sourceHash)throw new HttpException({code:'HEALTH_VERSION_CONFLICT'},409);
      await client.query('INSERT INTO health_snapshots(id,asset_id,measured_at,source_hash,body,signer_msp) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING',
        [input.id,input.assetId,input.measuredAt,verified.sourceHash,JSON.stringify(verified),actor.identity.mspId]);
      const result={requestId,id:input.id,sourceHash:verified.sourceHash,stored:true,ledgerAnchored:false};
      await client.query('INSERT INTO import_receipts(actor_hash,request_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)',[actor.actorHash,requestId,payloadHash,JSON.stringify(result)]);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async latest(actor:AuthenticatedActor,code:string){
    const asset=await this.fabric.query<Asset>(actor.identity,'battery',code);
    const roles=['manufacturer','operator','custodian','inspector','auditor'];
    if(!roles.includes(actor.identity.role)||actor.identity.mspId!==asset.holderMSP&&actor.identity.mspId!=='LabOrgMSP')throw new HttpException({code:'FORBIDDEN'},403);
    const {rows}=await this.db.pool.query<{body:{sohBasisPoints:number;cycleCount:number;measuredAt:string;sourceHash:string;simulation:boolean}}>('SELECT body FROM health_snapshots WHERE asset_id=$1 ORDER BY measured_at DESC,id DESC LIMIT 1',[asset.id]);
    const snapshot=rows[0]?.body;
    return {designLifeMonths:asset.designLifeMonths,sohPct:snapshot?snapshot.sohBasisPoints/100:null,sohBasisPoints:snapshot?.sohBasisPoints??null,
      cycleCount:snapshot?.cycleCount??null,measuredAt:snapshot?.measuredAt??null,sourceHash:snapshot?.sourceHash??null,
      simulation:asset.simulation,remainingLifeEstimate:null,plannedScrapAt:null,remainingLifeUnavailableReason:'NO_VALIDATED_LIFETIME_MODEL',
      source:snapshot?'AUTHORIZED_SIGNED_HEALTH_SNAPSHOT':null,asOf:new Date().toISOString()};
  }
}

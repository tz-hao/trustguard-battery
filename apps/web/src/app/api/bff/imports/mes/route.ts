import {NextResponse} from 'next/server';
import {sign} from 'node:crypto';
import {callBackendApi,canonicalJson,getActorPrivateKeyPem} from '@/lib/server/api-client';
import {getSessionActor,verifyCsrf,jsonRelay} from '@/lib/server/session';

export async function POST(request:Request) {
  const denied=verifyCsrf(request); if(denied)return denied;
  const body=await request.json().catch(()=>null);
  if(!body || typeof body.requestId!=='string' || !Array.isArray(body.records) || body.records.length>100 || body.simulation!==true || body.source!=='MES_SIM')
    return NextResponse.json({code:'INVALID_MES_FILE'},{status:400});
  const {requestId,...data}=body;
  const {name}=await getSessionActor();
  const manifest={requestId,data};
  const signature=sign('sha256',Buffer.from(canonicalJson(manifest)),getActorPrivateKeyPem(name)).toString('base64');
  return jsonRelay(await callBackendApi(name,'POST','/imports/mes',{...manifest,signature}));
}

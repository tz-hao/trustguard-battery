import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalJson} from './config.js';
import {verifyMesFile} from './mes.js';

test('MES production file binds source, request identity, row order and values',()=>{
  const signer=generateKeyPairSync('ec',{namedCurve:'P-256'});
  const {requestId,...data}=JSON.parse(readFileSync(new URL('../../../apps/web/public/examples/mes-production.json',import.meta.url),'utf8'));
  const manifest={requestId,data};
  const signature=sign('sha256',Buffer.from(canonicalJson(manifest)),signer.privateKey).toString('base64');
  assert.deepEqual(verifyMesFile({...manifest,signature},signer.publicKey),manifest);
  for (const changed of [{...manifest,requestId:'another'}, {...manifest,data:{...data,records:[...data.records].reverse()}},
    {...manifest,data:{...data,simulation:false}}]) assert.throws(()=>verifyMesFile({...changed,signature},signer.publicKey));
  const different=generateKeyPairSync('ec',{namedCurve:'P-256'});
  assert.throws(()=>verifyMesFile({...manifest,signature},different.publicKey));
});

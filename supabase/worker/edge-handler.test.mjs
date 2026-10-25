import assert from 'node:assert/strict';
import { test } from 'node:test';
import {createHmac,randomUUID} from 'node:crypto';
import { createResultHandler } from './edge-handler.ts';
const token='b'.repeat(64);
const signed=(time=Math.floor(Date.now()/1000))=>{const nonce=randomUUID();return {'x-polycup-time':String(time),'x-polycup-nonce':nonce,'x-polycup-signature':createHmac('sha256',token).update('polycup-results:v1:'+time+':'+nonce).digest('hex')};};
test('Edge endpoint rejects public keys, user tokens and malformed credentials before connecting',async()=>{
 let connections=0;const connect=async()=>{connections++;throw new Error('private database URL');};
 const h=createResultHandler({POLYCUP_RESULT_CRON_TOKEN:token,POLYCUP_RESULT_WORKER_ENABLED:'1'},connect,()=>{});
 for(const headers of [{},{apikey:'public'},{Authorization:'Bearer user-jwt'},{'x-polycup-cron-token':'bad'},{'x-polycup-cron-token':'a'.repeat(64)},signed(Math.floor(Date.now()/1000)-91),signed(Math.floor(Date.now()/1000)+11),{...signed(),'x-polycup-nonce':randomUUID()}]){
  assert.equal((await h(new Request('https://example.invalid',{method:'POST',headers}))).status,401);
 }
 assert.equal((await h(new Request('https://example.invalid'))).status,405);assert.equal(connections,0);
 const response=await h(new Request('https://example.invalid',{method:'POST',headers:signed()}));
 assert.equal(response.status,503);assert.equal(connections,1);assert.ok(!(await response.text()).includes('private'));
});
test('unconfigured and disabled deployments never open the database',async()=>{
 const connect=async()=>{throw Error('must not connect');};
 for(const env of [{},{POLYCUP_RESULT_CRON_TOKEN:token}]){
  const h=createResultHandler(env,connect);
  assert.equal((await h(new Request('https://example.invalid',{method:'POST',headers:signed()}))).status,503);
 }
});

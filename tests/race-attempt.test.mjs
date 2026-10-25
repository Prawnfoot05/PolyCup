import {test} from 'node:test';
import assert from 'node:assert/strict';
import {duringAttempt} from '../src/race-attempt.ts';
test('cancelled preparation cannot complete a later attempt',async()=>{
 const controller=new AbortController();let finish;
 const old=duringAttempt(new Promise(resolve=>finish=resolve),controller.signal);
 const rejected=assert.rejects(old,/cancelled/);controller.abort();await rejected;
 const next=duringAttempt(Promise.resolve('new'),new AbortController().signal);
 finish('old');assert.equal(await next,'new');
});
test('hung preparation times out and a later rejection is consumed',async()=>{
 let fail;const request=duringAttempt(new Promise((_,reject)=>fail=reject),new AbortController().signal,10);
 await assert.rejects(request,/timed out/);fail(new Error('late loader error'));
 await new Promise(resolve=>setTimeout(resolve,0));
});
test('an already-cancelled attempt never delivers an immediately available track',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(duringAttempt(Promise.resolve('track'),controller.signal),/cancelled/);
});

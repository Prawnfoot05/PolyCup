import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Ranked} from '../src/ranked.ts';
const full=(key='catalog-a')=>({id:'cup',static_key:key,pool:[{id:key,category:'official',digest:'a'.repeat(64)}],rules:{pointsToWin:140},session:{revision:1}});
const slim=(key='catalog-a')=>({id:'cup',static_key:key,session:{revision:2}});
function client(fn){return new Ranked({rpc:(name,args)=>({abortSignal:()=>fn(name,args)})});}
test('catalog is fetched once, reused across Cups, refreshed on content change and protected from mutation',async()=>{
 let n=0;const api=client(async(name,args)=>{assert.equal(name,'polycup_ranked_session_v2');n++;if(n===1){assert.equal(args.known_static_key,null);return {data:full()};}assert.equal(args.known_static_key,'catalog-a');return {data:n===2?slim():full('catalog-b')};});
 const first=await api.session('one','lease','rejoin');first.pool[0].id='mutated';first.rules.pointsToWin=1;
 const next=await api.session('two','lease','poll');assert.equal(next.pool[0].id,'catalog-a');assert.equal(next.rules.pointsToWin,140);
 assert.equal((await api.session('two','lease','poll')).pool[0].id,'catalog-b');
});
test('in-flight response hydrates from the catalog it requested even after another response replaces cache',async()=>{
 let resolve,n=0;const api=client(async()=>{if(++n===1)return {data:full()};if(n===2)return new Promise(r=>resolve=r);return {data:full('catalog-b')};});
 await api.session('one','i','poll');const late=api.session('one','i','poll');await api.session('two','i','poll');resolve({data:slim()});assert.equal((await late).pool[0].id,'catalog-a');
});
test('null does not resurrect a room; only missing-function errors permit legacy action fallback',async()=>{
 const calls=[];const api=client(async(name)=>{calls.push(name);return name.endsWith('_v2')?{error:{code:'PGRST202',message:'missing'}}:{data:null};});
 assert.equal(await api.session('m','i','pick','track'),null);assert.equal(await api.session('m','i','poll'),null);assert.deepEqual(calls,['polycup_ranked_session_v2','polycup_ranked_session','polycup_ranked_session']);
 let n=0;const broken=client(async()=>{n++;return {error:{code:'08006',message:'lost response'}};});await assert.rejects(broken.session('m','i','pick','track'),/lost response/);assert.equal(n,1);
});

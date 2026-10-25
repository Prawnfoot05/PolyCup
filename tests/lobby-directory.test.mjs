import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LobbyDirectory} from '../src/lobby-directory.ts';
const host={cupId:'cup',hostName:'Host',title:'Cup',code:'ABCDEFGH',expires:Date.now()+600000,phase:'waiting',players:3,capacity:8};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const calls=[];let deferred=null;
 const client={rpc(name,args){calls.push({name,args});const promise=deferred&&name==='polycup_list_lobby'?new Promise(resolve=>deferred.resolve=resolve):Promise.resolve({data:[],error:null});return {abortSignal:()=>promise};}};
 const d=new LobbyDirectory(client);d.setUser('signed-in-user');
 return {d,calls,defer(){deferred={};return deferred;}};
}
test('new Cups default public; privacy remains through phase changes',async()=>{
 const {d,calls}=fixture();try{
  d.setContext(host);await tick();assert.equal(d.confirmed,true);assert.equal(calls[0].name,'polycup_list_lobby');
  await d.setPublic(false);assert.equal(d.confirmed,false);
  d.setContext({...host,phase:'drafting'});await tick();assert.equal(d.listed,false);
  d.setContext({...host,cupId:'next'});await tick();assert.equal(d.listed,true);
 }finally{await d.stop();}
});
test('going private during an ambiguous publish still removes the announcement',async()=>{
 const {d,calls,defer}=fixture();const pending=defer();
 d.setContext(host);await tick();const stopped=d.setPublic(false);
 pending.resolve({error:new Error('Lost response')});await stopped;
 assert.equal(calls.at(-1).name,'polycup_unlist_lobby');assert.equal(d.confirmed,false);await d.stop();
});
test('Cup end waits for in-flight publication then unlists it',async()=>{
 const {d,calls,defer}=fixture();const pending=defer();d.setContext(host);await tick();d.setContext(null);
 pending.resolve({error:null});await tick();await d.stop();
 assert.equal(calls.at(-1).name,'polycup_unlist_lobby');assert.equal(d.listed,false);
});
test('anonymous browsing needs no auth session and failed refresh clears stale rows',async()=>{
 let failed=false;const d=new LobbyDirectory({rpc(){return {abortSignal:async()=>failed?{error:{}}:{data:[{title:'Public Cup'}],error:null}};}});
 await d.refresh();assert.equal(d.rows.length,1);failed=true;await d.refresh();assert.equal(d.rows.length,0);assert.equal(d.fresh,false);await d.stop();
});

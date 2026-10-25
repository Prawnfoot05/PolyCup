import test from 'node:test';
import assert from 'node:assert/strict';
import {Friends} from '../src/friends.ts';
const response=data=>({data,error:null});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const client=handler=>({rpc:(name,args)=>({abortSignal:()=>handler(name,args)})});

test('own friend code clears old results and pending searches with a helpful message',async()=>{
 const pending=deferred();let searches=0;
 const f=new Friends(client(name=>{
  if(name==='polycup_find_players'){searches++;return pending.promise;}
  return Promise.resolve(response([]));
 }),()=>{});
 try {
  f.start('abcdef00-0000-4000-8000-000000000001');await f.refresh();
  const previous=f.search('Someone');
  await assert.rejects(f.search('  ABCDEF00-0000-4000-8000-000000000001  '),/You cannot add yourself, silly/);
  pending.resolve(response([{player_id:'stale'}]));await previous;
  assert.equal(searches,1);assert.deepEqual(f.results,[]);assert.equal(f.searching,false);
  await assert.rejects(f.request('abcdef00-0000-4000-8000-000000000001'),/You cannot add yourself, silly/);
 }finally{await f.stop();}
});
test('friend snapshots become unavailable on failure and recover without losing the list',async()=>{
 let failed=false;
 const f=new Friends(client(name=>Promise.resolve(name==='polycup_friends_v2'?(failed?{error:{message:'offline'}}:response([{player_id:'bob',online:true}])):response(null))),()=>{});
 try {
  f.start('alice');await f.refresh();assert.equal(f.fresh,true);assert.equal(f.rows.length,1);
  failed=true;await f.refresh();assert.equal(f.fresh,false);assert.equal(f.rows.length,1);assert.match(f.error,/unavailable/);
  failed=false;await f.refresh();assert.equal(f.fresh,true);assert.equal(f.error,'');
 }finally{await f.stop();}
});
test('sign-out waits for an in-flight heartbeat before removing that session',async()=>{
 const touch=deferred(),events=[];
 const f=new Friends(client(name=>{
  if(name==='polycup_presence_touch'){events.push('touch');return touch.promise;}
  if(name==='polycup_presence_leave')events.push('leave');
  return Promise.resolve(response([]));
 }),()=>{});
 f.start('alice');const same=f.refresh();assert.equal(events.filter(e=>e==='touch').length,1);
 const stopping=f.stop();assert.deepEqual(events,['touch']);
 touch.resolve(response(null));await same;await stopping;
 assert.deepEqual(events,['touch','leave']);assert.deepEqual(f.rows,[]);
});
test('late responses from an old account cannot replace the new account friends',async()=>{
 const old=deferred();let reads=0;
 const f=new Friends(client(name=>{
  if(name==='polycup_friends_v2')return ++reads===1?old.promise:Promise.resolve(response([{player_id:'new-friend'}]));
  return Promise.resolve(response(null));
 }),()=>{});
 try {
  f.start('alice');const previous=f.refresh();f.start('bob');await f.refresh();
  old.resolve(response([{player_id:'old-private-friend'}]));await previous;
  assert.equal(f.rows[0].player_id,'new-friend');
 }finally{await f.stop();}
});
test('a later player search wins even when an older search finishes afterwards',async()=>{
 const first=deferred();
 const f=new Friends(client((name,args)=>{
  if(name==='polycup_find_players')return args.search_text==='first'?first.promise:Promise.resolve(response([{player_id:'latest'}]));
  return Promise.resolve(response([]));
 }),()=>{});
 try {
  f.start('alice');await f.refresh();
  const old=f.search('first');await f.search('second');first.resolve(response([{player_id:'stale'}]));await old;
  assert.equal(f.results[0].player_id,'latest');assert.equal(f.searching,false);
  await assert.rejects(f.search('a'),/at least two/);
 }finally{await f.stop();}
});

test('public game lookup rechecks the backend and old deployments fall back once',async()=>{
 let modern=0,legacy=0,join=0;
 const f=new Friends(client(name=>{
  if(name==='polycup_friends_v2'){modern++;return Promise.resolve({data:null,error:{code:'PGRST202'}});}
  if(name==='polycup_friends'){legacy++;return Promise.resolve(response([{player_id:'bob',online:true}]));}
  if(name==='polycup_friend_game'){join++;return Promise.resolve({data:null,error:{message:'This friend is no longer in a joinable public Cup.'}});}
  return Promise.resolve(response([]));
 }),()=>{});
 try{f.start('alice');await f.refresh();await f.refresh();assert.equal(modern,1);assert.equal(legacy,2);assert.equal(f.rows.length,1);await assert.rejects(f.gameCode('bob'),/no longer/);assert.equal(join,1);}finally{await f.stop();}
});

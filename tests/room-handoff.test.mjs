import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {roomData} from '../src/waiting-room-model.ts';
const bundle=await build({entryPoints:['src/room-handoff.ts'],bundle:true,write:false,format:'esm',platform:'node',loader:{'.svg':'text'}});
const {RoomHandoff}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('leaving and rejoining the same custom room restarts the native handoff',async()=>{
 const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
 try{
  const data=roomData('Finished Cup');data.launch={id:crypto.randomUUID(),stage:'racing',at:Date.now(),code:'TESTCODE'};
  const snapshot={id:data.cup.id,ticket:crypto.randomUUID(),data};
  let changed,connects=0,entered=0,disposed=0,returns=0;
  const room={snapshot,isHost:false,fresh:true,subscribe(fn){changed=fn;return()=>{changed=undefined;};},suspend(){},resume(){changed?.();}};
  const bridge={connect:async()=>{connects++;return {dispose(){disposed++;}};},self:()=>9,peers:()=>[],started:()=>true,entered(){entered++;},returnToMenu(){returns++;}};
  const handoff=new RoomHandoff(room,bridge);
  await handoff.tick();assert.equal(entered,1);
  room.snapshot=null;changed();assert.equal(disposed,1);assert.equal(returns,1);
  assert.ok(changed,'A leave must not remove the listener needed for the next join');
  room.snapshot=snapshot;changed();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(connects,2);assert.equal(entered,2);
  await handoff.tick();assert.equal(entered,2,'one transition per attempt');
  handoff.dispose();assert.equal(changed,undefined);
 }finally{globalThis.setInterval=interval;}
});

test('private room handoff requests a native invite without the invite UI',async()=>{
 const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
 try{
  const data=roomData('Private Cup');data.public=false;
  data.cup.roster=[{id:1,name:'Host'},{id:2,name:'Guest'}];
  data.launch={id:crypto.randomUUID(),stage:'connecting',at:Date.now(),code:''};
  let invite=null,requested=0;
  const connection={getInvite:()=>invite,isInviteAllowed:()=>true,getInviteIsLoading:()=>false,renewInvite(){requested++;invite={inviteCode:'TESTCODE'};}};
  const room={snapshot:{id:data.cup.id,ticket:crypto.randomUUID(),data},isHost:true,fresh:true,subscribe(){},bind:async()=>1,update:async fn=>fn(data)};
  const bridge={prepare:async()=>new Map(),connect:async()=>connection,self:()=>1,peers:()=>[],ready:()=>false};
  const handoff=new RoomHandoff(room,bridge);
  await handoff.tick();assert.equal(requested,1);
  await handoff.tick();assert.equal(data.launch.code,'TESTCODE');
  await handoff.tick();assert.equal(requested,1);
 }finally{globalThis.setInterval=interval;}
});

test('repeated native invitation failures cancel cleanly after bounded retries',async()=>{
 const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
 try{
  const data=roomData('Private Cup');data.cup.roster=[{id:1,name:'Host'},{id:2,name:'Guest'}];
  data.launch={id:crypto.randomUUID(),stage:'connecting',at:Date.now(),code:''};
  let retries=0,returned=0;
  const connection={getInvite:()=>({name:'MultiplayerCreateInviteError'}),isInviteAllowed:()=>true,getInviteIsLoading:()=>false,renewInvite(){retries++;},dispose(){}};
  const room={snapshot:{id:data.cup.id,ticket:crypto.randomUUID(),data},isHost:true,fresh:true,subscribe(){},bind:async()=>1,update:async fn=>fn(data),resume(){}};
  const bridge={prepare:async()=>new Map(),connect:async()=>connection,self:()=>1,peers:()=>[],ready:()=>false,returnToMenu(){returned++;}};
  const handoff=new RoomHandoff(room,bridge);
  await handoff.tick();await handoff.tick();await handoff.tick();
  assert.equal(retries,2);assert.equal(returned,1);assert.equal(data.launch,null);
  assert.match(data.chat.at(-1).text,/Could not create a multiplayer invitation/);
  assert.equal(data.cup.roster.length,2);
 }finally{globalThis.setInterval=interval;}
});

test('a ranked reconnect waits for server binding even if native race state arrives first',async()=>{
 const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
 try{const data=roomData('Ranked');data.launch={id:crypto.randomUUID(),stage:'racing',at:Date.now(),code:'TESTCODE'};let verified=false,entered=0;
 const room={ranked:true,snapshot:{id:data.cup.id,ticket:crypto.randomUUID(),data},isHost:false,fresh:true,subscribe(){},verifiedConnection:()=>verified,suspend(){}};
 const bridge={connect:async()=>({}),self:()=>2,peers:()=>[],started:()=>true,entered(){entered++;}};
 const handoff=new RoomHandoff(room,bridge);await handoff.tick();await handoff.tick();assert.equal(entered,0);verified=true;await handoff.tick();assert.equal(entered,1);
 }finally{globalThis.setInterval=interval;}
});

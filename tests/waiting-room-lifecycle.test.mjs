import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WaitingRoom} from '../.research/test-src/waiting-room.ts';
import {roomData} from '../src/waiting-room-model.ts';
test('terminal room expiry clears the session, while temporary network errors retain it',async()=>{
 const oldWindow=globalThis.window,oldStorage=globalThis.sessionStorage;
 globalThis.window={addEventListener(){}};
 globalThis.sessionStorage={getItem(){return null;},setItem(){},removeItem(){}};
 try {
  for(const message of ['This waiting room is no longer available.','Join this waiting room first.','Failed to fetch']){
   const room=new WaitingRoom({},{}),data=roomData('Expiry test');
   room.snapshot={id:data.cup.id,self:2,host:1,revision:1,data,members:[],events:[],results:[]};
   room.client={rpc(){return {abortSignal(){return Promise.resolve({error:{message,code:'P0001'}});}};}};
   await room.poll();
   assert.equal(room.active,message==='Failed to fetch');
  }
 }finally{globalThis.window=oldWindow;globalThis.sessionStorage=oldStorage;}
});
test('confirmed leave fences old polls; offline leave retains a retryable membership',async()=>{
 const oldWindow=globalThis.window,oldStorage=globalThis.sessionStorage;
 globalThis.window={addEventListener(){}};
 globalThis.sessionStorage={getItem(){return null;},setItem(){},removeItem(){}};
 try {
  for(const offline of [false,true]){
   const room=new WaitingRoom({},{}), data=roomData('Local test');let finishPoll;
   const snapshot={id:data.cup.id,code:'TESTCODE00',host:1,self:2,revision:1,ticket:crypto.randomUUID(),data,members:[],events:[],results:[]};
   room.snapshot=structuredClone(snapshot);
   room.client={rpc(_name,{op}){return {abortSignal(){return op==='leave'?Promise.resolve(offline?{error:{message:'offline'}}:{data:null}):new Promise(resolve=>finishPoll=resolve);}};}};
   const pending=room.poll();
   if(offline)await assert.rejects(room.leave(),/offline/);else await room.leave();
   finishPoll({data:snapshot});await pending;
   assert.equal(room.active,offline);
   if(offline){
    room.client={rpc(){return {abortSignal(){return Promise.resolve({data:null});}};}};
    await room.leave();
   }
   assert.equal(room.snapshot,null);assert.equal(room.active,false);
  }
 } finally {globalThis.window=oldWindow;globalThis.sessionStorage=oldStorage;}
});

test('a lost create response retries the original room instead of creating a conflicting Cup',async()=>{
 const oldWindow=globalThis.window,oldStorage=globalThis.sessionStorage;
 globalThis.window={addEventListener(){}};
 const stored=new Map();globalThis.sessionStorage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 try{
  const calls=[];
  const room=new WaitingRoom({},{});
  room.client={rpc(_name,args){calls.push(args);return {abortSignal(){return Promise.resolve({error:{message:'Failed to fetch'}});}};}};
  await assert.rejects(room.create('First',{name:'Host'}),/Failed to fetch/);
  await assert.rejects(room.create('Retry',{name:'Host'}),/Failed to fetch/);
  assert.equal(calls[0].room_key,calls[1].room_key);
  assert.equal(stored.get('polycup.room.id'),calls[0].room_key);
  room.dismiss();
 }finally{globalThis.window=oldWindow;globalThis.sessionStorage=oldStorage;}
});

test('custom host commits the event reply directly, retries a lost reply with the same ID and applies only once',async()=>{
 const oldWindow=globalThis.window,oldStorage=globalThis.sessionStorage;globalThis.window={addEventListener(){}};globalThis.sessionStorage={getItem(){return null},setItem(){},removeItem(){}};
 try{
  for(const lost of [false,true]){
   const room=new WaitingRoom({}, {list:()=>[]}),data=roomData('Latency');room.refreshRanks=()=>{};
   const value={id:data.cup.id,self:1,host:1,code:'ROOM',revision:1,data,members:[{id:1,name:'Host',online:true}],events:[],results:[]};room.snapshot=structuredClone(value);const calls=[],ids=[];let first=true,commits=0;
   room.client={rpc(_name,{op,args}){calls.push(op);return{abortSignal:async()=>{
    if(op==='event'){ids.push(args.request);value.events=[{seq:1,actor:1,kind:'chat',value:'Hello',request:args.request}];if(lost&&first){first=false;throw Error('Failed to fetch');}return{data:structuredClone(value)};}
    if(op==='commit'){commits++;value.revision++;value.data=args.data;value.events=[];value.results=[{request:ids[0],error:null}];return{data:structuredClone(value)};}
    return{data:structuredClone(value)};
   }};}};
   await room.submit('chat','Hello');assert.equal(commits,1);assert.equal(new Set(ids).size,1);assert.equal(calls.includes('poll'),false);assert.equal(room.state.id,data.cup.id);assert.equal(room.snapshot.data.chat.length,1);room.dismiss();
  }
 }finally{globalThis.window=oldWindow;globalThis.sessionStorage=oldStorage;}
});

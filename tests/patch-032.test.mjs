import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as Cup from '../.research/test-src/cup.ts';
import {Controller} from '../.research/test-src/controller.ts';
import {CupTransport} from '../.research/test-src/native.ts';
import {ReviewLog} from '../.research/test-src/review.ts';

function racer(isHost=false) {
 const c=new Controller(()=>{});c.state=Cup.newCup();
 for(const id of [1,2,3]){Cup.addPlayer(c.state,id,`P${id}`);Cup.chooseTrack(c.state,id,{id:'a'.repeat(64),name:'Track'});}
 Cup.lockRegistration(c.state);Cup.beginRound(c.state);c.state.runtime.sessionId=9;c.state.phase='countdown';Cup.startRace(c.state,0);
 c.selfId=isHost?1:2;c.isHost=isHost;c.connection={};c.game={};c.info={sessionId:9,checkpointCount:3};c.native={};c.now=()=>15000;c.broadcast=()=>{};c.hello.add(2);return c;
}
function finish(c,frames=12000) {
 let callback;c.hookFinish({addCheckpointCallback(){},addFinishCallback(fn){callback=fn;},getTime:()=>({numberOfFrames:frames})},c.state.runtime);callback();
}
test('finish survives a failed send, dropped message and lost acknowledgement without duplicate scoring',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 const guest=racer(),host=racer(true);host.state=structuredClone(guest.state);
 let sends=0,broadcasts=0,acks=0;host.broadcast=()=>broadcasts++;
 host.transport.send=(id,m)=>{assert.equal(id,2);if(++acks>1)guest.receive(0,m);return true;};
 guest.transport.send=(id,m)=>{assert.equal(id,0);assert.equal(m.type,'finish');sends++;if(sends===1)return false;if(sends>2)host.receive(2,m);return true;};
 finish(guest);assert.equal(sends,1);assert.ok(guest.pendingFinish);
 now=100;guest.flushFinish();assert.equal(sends,1);
 for(now of [300,600,900])guest.flushFinish();
 assert.equal(sends,4);assert.equal(host.state.runtime.finishes[2],12000);assert.equal(broadcasts,1);assert.equal(acks,2);assert.equal(guest.pendingFinish,null);
 now=1200;guest.flushFinish();assert.equal(sends,4);
});
test('finish acknowledgement is bound to host, round, session and recorded time',()=>{
 const c=racer();c.transport.send=()=>true;finish(c);const m={...c.pendingFinish,type:'finish-ack'};
 for(const [id,ack] of [[3,m],[0,{...m,roundId:'old'}],[0,{...m,sessionId:8}],[0,{...m,frames:12001}]]){c.receive(id,ack);assert.ok(c.pendingFinish);}
 c.receive(0,m);assert.equal(c.pendingFinish,null);
});
test('a host snapshot acknowledges a finish, and abandoned rounds/connections stop retries',()=>{
 for(const change of [c=>{c.state.runtime.finishes[2]=12000;},c=>{c.state.runtime.id='new';},c=>{c.state.runtime=null;},c=>{c.connection=null;},c=>{c.state.runtime.dnfs.push(2);}]){
  const c=racer();c.transport.send=()=>true;finish(c);change(c);c.flushFinish();assert.equal(c.pendingFinish,null);
 }
});
test('a host does not acknowledge rejected or conflicting finish claims',()=>{
 const c=racer(true),acks=[];c.transport.send=(id,m)=>{acks.push(m);return true;};
 const m={type:'finish',roundId:c.state.runtime.id,sessionId:9,frames:12000,checkpoint:null};
 c.receive(2,{...m,frames:999999});c.receive(2,{...m,frames:undefined});c.receive(2,{...m,roundId:'old'});assert.equal(acks.length,0);
 c.receive(2,m);assert.equal(acks.length,1);c.receive(2,{...m,frames:11000});assert.equal(acks.length,1);assert.equal(c.state.runtime.finishes[2],12000);
});
function channelTest(t,realtime=false) {
 let now=0;t.mock.method(performance,'now',()=>now);const accepted=[];
 const channel={readyState:'open',bufferedAmount:0,send(){},close(){}};
 const transport=new CupTransport((id,m)=>accepted.push(m),()=>{},{realtime});transport.sync([{id:2,pc:{connectionState:'connected',createDataChannel:()=>channel}}]);
 return {accepted,advance:n=>{now=n;},deliver:m=>channel.onmessage({data:typeof m==='string'?m:JSON.stringify({protocol:1,...m})})};
}
test('a backlog of routine messages cannot consume the reserved finish/state allowance',t=>{
 const c=channelTest(t);c.advance(5000);for(let i=0;i<50;i++)c.deliver({type:'inputs',seq:i});
 for(const type of ['finish','finish-ack','state','checkpoint','ready'])c.deliver({type});
 assert.equal(c.accepted.filter(m=>m.type==='inputs').length,35);for(const type of ['finish','finish-ack','state','checkpoint','ready'])assert.ok(c.accepted.some(m=>m.type===type));
 for(let i=0;i<100;i++)c.deliver({type:'finish'});assert.equal(c.accepted.filter(m=>m.type!=='inputs').length,35);
 c.advance(6100);c.deliver({type:'finish'});assert.equal(c.accepted.at(-1).type,'finish');
});
test('malformed messages and camera bursts still have bounded receive work',t=>{
 const c=channelTest(t);for(let i=0;i<106;i++)c.deliver('{');c.deliver({type:'finish'});assert.equal(c.accepted.length,0);
 c.advance(1100);c.deliver({type:'finish'});assert.equal(c.accepted.length,1);
});
test('camera traffic retains its own 60-message limit',t=>{
 const c=channelTest(t,true);for(let i=0;i<80;i++)c.deliver({type:'camera'});assert.equal(c.accepted.length,60);
});
test('review player lookup does not serialize archives and follows identity rebinding',()=>{
 const log=new ReviewLog('cup'),key=log.actor(2);log.data=()=>{throw Error('Rendering must not serialize review data');};
 assert.equal(log.playerIds().get(key),2);log.rebind(2,4);assert.equal(log.playerIds().get(key),4);
});
test('Cup autosave/restore is absent while preset storage remains',()=>{
 const c=new Controller(()=>{});assert.equal(typeof c.save,'undefined');assert.equal(typeof c.saveData,'undefined');assert.equal(typeof c.restore,'undefined');
 for(const file of ['controller.ts','ui.ts','review-ui.ts'])assert.doesNotMatch(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),/pwc-save-v2|Restore autosave|\.save\(/);
 assert.match(readFileSync(new URL('../src/presets.ts',import.meta.url),'utf8'),/setItem/);
});

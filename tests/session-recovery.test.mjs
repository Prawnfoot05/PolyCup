import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../.research/test-src/controller.ts';
import * as Cup from '../.research/test-src/cup.ts';
import { watchGameSessions, connectNative } from '../.research/test-src/native.ts';
import { validSnapshot } from '../.research/test-src/validation.ts';

function room(t) {
  t.mock.timers.enable({apis:['Date'],now:100000});
  const c=new Controller(()=>{});
  class Host { getPlayers(){return c.lobby;} startNewSession(){this.starts=(this.starts??0)+1;} }
  c.connection=new Host();c.isHost=true;c.selfId=1;c.auto=true;
  c.lobby=[1,2,3].map(id=>({id,nickname:`P${id}`,isSelf:id===1}));
  c.hello=new Set([2,3]);c.transport.has=id=>c.lobby.some(p=>p.id===id);
  c.transport.sync=c.transport.broadcast=c.cameraTransport.sync=()=>{};
  c.transport.send=()=>true;c.save=()=>{};
  c.state=Cup.newCup();c.state.roster=c.lobby.map(p=>({id:p.id,name:p.nickname}));
  const id='a'.repeat(64);c.state.tracks=[{id,name:'Track'}];c.state.picks={1:id,2:id,3:id};
  Cup.lockRegistration(c.state);Cup.beginRound(c.state);
  c.state.runtime.sessionId=7;c.state.runtime.ready=[1,2,3];c.state.runtime.startsAt=130000;c.state.phase='warmup';
  c.game={};c.info={connection:c.connection,sessionId:7,disposed:false,spectator:{isEnabled:false},trackData:{getId:()=>id}};
  c.native={Host,read:g=>g.info??c.info,peers:()=>[],reset(){},clearRecords(){}};
  c.tracks.set(id,{trackMetadata:{name:'Track'},trackData:{getId:()=>id}});
  return c;
}

test('session replacement without any rendered frame retains Cup, transport and identity',async t=>{
  const c=room(t),state=c.state,connection=c.connection,old=c.game,info=c.info;
  let closes=0;c.transport.dispose=c.cameraTransport.dispose=()=>closes++;
  c.gameDisposed(old);
  t.mock.timers.tick(60000);
  assert.equal(c.state,state);assert.equal(c.connection,connection);assert.equal(closes,0);
  const sessions=new WeakMap();watchGameSessions(sessions,g=>c.observeGame(g));
  const next={info:{...info,sessionId:8}};sessions.set(next,{connection});
  await Promise.resolve();
  assert.equal(c.game,next);assert.equal(c.info.sessionId,8);assert.equal(c.state,state);assert.equal(c.selfId,1);
  c.gameDisposed(old);assert.equal(c.game,next,'late disposal cannot detach the replacement');
  c.connectionDisposed(connection);
  assert.equal(c.state,null);assert.equal(c.connection,null);assert.equal(closes,2);
});

test('ready is retried until the matching host snapshot acknowledges it',t=>{
  const c=room(t);c.isHost=false;c.state.phase='loading';c.state.runtime.ready=[];
  let sends=0;c.transport.send=(id,m)=>{assert.equal(m.type,'ready');sends++;return true;};
  c.sendReady();c.sendReady();assert.equal(sends,1);
  t.mock.timers.tick(1000);c.sendReady();assert.equal(sends,2);
  c.state.runtime.ready=[1];t.mock.timers.tick(2000);c.sendReady();assert.equal(sends,2);
  c.info.sessionId=6;c.state.runtime.ready=[];c.sendReady();assert.equal(sends,2);
});

test('warmup departure expires without voiding other racers and auto rounds continue without the missing racer',t=>{
  const c=room(t);c.lobby=c.lobby.filter(p=>p.id!==3);
  c.checkDisconnects();t.mock.timers.tick(14999);c.checkDisconnects();assert.deepEqual(c.state.runtime.dnfs,[]);
  t.mock.timers.tick(1);c.checkDisconnects();
  assert.equal(c.state.phase,'warmup');assert.deepEqual(c.state.runtime.sittingOut,[3]);
  assert.equal(Cup.mayWatch(c.state,3),true);assert.deepEqual(Cup.racingIds(c.state),[1,2]);
  assert.ok(validSnapshot(Cup.publicState(c.state)));
  c.state.runtime.practiceReady=[1,2];c.advanceClock();assert.equal(c.state.phase,'countdown');
  t.mock.timers.tick(3000);c.advanceClock();assert.equal(c.state.phase,'racing');
  Cup.recordFinish(c.state,1,1000,Date.now()+1000);Cup.markDNF(c.state,2);c.finishRound();
  assert.equal(c.state.matches[0].scores[1],10);assert.equal(c.state.matches[0].scores[3],0);
  assert.ok(c.nextAuto);c.runRound();assert.equal(c.connection.starts,1);
  assert.deepEqual(c.state.runtime.sittingOut,[3]);assert.equal(c.state.matches[0].scores[1],10);
});

test('short absence recovers during grace and backgrounded connected peers never expire by heartbeat age',t=>{
  const c=room(t);const guest=c.lobby.pop();c.checkDisconnects();t.mock.timers.tick(14000);
  c.lobby.push(guest);c.checkDisconnects();t.mock.timers.tick(120000);c.checkDisconnects();
  assert.deepEqual(c.state.runtime.dnfs,[]);assert.equal(c.unavailableSince.size,0);
});

test('missing load acknowledgement has a deadline; late readiness cannot enter a running round',t=>{
  const c=room(t);c.state.phase='loading';c.state.runtime.ready=[1,2];c.loadingSince=Date.now();
  c.advanceClock();assert.equal(c.state.phase,'loading');
  t.mock.timers.tick(30000);c.advanceClock();assert.equal(c.state.phase,'warmup');
  assert.deepEqual(c.state.runtime.sittingOut,[3]);
  c.markReady(3,{roundId:c.round.id,trackId:c.round.trackId,sessionId:7});
  assert.deepEqual(c.state.runtime.ready,[1,2]);
});

test('no racers left pauses safely without scoring empty rounds, and returning presence can resume automatic rounds',t=>{
  const c=room(t);c.lobby=[];c.checkDisconnects();t.mock.timers.tick(15000);c.checkDisconnects();c.advanceClock();
  assert.equal(c.state.phase,'between-rounds');assert.equal(c.state.matches[0].rounds,0);
  assert.equal(c.canStartRound(),false);assert.equal(c.auto,true);
  c.lobby=[{id:1,isSelf:true,nickname:'Host'}];c.updateAvailability();assert.equal(c.canStartRound(),true);
});

test('native stale-slot cleanup only removes terminal peers and invokes native departure broadcasts',()=>{
  class Host {} class Client {} class Game {update(){} dispose(){}} class Library {}
  const connection=new Host(),active=[],pending=[];let notifications=0;
  for(const [state,ready] of [['connected','open'],['disconnected','open'],['failed','open'],['connected','closed']]){
    const peer={peerConnection:{connectionState:state,close(){this.connectionState='closed';}},dataChannel:{readyState:ready}};
    peer.dataChannel.onclose=()=>{const i=active.indexOf(peer);if(i>=0){active.splice(i,1);notifications++;}};active.push(peer);
  }
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','Mn','_n',`let bs=()=>{},Ss=()=>{};return ${code}`)(Host,Client,Game,Library,new WeakMap([[connection,pending]]),new WeakMap([[connection,active]]))};
  const native=connectNative(pml,{});native.pruneClosedPeers(connection);
  assert.equal(active.length,2);assert.equal(notifications,2);
  native.pruneClosedPeers(connection);assert.equal(notifications,2);
});

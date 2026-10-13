import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import {Controller, validSnapshot} from '../.research/test-src/controller.ts';

test('eight racers and eight spectators converge over repeated rounds under delay, jitter, backlog and retries', t => {
 let now=0; t.mock.method(performance,'now',()=>now);
 for(const scenario of ['normal','rtt400','rtt800','jitter','backlog','refused-dropped-duplicated']) {
  let seed=12345, delivered=0, rejected=0, queue=[], oldFinish;
  const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const attempts=new Map(), clients=[];
  const s=Cup.newCup('Stress '+scenario);s.preset.rules.pointsToWin=10000;s.preset.rules.warmup='off';
  for(let id=1;id<=8;id++){Cup.addPlayer(s,id,`Racer ${id}`);Cup.chooseTrack(s,id,{id:'a'.repeat(64),name:'Test track'});}
  Cup.lockRegistration(s);
  for(let id=1;id<=16;id++) {
   const c=new Controller(()=>{});c.state=id===1?s:structuredClone(s);c.selfId=id;c.isHost=id===1;
   c.connection={};c.game={};c.native={};c.now=()=>now;c.hello=new Set(Array.from({length:15},(_,i)=>i+2));
   c.lobby=Array.from({length:16},(_,i)=>({id:i+1,nickname:`Peer ${i+1}`}));c.transport.has=()=>true;
   clients.push(c);
  }
  const host=clients[0];
  const send=(from,to,message)=>{
   const key=`${from}:${to}:${message.type}:${message.roundId??''}`;
   const n=(attempts.get(key)??0)+1;attempts.set(key,n);
   const retryable=['finish','checkpoint','finish-ack'].includes(message.type);
   if(scenario==='refused-dropped-duplicated'&&retryable&&n<=2){rejected++;return n!==1;}
   const lag=scenario==='rtt400'?200:scenario==='rtt800'?400:scenario==='jitter'?Math.floor(random()*1400):scenario==='backlog'?(to===1?1600:400):50;
   queue.push({at:now+lag,from,to,message:structuredClone(message)});
   if(scenario==='refused-dropped-duplicated'&&retryable)queue.push({at:now+lag+600,from,to,message:structuredClone(message)});
   return true;
  };
  for(const c of clients)c.transport.send=(to,m)=>send(c.selfId,to===0?1:to,m);
  host.broadcast=()=>{const message=host.syncMessage();for(let to=2;to<=16;to++)send(1,to,message);};
  const deliver=()=>{queue.sort((a,b)=>a.at-b.at);while(queue.length&&queue[0].at<=now){const e=queue.shift();clients[e.to-1].receive(e.from===1?0:e.from,e.message);delivered++;}};
  for(let round=0;round<24;round++) {
   const start=now;Cup.beginRound(s);s.runtime.sessionId=round+1;s.phase='countdown';Cup.startRace(s,start);
   const run=s.runtime, cars=[];
   for(const c of clients){if(c!==host)c.state=structuredClone(s);c.info={sessionId:run.sessionId,checkpointCount:3};}
   for(let id=1;id<=8;id++) {
    let cp,finish,index=0,frames=0;
    const car={addCheckpointCallback:fn=>cp=fn,addFinishCallback:fn=>finish=fn,getTime:()=>({numberOfFrames:frames}),getNextCheckpointIndex:()=>index};
    const c=clients[id-1];c.info.car=car;c.hookFinish(car,c.state.runtime);
    cars.push({checkpoint:(n,f)=>{index=n;frames=f;cp();},finish:f=>{frames=f;finish();}});
   }
   if(oldFinish){host.receive(2,oldFinish);assert.deepEqual(run.finishes,{},'stale finish must not score a new round');}
   for(let elapsed=0;elapsed<=20000;elapsed+=50) {
    now=start+elapsed;
    for(let i=0;i<8;i++) {
     for(let cp=1;cp<=3;cp++)if(elapsed===cp*2000+i*50)cars[i].checkpoint(cp,elapsed);
     if(elapsed===10000+i*100)cars[i].finish(elapsed);
    }
    for(const c of clients.slice(1,8)){c.flushCheckpoints();c.flushFinish();}
    deliver();
   }
   assert.deepEqual(run.finishes,Object.fromEntries(Array.from({length:8},(_,i)=>[i+1,10000+i*100])),scenario);
   assert.equal(Object.keys(run.splits??{}).length,8,`${scenario}: all checkpoint readings`);
   assert.ok(Object.values(run.splits).every(split=>split.index===2));
   assert.ok(clients.slice(1,8).every(c=>c.pendingFinish===null),`${scenario}: finish retries acknowledged`);
   oldFinish={type:'finish',roundId:run.id,sessionId:run.sessionId,frames:10100,checkpoint:6050};
   Cup.completeRound(s);host.broadcast();
   for(let i=0;i<40;i++){now+=100;deliver();}
   assert.ok(validSnapshot(s));
   for(const c of clients.slice(1)) {
    assert.equal(c.state.phase,'between-rounds',`${scenario}: snapshot phase`);
    assert.deepEqual(c.state.matches[0].scores,s.matches[0].scores,`${scenario}: shared scores`);
    assert.equal(c.state.matches[0].rounds,round+1);
   }
  }
  assert.equal(s.matches[0].roundsLog.length,24);assert.equal(queue.length,0);
  console.log(JSON.stringify({scenario,rounds:24,racers:8,spectators:8,delivered,rejected}));
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import { standings, sessionRecord } from '../.research/test-src/standings.ts';
function grid(n = 4) {
  const s = Cup.newCup('Test cup');
  for (let i = 1; i <= n; i++) { Cup.addPlayer(s,i,`Racer ${i}`); Cup.chooseTrack(s,i,{id:String((i-1)%3+1).repeat(64),name:`Track ${i}`}); }
  Cup.lockRegistration(s, () => .999); return s;
}
function race(s, order = Cup.activeIds(s), times) {
  Cup.beginRound(s); s.phase = 'countdown'; Cup.startRace(s,100000);
  order.forEach((id,i) => assert.equal(Cup.recordFinish(s,id,times?.[i] ?? 30000+i*1000,100000+(times?.[i] ?? 30000+i*1000)),true));
  Cup.completeRound(s);
}
test('2–8 racers each choose one track, duplicates collapse and shuffled order is shared', () => {
  const s = Cup.newCup(); Cup.addPlayer(s,1,'A'); assert.throws(() => Cup.lockRegistration(s));
  Cup.addPlayer(s,2,'B'); Cup.chooseTrack(s,1,{id:'a'.repeat(64),name:'A'}); assert.throws(() => Cup.lockRegistration(s));
  Cup.chooseTrack(s,2,{id:'a'.repeat(64),name:'A'}); assert.equal(s.tracks.length,1);
  Cup.chooseTrack(s,1,{id:'b'.repeat(64),name:'B'}); Cup.chooseTrack(s,2,{id:'c'.repeat(64),name:'C'});
  assert.equal(s.tracks.length,2); Cup.lockRegistration(s,()=>0); assert.deepEqual(Cup.currentMatch(s).order,['c'.repeat(64),'b'.repeat(64)]);
  assert.throws(() => Cup.chooseTrack(s,1,{id:'a'.repeat(64),name:'Late'})); assert.throws(() => Cup.addPlayer(s,3,'Late'));
  const full = Cup.newCup(); for(let i=1;i<=8;i++) Cup.addPlayer(full,i,'Racer'); assert.throws(()=>Cup.addPlayer(full,9,'Extra'));
});
test('every lobby size completes at the first later finalist win and scores all eight places', () => {
  for (let n=2;n<=8;n++) {
    const s=grid(n); race(s); assert.deepEqual(Object.values(s.matches[0].scores),Cup.RULES.points.slice(0,n));
    for(let i=1;i<14;i++) race(s);
    assert.equal(s.matches[0].scores[1],140); assert.deepEqual(s.matches[0].winners,[]);
    race(s); assert.equal(s.phase,'complete'); assert.deepEqual(s.matches[0].winners,[1]);
    assert.equal(s.results.length,n); assert.equal(s.matches.length,1);
  }
});
test('legacy saves preserve four rounds per track and repeat warmups', () => {
  const s=grid(); delete s.matches[0].trackWarmups; for(let i=0;i<13;i++) {
    Cup.beginRound(s); assert.equal(s.runtime.trackId,s.tracks[Math.floor(i/4)%3].id); assert.equal(s.runtime.warmup,i%4===0);
    s.phase='countdown'; Cup.startRace(s,0); Cup.completeRound(s);
  }
});
test('DNF and stale, late, duplicate, spectator finishes cannot score', () => {
  const s=grid(); Cup.beginRound(s); s.phase='countdown'; Cup.startRace(s,100000);
  assert.equal(Cup.recordFinish(s,9,30000,130000),false); assert.equal(Cup.recordFinish(s,1,999999,130000),false);
  assert.equal(Cup.recordFinish(s,1,30000,130000),true); assert.equal(Cup.recordFinish(s,1,29000,130100),false);
  assert.equal(Cup.recordFinish(s,2,40001,140001),false); assert.equal(Cup.recordFinish(s,2,40000,140500),true);
  Cup.markDNF(s,3); assert.equal(Cup.recordFinish(s,3,31000,131000),false); Cup.completeRound(s);
  assert.deepEqual(s.matches[0].scores,{1:10,2:8,3:0,4:0});
});
test('exact tied first shares points and cannot decide the Cup; later outright win can', () => {
  const s=grid(); for(let i=0;i<15;i++) race(s,[1,2,3,4],[30000,30000,31000,32000]);
  assert.deepEqual(s.matches[0].winners,[]); assert.equal(s.matches[0].scores[1],140); assert.equal(s.matches[0].scores[2],140);
  race(s,[2,1,3,4]); assert.equal(s.phase,'complete'); assert.deepEqual(s.matches[0].winners,[2]);
});
test('void and undo remove session records and restore finalist state', () => {
  const s=grid(); race(s); const first=s.matches[0].order[0];
  assert.equal(s.records[first].tr.frames,30000); Cup.beginRound(s); s.phase='countdown'; Cup.startRace(s,0); Cup.recordFinish(s,2,1000,1000);
  assert.equal(sessionRecord(s,first).frames,1000); Cup.voidRound(s); assert.equal(sessionRecord(s,first).frames,30000);
  Cup.undoRound(s); assert.equal(s.records[first].tr,null); assert.equal(s.matches[0].rounds,0);
  for(let i=0;i<15;i++) race(s); Cup.undoRound(s); assert.equal(s.phase,'between-rounds'); assert.equal(s.matches[0].scores[1],140);
  assert.deepEqual(s.matches[0].winners,[]); Cup.undoRound(s); assert.equal(s.matches[0].scores[1],130); assert.equal(s.matches[0].finalists[1],undefined);
});
test('HUD gains reflect actual score caps, ties, provisional finishes and rank movement', () => {
  const s=grid(); s.matches[0].scores[1]=136; race(s,[2,1,3,4]);
  const rows=standings(s); assert.equal(rows.find(r=>r.id===1).gain,4); assert.equal(rows.find(r=>r.id===1).finalist,true);
  Cup.beginRound(s); s.phase='countdown'; Cup.startRace(s,0); Cup.recordFinish(s,3,1000,1000); Cup.recordFinish(s,4,1000,1000);
  const live=standings(s); assert.equal(live[0].gain,10); assert.equal(live[1].gain,10); assert.equal(live[0].position,live[1].position); assert.ok(live[0].provisional);
});
test('reconnect remaps track picks, PBs, records, logs and undo state without identity collisions', () => {
  const s=grid(); race(s); const id=s.tracks[0].id; s.records[id].pbs[1]={status:'ready',frames:24000,source:'profile'};
  Cup.detachIdentities(s); Cup.rebindPlayer(s,-1,9,'Back'); assert.equal(s.picks[9],id); assert.equal(s.records[id].pbs[9].frames,24000);
  assert.deepEqual(s.records[id].tr.ids,[9]); assert.equal(s.matches[0].roundsLog[0].beforeRanking[0],9);
  Cup.undoRound(s); assert.equal(s.matches[0].scores[9],0); assert.equal('history' in Cup.publicState(s),false);
  Cup.beginRound(s); assert.throws(()=>Cup.rebindPlayer(s,9,10,'Live'));
});

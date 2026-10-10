import {presetKey} from '../.research/test-src/presets.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import {standardPreset,quickplayPreset,validPreset,parsePreset,presetText,PresetLibrary} from '../.research/test-src/presets.ts';
import {beginBans,banTurn,banTrack,banEntries,resetDraft} from '../.research/test-src/draft.ts';
import {validSnapshot} from '../.research/test-src/validation.ts';
import {Controller} from '../.research/test-src/controller.ts';
import {standings} from '../.research/test-src/standings.ts';
const track=n=>({id:n.toString(16).padStart(64,'0'),name:`Track ${n}`,category:'official'});
function setup(preset=standardPreset(),players=2){const s=Cup.newCup('Test',preset);for(let id=1;id<=players;id++)Cup.addPlayer(s,id,`Racer ${id}`);return s;}
function locked(preset=standardPreset(),players=2){const s=setup(preset,players);if(preset.rules.selection==='random')s.tracks=[track(1)];
else for(let id=1;id<=players;id++)Cup.chooseTrack(s,id,track(1));Cup.lockRegistration(s);return s;}
function round(s,finishes={}){Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);for(const [id,time]of Object.entries(finishes))Cup.recordFinish(s,Number(id),time,time);Cup.completeRound(s);}

test('bundled presets match Standard and Quickplay rules and contain no WR-based round calculation',()=>{
 const a=standardPreset().rules,b=quickplayPreset().rules;assert.equal(a.roundsPerTrack,4);assert.equal(a.pointsToWin,140);assert.equal(a.finalist,true);
 assert.equal(a.bansPerRacer,1);assert.equal(a.picksPerRacer,1);assert.deepEqual(a.pool,['official','community']);assert.equal(a.warmup,'first-visit');assert.equal(a.allowRacerChanges,false);
 assert.equal(b.roundsPerTrack,3);assert.equal(b.pointsToWin,100);assert.equal(b.finalist,false);assert.equal(b.selection,'random');assert.equal(b.bansPerRacer,0);assert.equal(b.picksPerRacer,0);assert.equal(b.warmup,'off');assert.equal(b.allowRacerChanges,true);
 assert.ok(validPreset(standardPreset()));assert.ok(validPreset(quickplayPreset()));assert.doesNotMatch(presetText(standardPreset()),/drivingTime|trackDriving/);
});
test('preset import rejects malformed, unbounded and incompatible rules; export contains no Cup data',()=>{
 const p=standardPreset();p.name='Community Cup';assert.deepEqual(parsePreset(presetText(p)),p);
 for(const edit of [p=>p.schema=99,p=>p.rules.roundsPerTrack=0,p=>p.rules.roundsPerTrack=31,p=>p.rules.pool=[],p=>p.rules.points=[10,20,6,5,4,3,2,1],
  p=>p.rules.points[0]=1.5,p=>p.rules.warmupMultiplier=Infinity,p=>p.rules.pool=['custom'],p=>p.rules.selection='random',p=>p.rules.surprise=true,p=>p.playerToken='secret']){
   const bad=structuredClone(p);edit(bad);assert.equal(validPreset(bad),false);assert.throws(()=>parsePreset(JSON.stringify(bad)));}
 assert.throws(()=>parsePreset('x'.repeat(32001)),/32 KB/);assert.throws(()=>parsePreset('{'),/JSON/);
 assert.deepEqual(Object.keys(JSON.parse(presetText(p))).sort(),['format','name','rules','schema']);
});
test('custom presets persist, overwrite by name and delete without changing bundled defaults',()=>{
 const values=new Map(),store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},a=new PresetLibrary(store);
 const p=quickplayPreset();assert.throws(()=>a.save(p),/new name/);p.name='Friday';a.save(p);p.rules.pointsToWin=50;a.save(p);
 const b=new PresetLibrary(store);assert.equal(b.list().length,1);assert.equal(b.list()[0].rules.pointsToWin,50);assert.equal(quickplayPreset().rules.pointsToWin,100);
 b.remove('Friday');assert.deepEqual(a.list(),[]);store.setItem('polycup-presets-v1','bad JSON');assert.deepEqual(a.list(),[]);
});
test('multiple bans rotate through the shuffled roster and multiple picks enforce each racer limit',()=>{
 const p=standardPreset();p.rules.bansPerRacer=2;p.rules.picksPerRacer=2;const s=setup(p,3);resetDraft(s);beginBans(s,()=>.99);
 for(let n=1;n<=6;n++){assert.equal(banTurn(s),(n-1)%3+1);banTrack(s,banTurn(s),track(n));assert.ok(validSnapshot(s));}
 assert.equal(s.draft.stage,'picks');assert.equal(banEntries(s).length,6);assert.throws(()=>Cup.chooseTrack(s,1,track(1)),/banned/);
 for(let id=1;id<=3;id++){Cup.chooseTrack(s,id,track(7));Cup.chooseTrack(s,id,track(7+id));assert.throws(()=>Cup.chooseTrack(s,id,track(12)),/Remove/);}
 assert.ok(validSnapshot(s));Cup.removePick(s,1,track(8).id);assert.equal(Cup.picksComplete(s,1),false);assert.equal(s.tracks.some(t=>t.id===track(8).id),false);
 Cup.chooseTrack(s,1,track(11));Cup.lockRegistration(s);assert.ok(validSnapshot(s));assert.equal(s.tracks.length,4);
 assert.throws(()=>Cup.applyPreset(s,quickplayPreset()),/Reopen/);
});
test('zero bans opens picks directly and host category enforcement blocks custom codes when disabled',async()=>{
 const p=standardPreset();p.rules.bansPerRacer=0;const s=setup(p);resetDraft(s);beginBans(s);assert.equal(s.draft.stage,'picks');assert.ok(validSnapshot(s));
 const c=new Controller(()=>{});c.state=s;c.isHost=true;c.selfId=1;c.broadcast=()=>{};
 c.native={parse:()=>({trackData:{getId:()=>track(9).id,hasStartingPoint:()=>true},trackMetadata:{name:'Custom'}}),trackLibrary:{isOfficialTrack:()=>false,isCommunityTrack:()=>false}};
 assert.throws(()=>c.acceptTrack(1,'code'),/category/);s.preset.rules.pool.push('custom');await c.acceptTrack(1,'code');assert.equal(s.picks[1],track(9).id);
});
test('points-race wins at the target; tied totals continue, and finalist mode still requires a later outright win',()=>{
 const p=standardPreset();Object.assign(p.rules,{finalist:false,pointsToWin:10,points:[10,8,6,5,4,3,2,1]});let s=locked(p);
 round(s,{1:1000,2:1100});assert.equal(s.phase,'complete');assert.deepEqual(s.matches[0].winners,[1]);assert.deepEqual(s.matches[0].finalists,{});assert.ok(validSnapshot(s));
 s=locked(p);round(s,{1:1000,2:1000});assert.equal(s.phase,'between-rounds');round(s,{2:1000});assert.equal(s.phase,'complete');assert.equal(s.matches[0].scores[2],20);
 p.rules.finalist=true;s=locked(p);round(s,{1:1000});assert.equal(s.phase,'between-rounds');assert.ok(s.matches[0].finalists[1]);round(s,{1:1000});assert.equal(s.phase,'complete');
});
test('custom points, warmup timing and finish timeout affect both engine and provisional ranking',()=>{
 const p=standardPreset();Object.assign(p.rules,{pointsToWin:25,points:[7,4,2,1,0,0,0,0],warmupTiming:'fixed',warmupSeconds:45,finishTimeoutSeconds:20,readyEndsWarmup:false});
 const s=locked(p);Cup.beginRound(s);assert.equal(s.matches[0].trackWarmups[track(1).id],45000);s.phase='warmup';assert.equal(Cup.practiceReady(s,1,s.runtime.id),false);
 s.phase='countdown';Cup.startRace(s,0);Cup.recordFinish(s,1,2000,2000);assert.equal(s.runtime.deadline,22000);assert.equal(standings(s)[0].gain,7);Cup.completeRound(s);assert.equal(s.matches[0].scores[1],7);
 p.rules.warmup='off';const off=locked(p);Cup.beginRound(off);assert.equal(off.runtime.warmup,false);assert.ok(validSnapshot(off));
 p.rules.warmup='every-visit';p.rules.roundsPerTrack=1;const every=locked(p);round(every);Cup.beginRound(every);assert.equal(every.runtime.warmup,true);
});
test('random track blocks run exactly three rounds and subsequent maps preserve scores and snapshots',()=>{
 const s=locked(quickplayPreset());for(let i=0;i<3;i++){assert.equal(Cup.nextTrack(s),track(1).id);round(s,{1:1000});}
 assert.equal(Cup.nextTrack(s),null);Cup.scheduleRandomTrack(s,track(2),{status:'ready',frames:1000,name:'WR'});
 assert.deepEqual(Cup.trackProgress(s),{trackId:track(2).id,round:1,rounds:3});assert.equal(s.matches[0].scores[1],30);assert.ok(validSnapshot(s));
 round(s,{2:1000});Cup.undoRound(s);assert.equal(Cup.nextTrack(s),track(2).id);assert.equal(s.matches[0].scores[2],0);assert.ok(validSnapshot(s));
});
test('running membership reserves at most eight slots, starts new racers next round and preserves returning scores',()=>{
 const s=locked(quickplayPreset(),8);s.matches[0].scores[1]=40;Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);
 assert.throws(()=>Cup.enterRunningCup(s,9,'New'),/eight/);Cup.leaveRunningCup(s,1);assert.ok(s.runtime.dnfs.includes(1));assert.equal(Cup.occupiedSlots(s),7);
 Cup.enterRunningCup(s,9,'New');assert.equal(s.matches[0].scores[9],0);assert.equal(Cup.activeIds(s).includes(9),false);assert.equal(Cup.occupiedSlots(s),8);
 Cup.completeRound(s);assert.equal(s.matches[0].roundsLog[0].dnfs.includes(9),false);Cup.admitPendingRacers(s,[2,3,4,5,6,7,8,9]);assert.equal(Cup.activeIds(s).includes(9),true);
 Cup.leaveRunningCup(s,9);Cup.enterRunningCup(s,1,'Returning');assert.equal(s.matches[0].scores[1],40);assert.ok(validSnapshot(s));
 Cup.rebindPlayer(s,9,10,'Returning new peer');assert.ok(s.withdrawn.includes(10));assert.ok(validSnapshot(s));
 const standard=locked();assert.throws(()=>Cup.enterRunningCup(standard,3,'No'),/locks/);assert.throws(()=>Cup.leaveRunningCup(standard,1),/locks/);
});
test('leaving after finishing retains the earned points; undo does not discard later entrants',()=>{
 const s=locked(quickplayPreset());Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);Cup.recordFinish(s,1,1000,1000);Cup.leaveRunningCup(s,1);Cup.completeRound(s);
 assert.equal(s.matches[0].scores[1],10);Cup.enterRunningCup(s,3,'Late');Cup.undoRound(s);assert.equal(s.matches[0].scores[3],0);assert.ok(s.matches[0].players.includes(3));assert.ok(validSnapshot(s));
});
import {CheckpointProgress} from '../.research/test-src/progress.ts';
import {profileIdentity} from '../.research/test-src/reconnect.ts';
function controller(state=locked(quickplayPreset())) {
 const c=new Controller(()=>{});c.state=state;c.selfId=1;c.isHost=true;c.connection={startNewSession(){}};
 c.lobby=state.roster.map(p=>({id:p.id,nickname:p.name}));c.hello=new Set(c.lobby.map(p=>p.id));
 c.transport={has:id=>c.lobby.some(p=>p.id===id),send:()=>true};c.info={disposed:false,sessionId:1};c.broadcast=()=>{};c.save=()=>{};
 c.reconnect.reset(state.id);return c;
}
async function authenticate(c,id,token){const proof=await profileIdentity(token,c.state.id),nonce=c.reconnect.challenge(id,proof.publicKey);assert.ok(await c.reconnect.prove(id,nonce,await proof.sign(nonce)));}

test('live enrollment verifies profiles, preserves returning ownership and rejects connected duplicates',async()=>{
 const c=controller();c.state.matches[0].scores[2]=42;await authenticate(c,2,'profile-two');c.reconnect.sync([1,2],[1,2]);
 Cup.leaveRunningCup(c.state,2);c.lobby.push({id:3,nickname:'Racer 2'});c.hello.add(3);await authenticate(c,3,'different-profile');
 await c.enrollRacer(3,{type:'join',cupId:c.state.id});assert.equal(c.state.matches[0].scores[3],0);assert.equal(c.state.matches[0].scores[2],42);
 c.lobby.push({id:4,nickname:'Racer 2'});c.hello.add(4);await authenticate(c,4,'profile-two');
 await assert.rejects(c.enrollRacer(4,{type:'join',cupId:c.state.id}),/already connected/);
 c.lobby=c.lobby.filter(p=>p.id!==2);await c.enrollRacer(4,{type:'join',cupId:c.state.id});
 assert.equal(c.state.matches[0].scores[4],42);assert.equal(Cup.player(c.state,2),undefined);assert.ok(Cup.activeIds(c.state).includes(4));assert.ok(validSnapshot(c.state));
 const outsider=5;c.lobby.push({id:outsider,nickname:'Unverified'});c.hello.add(outsider);
 const pending=c.enrollRacer(outsider,{type:'join',cupId:c.state.id});c.lobby=c.lobby.filter(p=>p.id!==outsider);
 await assert.rejects(pending,/connection changed/);assert.equal(Cup.player(c.state,outsider),undefined);
});
test('disconnect grace releases a slot and temporary same-peer recovery joins the next round automatically',()=>{
 const c=controller();Cup.beginRound(c.state);c.state.phase='countdown';Cup.startRace(c.state,0);c.now=()=>20000;
 c.lobby=c.lobby.filter(p=>p.id!==2);c.unavailableSince.set(2,0);c.checkDisconnects();
 assert.ok(c.state.withdrawn.includes(2));assert.ok(c.state.runtime.dnfs.includes(2));assert.equal(Cup.occupiedSlots(c.state),1);
 c.lobby.push({id:2,nickname:'Racer 2'});c.checkDisconnects();assert.ok(c.state.pendingRacers.includes(2));assert.ok(!Cup.activeIds(c.state).includes(2));
 Cup.completeRound(c.state);c.admitRacers();assert.ok(Cup.activeIds(c.state).includes(2));assert.ok(validSnapshot(c.state));
});
test('queued racer disconnected before admission can recover, while cancelling a join stays cancelled',()=>{
 const c=controller();Cup.beginRound(c.state);c.state.phase='countdown';Cup.startRace(c.state,0);
 Cup.enterRunningCup(c.state,3,'Late');c.hello.add(3);Cup.completeRound(c.state);c.admitRacers();
 assert.ok(c.state.withdrawn.includes(3));assert.ok(c.resumeRacers.has(3));
 c.lobby.push({id:3,nickname:'Late'});c.checkDisconnects();assert.ok(Cup.activeIds(c.state).includes(3));
 c.handleAction(3,{type:'leave',cupId:c.state.id});c.checkDisconnects();assert.ok(c.state.withdrawn.includes(3));
 Cup.leaveRunningCup(c.state,1);Cup.leaveRunningCup(c.state,2);assert.equal(c.canStartRound(),false);
 c.handleAction(3,{type:'join',cupId:c.state.id});assert.equal(c.canStartRound(),true);assert.ok(c.nextAuto>Date.now());
});
test('random rotation shares an in-flight load, skips the previous map and cannot start after the Cup changes',async()=>{
 const c=controller();for(let i=0;i<3;i++)round(c.state);let loads=0,resolve;const t=track(2);
 const data={getId:()=>t.id,hasStartingPoint:()=>true,toExportString:()=> 'code'};
 c.allowedTracks=()=>[{...track(1),load:()=>{throw Error('Repeated map');}},{...t,load:()=>{loads++;return new Promise(r=>resolve=r);}}];
 let starts=0;c.connection.startNewSession=()=>starts++;
 const loading=c.runRound();assert.equal(c.runRound(),loading);assert.equal(loads,1);resolve({trackData:data,trackMetadata:{name:t.name}});await loading;
 assert.equal(starts,1);assert.equal(c.state.runtime.trackId,t.id);assert.equal(c.state.runtime.round,4);assert.ok(validSnapshot(c.state));
 const stopped=controller();for(let i=0;i<3;i++)round(stopped.state);stopped.allowedTracks=c.allowedTracks;
 const old=stopped.state,request=stopped.runRound();stopped.state=null;resolve({trackData:data,trackMetadata:{name:t.name}});await request;
 assert.equal(old.runtime,null);assert.equal(stopped.preparingRandom,false);
});
test('a stalled random track reports a retryable error instead of leaving setup loading forever',async()=>{
 const c=controller();c.allowedTracks=()=>[{...track(1),load:()=>new Promise(()=>{})}];
 await assert.rejects(c.loadRandomTrack(c.state,10),/too long to load/);
});
test('a drafted rematch with late entrants reopens setup rather than assigning them someone else’s picks',()=>{
 const p=standardPreset();p.rules.allowRacerChanges=true;const s=locked(p);Cup.enterRunningCup(s,3,'Late');s.phase='complete';
 const next=Cup.rematch(s);assert.equal(next.phase,'registration');assert.equal(next.draft.stage,'roster');assert.deepEqual(next.picks,{});assert.equal(next.roster.length,3);assert.ok(validSnapshot(next));
 const random=locked(quickplayPreset());Cup.leaveRunningCup(random,2);random.phase='complete';const again=Cup.rematch(random);assert.equal(again.roster.length,1);assert.equal(again.preset.name,'Quickplay');
});


test('leaderboard uploads opt in, survive preset storage/export, and old presets stay competitive',()=>{
 const p=quickplayPreset();assert.equal(p.rules.uploadLeaderboardTimes,false);assert.equal(standardPreset().rules.uploadLeaderboardTimes,false);
 p.name='Public times';p.rules.uploadLeaderboardTimes=true;assert.deepEqual(parsePreset(presetText(p)),p);
 const values=new Map(),store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},library=new PresetLibrary(store);
 library.save(p);assert.equal(library.list()[0].rules.uploadLeaderboardTimes,true);
 const legacy=structuredClone(p);delete legacy.rules.uploadLeaderboardTimes;
 assert.ok(validPreset(legacy));assert.equal(parsePreset(JSON.stringify(legacy)).rules.uploadLeaderboardTimes,false);
 store.setItem('polycup-presets-v1',JSON.stringify([legacy]));assert.equal(library.list()[0].rules.uploadLeaderboardTimes,false);
 for(const value of [0,1,'true',null,{}]){const invalid=structuredClone(p);invalid.rules.uploadLeaderboardTimes=value;assert.equal(validPreset(invalid),false);}
 const saved=locked(legacy);assert.ok(validSnapshot(saved));assert.equal(Cup.rematch({...saved,phase:'complete'}).preset.rules.uploadLeaderboardTimes,undefined);
});

test('every new native round uses the preset mode, including retry and legacy snapshots',()=>{
 for(const upload of [false,true,undefined]){
  const p=quickplayPreset();if(upload===undefined)delete p.rules.uploadLeaderboardTimes;else p.rules.uploadLeaderboardTimes=upload;
  const c=controller(locked(p)),calls=[];c.connection.startNewSession=(...args)=>calls.push(args);
  c.tracks.set(track(1).id,{trackMetadata:{name:'Track 1'},trackData:{getId:()=>track(1).id}});
  for(let round=0;round<3;round++){
   c.runRound();assert.equal(calls.at(-1)[0],upload===true?0:1);
   c.state.phase='countdown';Cup.startRace(c.state,0);Cup.completeRound(c.state);
  }
  assert.equal(calls.length,3);assert.ok(validSnapshot(c.state));
 }
});

test('eight-racer Cup stress: split/finish duplicates, tied finishes, DNFs, undo and export stay consistent',()=>{
 let seed=0x302025;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let cup=0;cup<40;cup++){
  const p=standardPreset();Object.assign(p.rules,{pointsToWin:10000,finalist:cup%2===0,uploadLeaderboardTimes:cup%3===0,warmup:'off',roundsPerTrack:1+cup%5});
  const s=locked(p,8);
  for(let round=0;round<30;round++){
   const scores={...s.matches[0].scores};Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);const progress=new CheckpointProgress();
   for(const id of [...Cup.activeIds(s)].sort(()=>random()-.5)){
    if(random()<.2){Cup.markDNF(s,id);Cup.markDNF(s,id);}
    else {const time=1000+Math.floor(random()*8)*100;assert.equal(progress.record(s,id,0,time-300,time,3),true);assert.equal(progress.record(s,id,0,time-400,time,3),false);assert.equal(progress.record(s,id,1,time-100,time,3),true);assert.equal(Cup.recordFinish(s,id,time,time),true);assert.equal(Cup.recordFinish(s,id,time-1,time),false);}
   }
   assert.ok(Cup.allFinished(s));assert.ok(validSnapshot(s));Cup.completeRound(s);assert.ok(validSnapshot(JSON.parse(JSON.stringify(s))));
   for(const id of Cup.activeIds(s))assert.ok(s.matches[0].scores[id]>=scores[id]);
   if(round%7===0){Cup.undoRound(s);assert.deepEqual(s.matches[0].scores,scores);assert.ok(validSnapshot(s));}
  }
 }
});


test('preset selection compares rules independently of JSON property order and legacy defaults',()=>{
 const p=standardPreset(),reordered={...p,rules:Object.fromEntries(Object.entries(p.rules).reverse())};
 assert.equal(presetKey(p),presetKey(reordered));delete reordered.rules.uploadLeaderboardTimes;assert.equal(presetKey(p),presetKey(reordered));
 reordered.rules.uploadLeaderboardTimes=true;assert.notEqual(presetKey(p),presetKey(reordered));
});

test('host moving a recovering racer to spectators cancels automatic readmission and keeps their score',()=>{
 const c=controller();c.state.matches[0].scores[2]=42;c.resumeRacers.add(2);
 c.moveToSpectators(2);c.checkDisconnects();
 assert.ok(c.state.withdrawn.includes(2));assert.ok(!c.resumeRacers.has(2));assert.equal(c.state.matches[0].scores[2],42);
 c.isHost=false;assert.throws(()=>c.moveToSpectators(1));assert.ok(Cup.activeIds(c.state).includes(1));
});

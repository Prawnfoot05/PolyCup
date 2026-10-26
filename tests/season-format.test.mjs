import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../src/cup.ts';
import {rankedPreset} from '../src/ranked.ts';
import {rankedRoomSnapshot} from '../src/ranked-room.ts';
import {validPreset,standardPreset} from '../src/presets.ts';
import {validSnapshot} from '../src/validation.ts';
import {Controller} from '../.research/test-src/controller.ts';
test('single-track ranked warms up once, stays on the selected track and ends on a finalist win',()=>{
 const s=Cup.newCup('Ranked',rankedPreset()),track='a'.repeat(64);
 Cup.addPlayer(s,1,'Garage A');Cup.addPlayer(s,2,'Garage B');
 s.tracks=[{id:track,name:'Season track'}];Cup.lockRegistration(s);
 assert.equal(Cup.practiceForRecord(undefined,s.preset.rules),30000);
 for(let round=1;round<=4;round++){
  assert.equal(Cup.nextTrack(s),track);Cup.beginRound(s);
  assert.equal(s.runtime.warmup,round===1);assert.equal(s.runtime.round,round);assert.ok(validSnapshot(Cup.publicState(s)), 'guest accepts round '+round+' loading');
  s.phase='racing';s.runtime.startsAt=0;s.runtime.finishes={1:10000,2:11000};Cup.completeRound(s);
  assert.equal(s.phase,round===4?'complete':'between-rounds');
  assert.ok(validSnapshot(Cup.publicState(s)), 'guest accepts round '+round+' result');
  if(round>1){const rotating=structuredClone(s);rotating.preset.rules.singleTrack=false;assert.equal(validSnapshot(Cup.publicState(rotating)),false,'rotating random matches still require a new track block');}
 }
 assert.equal(s.results[0].id,1);assert.equal(s.matches[0].scores[1],30);assert.equal(s.matches[0].scores[2],28);
});
test('season snapshots preserve garage style/name/country and selected track, without draft picks',()=>{
 const raw={id:'match',status:'drafting',host:1,self:2,ticket:'ticket',rules:rankedPreset().rules,
  selected_track:'selected',season:{id:'season-1',name:'Season 1'},pool:[{id:'selected',category:'community',digest:'digest'}],
  members:[{id:1,account:'account-a',name:'Garage A',country:'bg',style:'colored-style',native:null,online:true},{id:2,account:'account-b',name:'Garage B',country:'dk',style:'other-style',native:null,online:true}],
  session:{revision:1,bans:[],picks:[],ready:['account-a','account-b'],chat:[],launch:null}};
 const snapshot=rankedRoomSnapshot(raw,{list:()=>[{id:'selected',name:'Track',category:'community'}]});
 assert.deepEqual(snapshot.data.cup.tracks,[{id:'selected',name:'Track'}]);
 assert.equal(snapshot.members[0].style,'colored-style');assert.equal(snapshot.data.cup.roster[0].name,'Garage A');
 assert.equal(snapshot.members[1].country,'dk');assert.equal(snapshot.data.cup.preset.rules.pointsToWin,30);
 assert.throws(()=>rankedRoomSnapshot({...raw,selected_track:'not-in-pool'},{list:()=>[]}),/unavailable/);
});
test('existing casual presets without the single-track field remain importable',()=>{
 const p=standardPreset();delete p.rules.singleTrack;assert.equal(validPreset(p),true);
 const next=rankedPreset();assert.equal(validPreset(next),true);
});
test('ranked re-entry can resolve the native track library directly from the menu',()=>{
 const old=globalThis.window;
 try{
  const library={forEachTrack(callback){callback('id',{name:'Track',author:'Author'},'official',0,async()=>({}),'thumb');}};
  globalThis.window={dispatchEvent(event){assert.equal(event.type,'polycup-menu-profile');event.detail.trackLibrary=library;}};
  const c=new Controller(()=>{});c.native={};
  assert.equal(c.availableTracks()[0].name,'Track');assert.equal(c.native.trackLibrary,library);
 }finally{globalThis.window=old;}
});

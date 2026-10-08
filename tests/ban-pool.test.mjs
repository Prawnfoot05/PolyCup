import test from 'node:test';
import assert from 'node:assert/strict';
import {standardPreset,validPreset,parsePreset,rulesFor} from '../.research/test-src/presets.ts';
import {validSnapshot} from '../.research/test-src/validation.ts';
import {Controller} from '../.research/test-src/controller.ts';
import * as Cup from '../.research/test-src/cup.ts';
import {resetDraft,beginBans,banTrack} from '../.research/test-src/draft.ts';
const id=n=>n.toString(16).padStart(64,'0');
function setup(){const c=new Controller(()=>{});c.state=Cup.newCup();c.isHost=true;c.selfId=1;c.connection={};c.broadcast=()=>{};Cup.addPlayer(c.state,1,'Host');Cup.addPlayer(c.state,2,'Guest');c.hello.add(2);
 c.native={parse:code=>({trackData:{getId:()=>id(Number(code)),hasStartingPoint:()=>true},trackMetadata:{name:'Track'}}),trackLibrary:{isOfficialTrack:n=>n===id(1),isCommunityTrack:n=>n===id(2)}};return c;}

test('preset imports and public snapshots reject custom tracks combined with any positive ban count',()=>{
 for(const count of [1,2,3]){const p=standardPreset();p.rules.bansPerRacer=count;p.rules.pool.push('custom');assert.equal(validPreset(p),false);assert.throws(()=>parsePreset(JSON.stringify(p)),/zero bans/);
 const s=Cup.newCup();s.preset=p;assert.equal(validSnapshot(s),false);assert.throws(()=>Cup.applyPreset(Cup.newCup(),p),/Invalid/);}
 const p=standardPreset();p.rules.bansPerRacer=0;p.rules.pool.push('custom');assert.deepEqual(parsePreset(JSON.stringify(p)),p);
});
test('host rejects custom uploads whenever bans are enabled, even with a forged custom-enabled pool',async()=>{
 const c=setup();c.state.preset.rules.pool.push('custom');
 assert.throws(()=>c.acceptTrack(1,'3'),/disabled while bans/);
 const replies=[];c.transport.send=(_id,m)=>{replies.push(m);return true;};const packet={cupId:c.state.id,transferId:'custom'};
 c.receiveTrack(2,{...packet,type:'track-begin',length:1});c.receiveTrack(2,{...packet,type:'track-chunk',seq:0,data:'3'});c.receiveTrack(2,{...packet,type:'track-end'});
 assert.match(replies.at(-1).error,/disabled while bans/);assert.deepEqual(c.state.picks,{});
 c.acceptTrack(1,'1');c.acceptTrack(2,'2');assert.equal(c.state.picks[1],id(1));assert.equal(c.state.picks[2],id(2));
});
test('zero-ban Cups accept custom tracks only when opted in, while exact bans remain enforced',()=>{
 const c=setup();c.state.preset.rules.bansPerRacer=0;assert.throws(()=>c.acceptTrack(1,'3'),/category/);
 c.state.preset.rules.pool.push('custom');c.acceptTrack(1,'3');assert.equal(c.state.picks[1],id(3));
 const d=setup();resetDraft(d.state);beginBans(d.state,()=>.99);banTrack(d.state,1,{id:id(1),name:'Main',category:'official'});banTrack(d.state,2,{id:id(2),name:'Community',category:'community'});
 assert.throws(()=>d.acceptTrack(1,'1'),/banned/);assert.throws(()=>d.acceptTrack(2,'2'),/banned/);
});
test('legacy Cups expose custom tracks only when no draft bans exist',()=>{
 const c=setup();delete c.state.preset;assert.ok(rulesFor(c.state).pool.includes('custom'));c.acceptTrack(1,'3');
 resetDraft(c.state);assert.equal(rulesFor(c.state).pool.includes('custom'),false);
});

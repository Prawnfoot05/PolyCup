import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import {resetDraft,beginBans} from '../.research/test-src/draft.ts';
import {Controller,validSnapshot} from '../.research/test-src/controller.ts';
const track={id:'a'.repeat(64),name:'Summer'};
function state(){const s=Cup.newCup();for(const id of [1,2]){Cup.addPlayer(s,id,`Racer ${id}`);Cup.chooseTrack(s,id,track);}return s;}
function host(){const c=new Controller(()=>{});c.isHost=true;c.selfId=1;c.state=state();c.lobby=[{id:1,nickname:'Host'},{id:2,nickname:'Guest'}];c.hello=new Set([2]);c.connection={};c.transport.has=()=>true;c.transport.send=()=>true;c.broadcast=()=>{};c.runRound=async()=>{};c.worldRecordForStart=async()=>({status:'missing'});return c;}
async function tick(t,ms=1000){t.mock.timers.tick(ms);for(let i=0;i<10;i++)await Promise.resolve();}
test('return to lobby cancels countdown and preserves Cup identity, roster, rules and chat', async t => {
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const c=host();for(const id of [1,2])Cup.setDraftReady(c.state,id,true);
 c.chat.system('Keep this message');
 const before=structuredClone(c.state), pending=c.startCup();
 c.reopenRoster();
 assert.equal(c.state.id,before.id);assert.equal(c.state.name,before.name);
 assert.deepEqual(c.state.roster,before.roster);assert.deepEqual(c.state.preset,before.preset);
 assert.equal(c.state.draft.stage,'roster');assert.deepEqual(c.state.tracks,[]);
 assert.deepEqual(c.state.picks,{});assert.deepEqual(c.state.draftReady,[]);
 assert.equal(c.state.draftStartsAt,undefined);assert.equal(c.startingCup,null);
 assert.ok(c.chat.lines.some(l=>l.text==='Keep this message'));
 Cup.addPlayer(c.state,3,'New arrival');assert.equal(c.state.roster.length,3);
 await tick(t,6000);await pending;assert.equal(c.state.phase,'registration');
 assert.equal(c.state.draft.stage,'roster');assert.ok(validSnapshot(c.state));
 c.isHost=false;assert.throws(()=>c.reopenRoster(),/organizer|host/i);
 c.isHost=true;c.state.phase='racing';assert.throws(()=>c.reopenRoster(),/before the Cup starts/);
});
test('return to lobby invalidates a library track still loading from the old draft', async()=>{
 const c=host();let resolve,imports=0;
 c.importTrack=async()=>{imports++;};
 const pending=c.addLibraryTrack({load:()=>new Promise(r=>resolve=r)});
 c.reopenRoster();beginBans(c.state);
 resolve({trackData:{toExportString:()=>''}});
 await assert.rejects(pending,/changed while the track was loading/);
 assert.equal(imports,0);
});
test('late WR lookup from a reset draft cannot start the Cup or cancel a newer countdown', async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const c=host();for(const id of [1,2])Cup.setDraftReady(c.state,id,true);
 let resolveOld, requests=0, starts=0;
 c.worldRecordForStart=()=>++requests===1?new Promise(resolve=>resolveOld=resolve):Promise.resolve({status:'missing'});
 c.runRound=async()=>{starts++;};
 const old=c.startCup();for(let i=0;i<5;i++)await tick(t);
 assert.equal(requests,1);c.reopenRoster();c.state.preset.rules.bansPerRacer=0;beginBans(c.state);
 for(const id of [1,2]){Cup.chooseTrack(c.state,id,track);Cup.setDraftReady(c.state,id,true);}
 const fresh=c.startCup(), token=c.startingCup, deadline=c.state.draftStartsAt;
 resolveOld({status:'ready',frames:10000,name:'Old lookup'});await old;
 assert.equal(starts,0);assert.equal(c.startingCup,token);assert.equal(c.state.draftStartsAt,deadline);
 assert.deepEqual(c.state.records,{});
 for(let i=0;i<5;i++)await tick(t);await fresh;
 assert.equal(starts,1);assert.equal(requests,2);assert.equal(c.startingCup,null);
});
test('draft readiness locks picks, rejects incomplete/spectator requests, and clears on reset or identity change',()=>{
 const s=state();Cup.removePick(s,1,track.id);assert.throws(()=>Cup.setDraftReady(s,1,true),/Choose all/);assert.throws(()=>Cup.setDraftReady(s,99,true),/Only racers/);
 Cup.chooseTrack(s,1,track);Cup.setDraftReady(s,1,true);assert.ok(Cup.draftReady(s,1));assert.throws(()=>Cup.removePick(s,1,track.id),/Unready/);assert.throws(()=>Cup.chooseTrack(s,1,{...track,id:'b'.repeat(64)}),/Unready/);
 const rev=s.revision;Cup.setDraftReady(s,1,true);assert.equal(s.revision,rev);Cup.setDraftReady(s,2,true);assert.ok(validSnapshot(s));Cup.requireDraftReady(s);
 const bad=structuredClone(s);bad.draftReady=[1,1];assert.equal(validSnapshot(bad),false);bad.draftReady=[99];assert.equal(validSnapshot(bad),false);bad.draftReady=[1];bad.draftStartsAt=Date.now()+5000;assert.equal(validSnapshot(bad),false);
 Cup.rebindPlayer(s,1,3,'Returning');assert.equal(Cup.draftReady(s,3),false);assert.ok(Cup.draftReady(s,2));assert.ok(validSnapshot(s));resetDraft(s);assert.deepEqual(s.draftReady,[]);
});
test('host refuses an unready draft before performing any WR requests',async()=>{
 const c=host();let requests=0;c.worldRecordForStart=async()=>{requests++;return{status:'missing'};};await assert.rejects(c.startCup(),/Every racer/);assert.equal(requests,0);
 Cup.setDraftReady(c.state,1,true);await assert.rejects(c.startCup(),/Every racer/);assert.equal(requests,0);
});
test('five-second chat countdown starts only after 5, 4, 3, 2, 1 and is shared as system lines',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const c=host();for(const id of [1,2])Cup.setDraftReady(c.state,id,true);
 const sent=[];c.transport.send=(id,m)=>{sent.push(m);return true;};const pending=c.startCup();assert.equal(c.state.phase,'registration');assert.equal(c.chat.lines[0].text,'Match starting in 5…');
 for(let i=0;i<4;i++){await tick(t);assert.equal(c.state.phase,'registration');}
 assert.deepEqual(c.chat.lines.map(l=>l.text),[5,4,3,2,1].map(n=>`Match starting in ${n}…`));assert.ok(c.chat.lines.every(l=>l.system&&l.speaker===0));
 await tick(t);await pending;assert.equal(c.state.phase,'between-rounds');assert.equal(c.state.draftStartsAt,undefined);assert.ok(sent.some(m=>m.type==='chat-line'&&m.line.system));assert.ok(validSnapshot(c.state));
});
test('remote unready at the last second cancels launch; fresh readiness requires another complete countdown',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const c=host();for(const id of [1,2])Cup.setDraftReady(c.state,id,true);
 const pending=c.startCup();await tick(t,4900);c.receive(2,{type:'draft-ready',cupId:c.state.id,requestId:'unready',value:'editing'});
 assert.equal(Cup.draftReady(c.state,2),false);assert.equal(c.state.draftStartsAt,undefined);assert.match(c.chat.lines.at(-1).text,/cancelled/);
 await tick(t);await pending;assert.equal(c.state.phase,'registration');assert.equal(c.startingCup,null);
 c.receive(2,{type:'draft-ready',cupId:c.state.id,value:'ready'});const next=c.startCup();for(let i=0;i<5;i++)await tick(t);await next;assert.equal(c.state.phase,'between-rounds');
});
test('disconnect during countdown resets readiness and cannot launch from the old timer',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});const c=host();for(const id of [1,2])Cup.setDraftReady(c.state,id,true);
 const pending=c.startCup();c.lobby=c.lobby.filter(p=>p.id!==2);c.checkDisconnects();await tick(t);await pending;assert.equal(c.state.phase,'registration');assert.deepEqual(c.state.draftReady,[]);assert.equal(c.state.roster.length,1);
});

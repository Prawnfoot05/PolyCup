import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import { resetDraft, beginBans, banTrack, banTurn, picksOpen, validDraft } from '../.research/test-src/draft.ts';
import { Controller, validSnapshot } from '../.research/test-src/controller.ts';
const track = (n, category = 'official') => ({ id: n.toString(16).padStart(64,'0'), name: `Track ${n}`, category });
function draft(count = 6) {
  const s = Cup.newCup(); resetDraft(s);
  for(let i=1;i<=count;i++) Cup.addPlayer(s,i,`Player ${i}`);
  return s;
}
function finishBans(s) { let n=1; while(banTurn(s)!==null) banTrack(s,banTurn(s),track(n++)); }
test('2–8 racers ban sequentially in one shared shuffle before picking; duplicate picks remain allowed', () => {
  for(let count=2;count<=8;count++) {
    const s=draft(count); assert.ok(validSnapshot(s));
    assert.throws(()=>Cup.chooseTrack(s,1,track(20)),/bans/);
    beginBans(s,()=>0); assert.notDeepEqual(s.draft.order,s.roster.map(p=>p.id)); assert.ok(validSnapshot(s));
    finishBans(s); assert.ok(picksOpen(s)); assert.ok(validSnapshot(s));
    for(const p of s.roster) Cup.chooseTrack(s,p.id,track(20,'custom'));
    Cup.lockRegistration(s); assert.equal(s.tracks.length,1); assert.ok(validSnapshot(s));
    assert.deepEqual(Cup.publicState(s).draft,s.draft);
  }
});
test('wrong turns, repeats, custom bans, early picks and roster edits cannot alter a locked draft', () => {
  const s=draft(); beginBans(s,()=>.99); const before=structuredClone(s);
  assert.throws(()=>banTrack(s,2,track(1)),/turn/);
  assert.throws(()=>banTrack(s,1,track(1,'custom')),/pool/);
  assert.throws(()=>Cup.removePlayer(s,1),/locked/); assert.throws(()=>Cup.addPlayer(s,10,'Late'),/locked/);
  assert.throws(()=>Cup.lockRegistration(s),/bans/); assert.deepEqual(s,before);
  banTrack(s,1,track(1)); assert.throws(()=>banTrack(s,2,track(1)),/already banned/);
  for(let i=2;i<=6;i++) banTrack(s,i,track(i));
  assert.throws(()=>Cup.chooseTrack(s,2,track(1,'custom')),/banned/);
  Cup.chooseTrack(s,1,track(20)); resetDraft(s);
  assert.equal(s.draft.stage,'roster'); assert.deepEqual(s.tracks,[]); assert.deepEqual(s.picks,{});
  Cup.removePlayer(s,6); assert.ok(validSnapshot(s));
});
test('draft identities survive save detachment and reconnect; rematches preserve or reset bans appropriately', () => {
  const s=draft(2); beginBans(s,()=>.99); banTrack(s,1,track(1));
  Cup.detachIdentities(s); assert.equal(banTurn(s),-2); assert.equal(s.draft.bans[-1].id,track(1).id);
  Cup.rebindPlayer(s,-2,20,'Returned'); assert.equal(banTurn(s),20);
  banTrack(s,20,track(2)); Cup.rebindPlayer(s,-1,10,'Other'); assert.ok(validSnapshot(s));
  for(const p of s.roster) Cup.chooseTrack(s,p.id,track(30));
  Cup.lockRegistration(s); s.phase='complete';
  assert.deepEqual(Cup.rematch(s).draft,s.draft);
  const next=Cup.rematch(s,true); assert.equal(next.draft.stage,'roster'); assert.deepEqual(next.tracks,[]);
});
test('draft snapshots reject malformed orders, skipped turns, duplicate bans and banned playlists', () => {
  const original=draft(); beginBans(original,()=>.99); banTrack(original,1,track(1));
  for(const mutate of [
    s=>s.draft.order.push(99),s=>s.draft.order[0]=s.draft.order[1],
    s=>s.draft.bans[5]=track(2),s=>s.draft.bans[2]=track(1),
    s=>s.draft.stage='picks',s=>s.draft.bans[1].id='invalid',
    s=>{s.tracks=[track(1)];s.picks[1]=track(1).id;},
  ]) { const s=structuredClone(original);mutate(s);assert.equal(validSnapshot(s),false); }
  const legacy=Cup.newCup(); assert.ok(validDraft(legacy));
});
test('host resolves ban metadata from its native pool and binds requests to sender and Cup', () => {
  const host=new Controller(()=>{});host.isHost=true;host.selfId=1;host.connection={};host.state=draft(2);
  host.hello.add(2); host.broadcast=()=>{};host.availableTracks=()=>Array.from({length:12},(_,i)=>track(i+1));
  beginBans(host.state,()=>.99);
  host.handleAction(2,{type:'ban',cupId:'other',value:track(1).id});assert.equal(banTurn(host.state),1);
  assert.throws(()=>host.handleAction(2,{type:'ban',cupId:host.state.id,value:track(1).id,actor:1}),/turn/);
  assert.throws(()=>host.handleAction(1,{type:'ban',cupId:host.state.id,value:track(99).id}),/pool/);
  host.handleAction(1,{type:'ban',cupId:host.state.id,value:track(1).id,name:'spoof'});
  assert.equal(host.state.draft.bans[1].name,'Track 1');
  host.handleAction(2,{type:'ban',cupId:host.state.id,value:track(2).id}); assert.ok(picksOpen(host.state));
});
test('joined clients receive the authoritative ban order and submit only their own ban', () => {
  const host=new Controller(()=>{}),guest=new Controller(()=>{});
  host.isHost=true;host.selfId=1;host.connection={};host.state=draft(2);host.hello.add(2);
  host.availableTracks=()=>Array.from({length:12},(_,i)=>track(i+1));
  guest.selfId=2;
  host.transport.broadcast=m=>guest.receive(0,structuredClone(m));
  host.transport.send=(id,m)=>{guest.receive(0,structuredClone(m));return true;};
  guest.transport.send=(id,m)=>{host.receive(2,structuredClone(m));return true;};
  beginBans(host.state,()=>.99);host.broadcast();
  assert.deepEqual(guest.state.draft.order,[1,2]);
  guest.action('ban',track(1).id);assert.match(guest.error,/turn/);assert.deepEqual(host.state.draft.bans,{});
  host.action('ban',track(1).id);assert.equal(banTurn(guest.state),2);
  guest.action('ban',track(2).id);assert.equal(guest.state.draft.stage,'picks');
  assert.deepEqual(guest.state.draft,host.state.draft);
});

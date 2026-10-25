import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePlayerTags } from '../supabase/functions/_shared/player-tags.ts';
const hour=3600000, now=1000*hour;
const cup=(i,fields={})=>({matchId:String(i),startedAt:now-(i+2)*hour,finishedAt:now-(i+1)*hour,racers:6,place:4,rounds:10,finishedRounds:8,firstRoundPlace:4,...fields});
const context=(cups,fields={})=>({lifetimeCups:cups.length,recentCups:cups,currentCupStartedAt:null,now,...fields});
const ids=c=>derivePlayerTags(c).map(t=>t.id);
test('activity tags distinguish new accounts, eight-hour breaks, and week-long returns',()=>{
  assert.deepEqual(ids(context([])),['fresh-wheels']);
  const cups=Array.from({length:5},(_,i)=>cup(i+10));
  assert.deepEqual(ids(context(cups,{currentCupStartedAt:now})),['waking-up']);
  assert.deepEqual(ids(context(cups,{currentCupStartedAt:now-4*hour})),[]);
  const old=cups.map(c=>({...c,startedAt:c.startedAt-200*hour,finishedAt:c.finishedAt-200*hour}));
  assert.deepEqual(ids(context(old,{currentCupStartedAt:now})),['back-on-track']);
  assert.deepEqual(ids(context([cup(0),...cups],{currentCupStartedAt:now})),[]);
});
test('performance tags need enough validated history and do not affect ratings',()=>{
  const cups=Array.from({length:10},(_,i)=>cup(i,{place:2,finishedRounds:10,firstRoundPlace:1}));
  assert.deepEqual(ids(context(cups)),['consistent','podium-regular','fast-starter']);
  assert.deepEqual(ids(context(cups.slice(0,9))),[]);
  assert.deepEqual(ids(context(cups.map(c=>({...c,racers:2,place:2})))),['consistent']);
});
test('streaks use the latest results, cap display at three, and do not award off invalid samples',()=>{
  const cups=Array.from({length:10},(_,i)=>cup(i,{place:1,finishedRounds:10,firstRoundPlace:1}));
  assert.deepEqual(ids(context(cups)),['on-a-roll','consistent','podium-regular']);
  assert.ok(!ids(context([cup(-1,{place:4}),...cups])).includes('on-a-roll'));
  assert.deepEqual(ids(context(Array(20).fill(cup(0,{place:1})),{lifetimeCups:20})),[]);
  assert.deepEqual(ids(context([],{lifetimeCups:20})),[]);
  assert.deepEqual(ids(context([cup(0,{rounds:0})],{lifetimeCups:10})),[]);
  assert.deepEqual(ids(context(cups,{lifetimeCups:-1})),[]);
});

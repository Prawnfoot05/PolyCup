import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedRatingResult } from '../src/ranked-result.ts';
const profile=(rating,tier,matches=20)=>({player_id:'self',display_name:'Racer',rating,tier,provisional:tier==='provisional',rated_matches:matches,gm_position:null,leaderboard_position:null});
const result=(before,after)=>({match_id:'match',finished_at:'2026-10-22T12:00:00Z',rounds:12,players:[{player_id:'self',display_name:'Racer',place:1,rating_before:before,rating_after:after}]});
test('confirmed rating display preserves gains, losses, zero and first rating without inventing a prior score',()=>{
 assert.equal(confirmedRatingResult(result(15000,15300),'self',null,null).delta,300);
 assert.equal(confirmedRatingResult(result(15000,14875),'self',null,null).delta,-125);
 assert.equal(confirmedRatingResult(result(15000,15000),'self',null,null).delta,0);
 assert.equal(confirmedRatingResult(result(null,12500),'self',null,null).delta,null);
 assert.equal(confirmedRatingResult(result(15000,null),'self',null,null),null);
 assert.equal(confirmedRatingResult(result(15000,15300),'other',null,null),null);
});
test('promotion requires consistent server profiles from exactly this match',()=>{
 const before=profile(19900,'diamond'),after=profile(20150,'master',21),r=result(19900,20150);
 assert.equal(confirmedRatingResult(r,'self',before,after).promoted,true);
 assert.equal(confirmedRatingResult(r,'self',before,{...after,rated_matches:22}).promoted,false);
 assert.equal(confirmedRatingResult(r,'self',before,{...after,rating:20500}).profile,null);
 assert.equal(confirmedRatingResult(r,'self',{...before,rating:19000},after).promoted,false);
 assert.equal(confirmedRatingResult(r,'self',null,after).promoted,false);
 assert.equal(confirmedRatingResult(result(20150,19900),'self',profile(20150,'master'),profile(19900,'diamond',21)).promoted,false);
});
test('finishing placement ranks is a reveal; moving within GM is not an entire rank promotion',()=>{
 const reveal=confirmedRatingResult(result(15000,15300),'self',profile(15000,'provisional',4),profile(15300,'platinum',5));
 assert.equal(reveal.revealed,true);assert.equal(reveal.promoted,false);
 assert.equal(confirmedRatingResult(result(28000,28200),'self',{...profile(28000,'grandmaster'),gm_position:5},{...profile(28200,'grandmaster',21),gm_position:4}).promoted,false);
});

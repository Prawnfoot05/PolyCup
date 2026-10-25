import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../src/cup.ts';
import {standardPreset} from '../src/presets.ts';
import {validateRankedTranscript} from '../supabase/ranked-validator.ts';
for(const players of [2,4])test(`bounded validator matches full client scoring across ties, DNFs and return visits (${players} racers)`,()=>{
 const preset=standardPreset();Object.assign(preset.rules,{roundsPerTrack:3,picksPerRacer:2,bansPerRacer:2});
 const s=Cup.newCup('Reference',preset),roster=Array.from({length:players},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 const tracks=Array.from({length:players*2},(_,i)=>({id:String(i+1).padStart(64,'0'),name:'T'+i,category:'official'}));
 roster.forEach((account,i)=>Cup.addPlayer(s,i+1,account));roster.forEach((account,i)=>{for(const t of tracks.slice(i*2,i*2+2))Cup.chooseTrack(s,i+1,t);});Cup.lockRegistration(s,()=>.99);
 const match={id:s.id,roster,rules:preset.rules,track_pool:tracks,draft:{picks:tracks.map((t,i)=>({track_id:t.id,player_id:roster[Math.floor(i/2)]}))},session:{launch:{id:'launch'}},started_at:new Date(0).toISOString()};
 const value={schema:1,match:s.id,launch:'launch',order:s.matches[0].order,rounds:[]};
 for(let n=0;n<1000&&s.phase!=='complete';n++){
  Cup.beginRound(s);s.phase='racing';s.runtime.startsAt=0;
  const finishes=roster.map((player,i)=>({player,frames:n<980?(n%3===0?1000:null):1000+i*500}));
  for(const [i,f]of finishes.entries())if(f.frames===null)Cup.markDNF(s,i+1);else s.runtime.finishes[i+1]=f.frames;
  value.rounds.push({round:n+1,track:s.runtime.trackId,finishes});Cup.completeRound(s);
 }
 assert.equal(s.phase,'complete');assert.ok(value.rounds.length>980);
 const expected=s.results.map(r=>({player_id:roster[r.id-1],place:r.place,points:s.matches[0].scores[r.id]})).sort((a,b)=>a.player_id.localeCompare(b.player_id));
 assert.deepEqual(validateRankedTranscript(match,value).standings,expected);
 const incomplete=structuredClone(value);incomplete.rounds.pop();assert.throws(()=>validateRankedTranscript(match,incomplete),/No finalist/);
 const wrongTrack=structuredClone(value);wrongTrack.rounds[20].track='f'.repeat(64);assert.throws(()=>validateRankedTranscript(match,wrongTrack),/rotation/);
});

import { createHash } from 'node:crypto';
import * as Cup from '../src/cup.ts';
import { standardPreset } from '../src/presets.ts';
import type { RankedTranscript } from '../src/ranked-transcript.ts';
import { settleInterruptedRanked } from './ranked-forfeit.ts';

/** Recomputes competition results from unanimous account-attested observations.
 * This is result-integrity validation, not a native-physics anti-cheat verifier.
 * Deployment does not turn peer consensus into physical replay verification.
 */
export function validateRankedTranscript(match: any, value: RankedTranscript, now = Date.now()) {
  const fail = (reason: string): never => { throw new Error(reason); };
  if (!value || value.schema!==1 || value.match!==match.id || value.launch!==match.session?.launch?.id ||
      !Array.isArray(value.rounds) || !value.rounds.length || value.rounds.length>1000) fail('Invalid transcript identity or size.');
  const preset=standardPreset();
  for (const key of Object.keys(preset.rules)) (preset.rules as any)[key]=match.rules[key];
  if (preset.rules.pointsToWin!==140 || preset.rules.roundsPerTrack!==3 || !preset.rules.finalist) fail('Unsupported ranked rules.');
  const state=Cup.newCup('Ranked',preset); state.id=match.id;
  const roster: string[]=match.roster;
  state.roster=roster.map((account,i)=>({id:i+1,name:account}));
  state.draft={stage:'picks',order:state.roster.map(p=>p.id),bans:{},banHistory:[]};
  for (const pick of match.draft.picks) {
    if (!match.track_pool.some((t:any)=>t.id===pick.track_id && ['official','community'].includes(t.category))) fail('Track outside reserved pool.');
    Cup.chooseTrack(state,roster.indexOf(pick.player_id)+1,{id:pick.track_id,name:pick.track_id});
  }
  Cup.lockRegistration(state);
  const picked=state.tracks.map(t=>t.id).sort();
  if (!Array.isArray(value.order) || JSON.stringify([...value.order].sort())!==JSON.stringify(picked)) fail('Invalid track schedule.');
  state.matches[0].order=[...value.order];
  let minimumElapsed=0;
  for (let i=0;i<value.rounds.length;i++) {
    const round=value.rounds[i];
    if (state.phase==='complete' || round.round!==i+1 || Cup.nextTrack(state)!==round.track ||
        !Array.isArray(round.finishes) || round.finishes.length!==roster.length || new Set(round.finishes.map(f=>f.player)).size!==roster.length)
      fail('Round order, rotation or roster is invalid.');
    Cup.beginRound(state); state.phase='racing';state.runtime!.startsAt=0;
    let max=0;
    for (const finish of round.finishes) {
      const id=roster.indexOf(finish.player)+1;
      if (!id) fail('Unknown racer.');
      if (finish.frames===null) Cup.markDNF(state,id);
      else {
        if (!Number.isSafeInteger(finish.frames) || finish.frames<1 || finish.frames>3600000) fail('Invalid finish time.');
        // Score only; physical execution is a separate validation gate.
        state.runtime!.finishes[id]=finish.frames;max=Math.max(max,finish.frames);
      }
    }
    minimumElapsed+=max; Cup.completeRound(state);
    // Validation needs the scoring accumulators, not the client's undo journal.
    // Retain one visit marker per track for warmup bookkeeping. Keeping every
    // previous round here makes each scoring step copy an ever-growing history.
    state.history = [];
    const visits = new Map(state.matches[0].roundsLog.map(r => [r.trackId, r]));
    state.matches[0].roundsLog = [...visits.values()];
  }
  if (state.phase!=='complete') fail('No finalist has won.');
  if (minimumElapsed>now-new Date(match.started_at).getTime()+2000) fail('Transcript exceeds elapsed match time.');
  const digest=createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {digest,rounds:value.rounds.length,standings:state.results.map(p=>({player_id:roster[p.id-1],place:p.place,points:state.matches[0].scores[p.id]})).sort((a,b)=>a.player_id.localeCompare(b.player_id))};
}

/** Compatibility helper for local fixtures. Production uses the durable job queue. */
export async function settleLocalRanked(db: any, matchId: string) {
  await db.query('select public.polycup_ranked_expire()');
  return db.transaction((tx:any)=>settleRankedInTransaction(tx,matchId));
}

/** Caller owns the transaction; all events, ratings and completion commit together. */
export async function settleRankedInTransaction(tx:any,matchId:string) {
    const match=(await tx.query('select * from public.polycup_ranked_matches where id=$1 for update',[matchId])).rows[0];
    if (!match || match.status==='completed') return match?.status;
    if (!['racing','review'].includes(match.status)) return match.status;
    const members=(await tx.query('select player_id,abandoned_at from public.polycup_ranked_members where match_id=$1',[matchId])).rows;
    const abandoned=new Set<string>(members.filter((p:any)=>p.abandoned_at).map((p:any)=>p.player_id));
    if(match.terminal_reason==='abandonment_interrupted')return settleInterruptedRanked(tx,match);
    const rows=(await tx.query('select * from public.polycup_ranked_transcripts where match_id=$1 order by player_id',[matchId])).rows;
    if(!rows.length || members.some((p:any)=>!abandoned.has(p.player_id)&&!rows.some((r:any)=>r.player_id===p.player_id)))return 'pending';
    const canonical=JSON.stringify(rows[0].transcript);
    let evidence;
    try {
      if(rows.some((r:any)=>JSON.stringify(r.transcript)!==canonical))throw Error('Conflicting racer transcripts.');
      evidence=validateRankedTranscript(match,rows[0].transcript);
      if(abandoned.size){
        if(evidence.standings.some(p=>p.place===1&&abandoned.has(p.player_id)))throw Error('Abandoned racer cannot win.');
        const finishers=evidence.standings.filter(p=>!abandoned.has(p.player_id)).sort((a,b)=>a.place-b.place);
        evidence.standings=evidence.standings.map(p=>({...p,place:abandoned.has(p.player_id)?members.length:finishers.findIndex(f=>f.player_id===p.player_id)+1}));
      }
    } catch(e) {
      if(abandoned.size)return settleInterruptedRanked(tx,match);
      await tx.query("update public.polycup_ranked_matches set status='unrated',terminal_reason=$2,finished_at=now() where id=$1",[matchId,(e as Error).message]);
      await tx.query('delete from public.polycup_ranked_claims where match_id=$1',[matchId]);
      return 'unrated';
    }
    await tx.query("update public.polycup_ranked_matches set status='review',deadline=now()+interval '30 minutes' where id=$1",[matchId]);
    await tx.query('select public.polycup_ranked_settle_validated($1,$2,$3)',[matchId,evidence.digest,JSON.stringify(evidence)]);
    return 'completed';
}

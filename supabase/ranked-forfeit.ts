import { createHash } from 'node:crypto';
/** Trusted backend worker only. An interrupted Cup changes only confirmed leavers. */
export async function settleInterruptedRanked(tx: any, match: any) {
  if(match.model_version!=='btf-6.2.0-t025-softplus-v1')throw Error('Unsupported rating model.');
  const members=(await tx.query('select player_id,abandoned_at from public.polycup_ranked_members where match_id=$1 order by player_id',[match.id])).rows;
  const abandoned=members.filter((p:any)=>p.abandoned_at);
  if(!abandoned.length)throw Error('No server-confirmed abandonment.');
  const batch=[];
  for(const member of members){
    const rating=(await tx.query('select * from public.player_ratings where player_id=$1 for update',[member.player_id])).rows[0];
    if(!rating)throw Error('Missing player rating.');
    const stored=(await tx.query('select state from public.polycup_rating_state where player_id=$1',[member.player_id])).rows[0]?.state;
    if(stored && stored.model!==match.model_version)throw Error('Unsupported model.');
    if(!stored && (rating.rating!==null||rating.rated_matches!==0))throw Error('Missing model state.');
    if(stored && rating.rating!==(await tx.query('select public.polycup_rating_display($1) rating',[stored.mu])).rows[0].rating)
      throw Error('Stored rating and model state disagree.');
    batch.push({member,rating,stored,skill:stored??{mu:25,sigma:25/3}});
  }
  for(const player of batch){
    if(!player.member.abandoned_at)continue;
    const inputs=batch.map(p=>({...p.skill,place:p===player?batch.length:1}));
    const calculated=(await tx.query('select public.polycup_rating_calculate($1) r',[JSON.stringify(inputs)])).rows[0].r[batch.indexOf(player)];
    const next={model:match.model_version,mu:calculated.mu,sigma:calculated.sigma};
    await tx.query(`insert into public.polycup_rating_events(match_id,player_id,rating_before,rating_after,matches_before,model_version,state_before,state_after)
      values($1,$2,$3,$4,$5,$6,$7,$8)`,[match.id,player.member.player_id,player.rating.rating,calculated.rating,player.rating.rated_matches,match.model_version,player.stored??null,next]);
    await tx.query('update public.player_ratings set rating=$2,rated_matches=rated_matches+1,updated_at=now() where player_id=$1',[player.member.player_id,calculated.rating]);
    await tx.query('insert into public.polycup_rating_state(player_id,state) values($1,$2) on conflict(player_id) do update set state=excluded.state',[player.member.player_id,next]);
  }
  const result={rounds:0,outcome:'abandonment_interrupted',standings:members.map((p:any)=>({player_id:p.player_id,place:p.abandoned_at?members.length:null,points:0,abandoned:!!p.abandoned_at}))};
  await tx.query('insert into public.polycup_ranked_validations values($1,$2,$3,now())',[match.id,createHash('sha256').update(JSON.stringify(result)).digest('hex'),'server-abandonment-v1']);
  await tx.query("update public.polycup_ranked_matches set status='completed',terminal_reason='abandonment_interrupted',result=$2,finished_at=now() where id=$1",[match.id,result]);
  await tx.query('delete from public.polycup_ranked_claims where match_id=$1',[match.id]);
  return 'completed';
}

-- Selected model: OpenSkill 6.2.0 Bradley-Terry Full, one racer per team,
-- mu=25, sigma=25/3, beta=25/6, tau=.25, kappa=.0001; no margins/weights.
-- Specialized SQL implementation, verified against pinned OpenSkill fixtures.
-- See supabase/OPEN_SKILL_LICENSE.txt for the upstream MIT notice.
begin;

update public.polycup_ranked_config set model_version='btf-6.2.0-t025-softplus-v1'
where model_version is null;

create function public.polycup_rating_display(skill double precision)
returns integer language plpgsql immutable set search_path='' as $$
declare z double precision; value double precision;
begin
  if skill is null or skill not between -100000 and 100000 then raise exception 'Invalid skill estimate.'; end if;
  z:=skill/10;
  -- Stable softplus. Lower tail can safely underflow to zero, never overflow.
  value:=12500*(greatest(z,0)+case when abs(z)>700 then 0 else ln(1+exp(-abs(z))) end)/ln(1+exp(2.5::double precision));
  return round(value)::integer;
end $$;

-- Pure calculation, not an endpoint clients may call. Keeps input order and
-- uses only placements, including shared places; there are no bonus points.
create function public.polycup_rating_calculate(entries jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare n integer; a integer; b integer; item jsonb; mus double precision[]:='{}';
  variances double precision[]:='{}'; places integer[]:='{}'; c double precision;
  probability double precision; outcome double precision; omega double precision;
  delta double precision; z double precision; new_mu double precision; new_sigma double precision;
  output jsonb:='[]';
begin
  if entries is null or jsonb_typeof(entries)<>'array' or octet_length(entries::text)>16000 then raise exception 'Invalid rating inputs.'; end if;
  n:=jsonb_array_length(entries);
  if n not between 2 and 4 then raise exception 'Expected two to four racers.'; end if;
  for item in select value from jsonb_array_elements(entries) loop
    if jsonb_typeof(item->'mu') is distinct from 'number' or jsonb_typeof(item->'sigma') is distinct from 'number'
      or coalesce(item->>'place','') !~ '^[1-4]$'
      or (item->>'mu')::double precision not between -100000 and 100000
      or (item->>'sigma')::double precision not between .000001 and 1000
      or (item->>'place')::integer>n then raise exception 'Invalid rating inputs.'; end if;
    mus:=array_append(mus,(item->>'mu')::double precision);
    variances:=array_append(variances,power((item->>'sigma')::double precision,2)+.0625);
    places:=array_append(places,(item->>'place')::integer);
  end loop;
  for a in 1..n loop
    omega:=0;delta:=0;
    for b in 1..n loop
      if a=b then continue; end if;
      c:=sqrt(variances[a]+variances[b]+2*power(25.0/6,2));
      z:=(mus[b]-mus[a])/c;
      probability:=case when z>700 then 0 when z< -700 then 1 else 1/(1+exp(z)) end;
      outcome:=case when places[a]<places[b] then 1 when places[a]=places[b] then .5 else 0 end;
      omega:=omega+variances[a]/c*(outcome-probability);
      delta:=delta+sqrt(variances[a])*variances[a]/power(c,3)*probability*(1-probability);
    end loop;
    new_mu:=mus[a]+omega;
    new_sigma:=sqrt(variances[a])*sqrt(greatest(1-delta,.0001));
    output:=output||jsonb_build_array(jsonb_build_object('mu',new_mu,'sigma',new_sigma,
      'rating',public.polycup_rating_display(new_mu)));
  end loop;
  return output;
end $$;

-- A trusted validator calls this only AFTER checking the canonical transcript.
-- It supplies a match ID, never chosen deltas or arbitrary model parameters.
-- Matching reports remain necessary, but are not proof against collusion/cheats.
create function public.polycup_ranked_rate(match_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p uuid; prior public.player_ratings%rowtype;
  stored jsonb; inputs jsonb:='[]'; batch jsonb:='[]'; calculated jsonb; item jsonb;
  result_report jsonb; place integer; idx integer:=0;
begin
  perform public.polycup_ranked_expire();
  select * into m from public.polycup_ranked_matches where id=match_key for update;
  if m.id is null or m.model_version<>'btf-6.2.0-t025-softplus-v1' then raise exception 'Unsupported rating model.'; end if;
  if m.status='completed' then return; end if;
  if m.status<>'review' or (select count(*) from public.polycup_ranked_reports where match_id=match_key)<>cardinality(m.roster)
    or (select count(distinct report) from public.polycup_ranked_reports where match_id=match_key)<>1 then raise exception 'Complete, consistent reports are required.'; end if;
  select report into result_report from public.polycup_ranked_reports where match_id=match_key limit 1;
  -- Lock and snapshot the entire batch before calculation. Same lock order as finalization.
  for p in select x from unnest(m.roster) x order by x loop
    select * into prior from public.player_ratings where player_id=p for update;
    select state into stored from public.polycup_rating_state where player_id=p;
    if prior.player_id is null then raise exception 'Missing player rating.'; end if;
    if stored is null then
      if prior.rating is not null or prior.rated_matches<>0 then raise exception 'Existing rating needs an explicit model migration.'; end if;
      item:=jsonb_build_object('mu',25.0,'sigma',25.0/3);
    else
      if stored->>'model' is distinct from m.model_version then raise exception 'Existing rating needs an explicit model migration.'; end if;
      item:=stored;
      if prior.rating is distinct from public.polycup_rating_display((stored->>'mu')::double precision) then raise exception 'Stored rating and model state disagree.'; end if;
    end if;
    select (x->>'place')::integer into place from jsonb_array_elements(result_report->'standings') x where x->>'player_id'=p::text;
    inputs:=inputs||jsonb_build_array(item||jsonb_build_object('place',place));
    batch:=batch||jsonb_build_array(jsonb_build_object('player_id',p,'before',prior.rating,
      'matches_before',prior.rated_matches,'state_before',stored));
  end loop;
  calculated:=public.polycup_rating_calculate(inputs);
  for item in select value from jsonb_array_elements(batch) loop
    batch:=jsonb_set(batch,array[idx::text],item||jsonb_build_object('after',calculated->idx->'rating',
      'state_after',jsonb_build_object('model',m.model_version,'mu',calculated->idx->'mu','sigma',calculated->idx->'sigma')));
    idx:=idx+1;
  end loop;
  perform public.polycup_ranked_finalize(match_key,m.model_version,batch);
end $$;

-- The raw settlement endpoint is now internal. Service callers use rate().
revoke all on function public.polycup_ranked_finalize(uuid,text,jsonb) from service_role;
revoke all on function public.polycup_rating_display(double precision),public.polycup_rating_calculate(jsonb),
  public.polycup_ranked_rate(uuid) from public,anon,authenticated;
grant execute on function public.polycup_ranked_rate(uuid) to service_role;

drop function public.polycup_ranked_history(uuid,integer,integer);
create function public.polycup_ranked_history(player_key uuid,page_size integer default 20,page_offset integer default 0)
returns table(match_id uuid,finished_at timestamptz,place integer,rating_before integer,rating_after integer,
  model_version text,player_count integer,rounds integer)
language sql stable security definer set search_path='' as $$
 select e.match_id,m.finished_at,(s->>'place')::integer,e.rating_before,e.rating_after,e.model_version,
   cardinality(m.roster),(m.result->>'rounds')::integer
 from public.polycup_rating_events e join public.polycup_ranked_matches m on m.id=e.match_id,
 jsonb_array_elements(m.result->'standings') s
 where e.player_id=player_key and s->>'player_id'=player_key::text and m.status='completed'
 order by m.finished_at desc,m.id
 limit greatest(1,least(coalesce(page_size,20),100)) offset greatest(0,least(coalesce(page_offset,0),10000))
$$;

create function public.polycup_ranked_match(match_key uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('match_id',m.id,'finished_at',m.finished_at,'rounds',(m.result->>'rounds')::integer,
   'players',(select jsonb_agg(jsonb_build_object('player_id',s->>'player_id',
     'display_name',coalesce(p.display_name,'Deleted player'),'place',(s->>'place')::integer,
     'rating_before',e.rating_before,'rating_after',e.rating_after) order by (s->>'place')::integer,s->>'player_id')
     from jsonb_array_elements(m.result->'standings') s
     left join public.profiles p on p.id=(s->>'player_id')::uuid
     left join public.polycup_rating_events e on e.match_id=m.id and e.player_id=p.id))
 from public.polycup_ranked_matches m where m.id=match_key and m.status='completed'
$$;
revoke all on function public.polycup_ranked_history(uuid,integer,integer),public.polycup_ranked_match(uuid) from public;
grant execute on function public.polycup_ranked_history(uuid,integer,integer),public.polycup_ranked_match(uuid) to anon,authenticated,service_role;
commit;

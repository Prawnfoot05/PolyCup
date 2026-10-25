-- Wake immediately when durable evidence is ready; Cron remains the recovery path.
begin;
alter table public.polycup_ranked_dispatch add column last_request_nonce uuid;
create or replace function public.polycup_ranked_dispatch_tick()
returns text language plpgsql security definer set search_path='' as $$
declare cfg public.polycup_ranked_dispatch%rowtype; response jsonb; token text;
 request_id bigint; failure boolean:=false; code text; stamp text; nonce text; signature text;
begin
 -- All callers must already be trusted operators. Same lock order as queue
 -- maintenance; a busy queue takes precedence over this background tick.
 if not pg_try_advisory_xact_lock(777,1) then return 'busy'; end if;
 select * into cfg from public.polycup_ranked_dispatch where singleton for update;
 if not cfg.enabled then return 'disabled'; end if;
 update public.polycup_ranked_dispatch set last_check_at=now() where singleton;
 perform public.polycup_ranked_expire();
 insert into public.polycup_ranked_result_jobs(match_id)
 select m.id from public.polycup_ranked_matches m where m.status in ('racing','review')
 and not exists(select 1 from public.polycup_ranked_result_jobs j where j.match_id=m.id)
 and public.polycup_ranked_result_ready(m.id)
 order by m.started_at,m.id limit 100 on conflict do nothing;

 if cfg.last_request_id is not null then
   if to_regclass('net._http_response') is not null then
     execute 'select to_jsonb(r) from net._http_response r where id=$1'
       into response using cfg.last_request_id;
   end if;
   if response is null and cfg.dispatched_at>now()-interval '90 seconds' then
     update public.polycup_ranked_dispatch set last_outcome='in_flight' where singleton;
     return 'in_flight';
   end if;
   failure:=response is null or coalesce((response->>'timed_out')::boolean,false)
     or coalesce((response->>'status_code')::integer,0) not between 200 and 299;
   update public.polycup_ranked_dispatch set last_request_id=null,last_request_nonce=null,
     last_http_status=(response->>'status_code')::integer,
     failures=case when failure then least(failures+1,30) else 0 end,
     last_success_at=case when failure then last_success_at else now() end,
     next_dispatch_at=case when failure then now()+make_interval(secs=>least(900,30*(2^least(cfg.failures,5))::integer)) else now() end,
     last_outcome=case when failure then 'http_retry' else 'delivered' end
   where singleton returning * into cfg;
 end if;
 if cfg.next_dispatch_at>now() then return 'backoff'; end if;
 if not exists(select 1 from public.polycup_ranked_result_jobs where finished_at is null and next_attempt_at<=now()) then
   update public.polycup_ranked_dispatch set last_outcome='idle' where singleton;
   return 'idle';
 end if;
 if cfg.function_url is null or to_regclass('vault.decrypted_secrets') is null
   or to_regclass('net._http_response') is null or to_regprocedure('extensions.hmac(text,text,text)') is null then
   update public.polycup_ranked_dispatch set last_outcome='not_configured',next_dispatch_at=now()+interval '5 minutes' where singleton;
   return 'not_configured';
 end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1'
   into token using 'polycup_result_cron_token';
 if token is null or token !~ '^[a-f0-9]{64}$' then
   update public.polycup_ranked_dispatch set last_outcome='missing_token',next_dispatch_at=now()+interval '5 minutes' where singleton;
   return 'missing_token';
 end if;
 -- pg_net queues may be readable by other DB roles. Send only a short-lived
 -- HMAC, never the reusable secret. Dispatch occurs after this transaction commits.
 -- No secret literals
 -- appear in cron.job, cron output, response bodies or the dispatch status row.
 begin
   stamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
   nonce:=gen_random_uuid()::text;
   execute 'select encode(extensions.hmac($1,$2,''sha256''),''hex'')' into signature
     using 'polycup-results:v1:'||stamp||':'||nonce,token;
   execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=45000)'
     into request_id using cfg.function_url,
       jsonb_build_object('Content-Type','application/json','x-polycup-time',stamp,'x-polycup-nonce',nonce,'x-polycup-signature',signature), '{}'::jsonb;
   if request_id is null then raise exception 'No dispatch receipt.'; end if;
   update public.polycup_ranked_dispatch set last_request_id=request_id,last_request_nonce=nonce::uuid,dispatched_at=now(),last_outcome='dispatched' where singleton;
 exception when others then
   get stacked diagnostics code=returned_sqlstate;
   update public.polycup_ranked_dispatch set last_outcome='dispatch_error:'||code,
     failures=least(failures+1,30),next_dispatch_at=now()+make_interval(secs=>least(900,30*(2^least(cfg.failures,5))::integer)) where singleton;
   return 'dispatch_error';
 end;
 return 'dispatched';
end $$;
revoke all on function public.polycup_ranked_dispatch_tick() from public,anon,authenticated,service_role,polycup_result_worker;

-- Only the authenticated worker can acknowledge its own dispatch. Commit rating
-- writes before this acknowledgement so the next invocation sees finished jobs.
create function public.polycup_ranked_dispatch_complete(invocation_nonce uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(777,1) then return 'busy'; end if;
 perform 1 from public.polycup_ranked_dispatch where singleton for update;
 if invocation_nonce is null or not exists(select 1 from public.polycup_ranked_dispatch
   where singleton and last_request_nonce=invocation_nonce and last_request_id is not null) then return 'stale'; end if;
 update public.polycup_ranked_dispatch set last_request_id=null,last_request_nonce=null,
   failures=0,last_http_status=200,last_success_at=now(),next_dispatch_at=now(),last_outcome='delivered'
 where singleton;
 return public.polycup_ranked_dispatch_tick();
end $$;
revoke all on function public.polycup_ranked_dispatch_complete(uuid) from public,anon,authenticated,service_role;
grant execute on function public.polycup_ranked_dispatch_complete(uuid) to polycup_result_worker;

-- Deferred until the result submission transaction has finished its status update.
-- pg_net only sends after COMMIT. A rollback can never start settlement.
create function public.polycup_ranked_wake_result()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.polycup_ranked_result_ready(new.match_id) then
   perform public.polycup_ranked_dispatch_tick();
 end if;
 return null;
exception when others then
 -- Waking is best effort. Keep the transcript durable; Cron rediscovers it.
 return null;
end $$;
revoke all on function public.polycup_ranked_wake_result() from public,anon,authenticated,service_role,polycup_result_worker;
create constraint trigger polycup_ranked_wake_result after insert on public.polycup_ranked_transcripts
 deferrable initially deferred for each row execute function public.polycup_ranked_wake_result();
commit;

begin;
create table public.polycup_input_dispatch (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 function_url text check(function_url ~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/polycup-input-review$'),
 last_request_id bigint,
 dispatched_at timestamptz,
 next_dispatch_at timestamptz not null default now(),
 failures integer not null default 0 check(failures>=0),
 last_http_status integer,
 last_check_at timestamptz,
 last_success_at timestamptz,
 claimed_at timestamptz,last_outcome text,dispatch_day date not null default current_date,daily_requests integer not null default 0,max_daily_requests integer not null default 5000
);
insert into public.polycup_input_dispatch(singleton) values(true);
alter table public.polycup_input_dispatch enable row level security;
revoke all on public.polycup_input_dispatch from public,anon,authenticated,service_role,polycup_input_worker;

alter table public.polycup_input_dispatch add column last_request_nonce uuid;
create or replace function public.polycup_input_dispatch_tick()
returns text language plpgsql security definer set search_path='' as $$
declare cfg public.polycup_input_dispatch%rowtype; response jsonb; token text;
 request_id bigint; failure boolean:=false; code text; stamp text; nonce text; signature text;
begin
 -- All callers must already be trusted operators. Same lock order as queue
 -- maintenance; a busy queue takes precedence over this background tick.
 if not pg_try_advisory_xact_lock(777,250) then return 'busy'; end if;
 select * into cfg from public.polycup_input_dispatch where singleton for update;
 if not cfg.enabled then return 'disabled'; end if;
 update public.polycup_input_dispatch set last_check_at=now() where singleton;
 perform public.polycup_input_prune();

 if cfg.last_request_id is not null then
   if to_regclass('net._http_response') is not null then
     execute 'select to_jsonb(r) from net._http_response r where id=$1'
       into response using cfg.last_request_id;
   end if;
   if response is null and cfg.dispatched_at>now()-interval '90 seconds' then
     update public.polycup_input_dispatch set last_outcome='in_flight' where singleton;
     return 'in_flight';
   end if;
   failure:=response is null or coalesce((response->>'timed_out')::boolean,false)
     or coalesce((response->>'status_code')::integer,0) not between 200 and 299;
   update public.polycup_input_dispatch set last_request_id=null,last_request_nonce=null,claimed_at=null,
     last_http_status=(response->>'status_code')::integer,
     failures=case when failure then least(failures+1,30) else 0 end,
     last_success_at=case when failure then last_success_at else now() end,
     next_dispatch_at=case when failure then now()+make_interval(secs=>least(900,30*(2^least(cfg.failures,5))::integer)) else now() end,
     last_outcome=case when failure then 'http_retry' else 'delivered' end
   where singleton returning * into cfg;
 end if;
 if cfg.next_dispatch_at>now() then return 'backoff'; end if;
 if not exists(select 1 from public.polycup_input_runs u join public.polycup_ranked_matches m on m.id=u.match_id join public.polycup_ranked_validations v on v.match_id=m.id and v.method='local-peer-transcript-v1' where u.recording is not null and u.processed_at is null and u.next_attempt_at<=now() and m.status='completed' and (select enabled from public.polycup_input_review_config where singleton)) then
   update public.polycup_input_dispatch set last_outcome='idle' where singleton;
   return 'idle';
 end if;
 if cfg.dispatch_day<>current_date then update public.polycup_input_dispatch set dispatch_day=current_date,daily_requests=0 where singleton returning * into cfg;end if;
 if cfg.daily_requests>=cfg.max_daily_requests then return 'daily_limit';end if;
 if cfg.function_url is null or to_regclass('vault.decrypted_secrets') is null
   or to_regclass('net._http_response') is null or to_regprocedure('extensions.hmac(text,text,text)') is null then
   update public.polycup_input_dispatch set last_outcome='not_configured',next_dispatch_at=now()+interval '5 minutes' where singleton;
   return 'not_configured';
 end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1'
   into token using 'polycup_input_cron_token';
 if token is null or token !~ '^[a-f0-9]{64}$' then
   update public.polycup_input_dispatch set last_outcome='missing_token',next_dispatch_at=now()+interval '5 minutes' where singleton;
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
     using 'polycup-input-review:v1:'||stamp||':'||nonce,token;
   execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=45000)'
     into request_id using cfg.function_url,
       jsonb_build_object('Content-Type','application/json','x-polycup-time',stamp,'x-polycup-nonce',nonce,'x-polycup-signature',signature), '{}'::jsonb;
   if request_id is null then raise exception 'No dispatch receipt.'; end if;
   update public.polycup_input_dispatch set claimed_at=null,last_request_id=request_id,last_request_nonce=nonce::uuid,dispatched_at=now(),daily_requests=daily_requests+1,last_outcome='dispatched' where singleton;
 exception when others then
   get stacked diagnostics code=returned_sqlstate;
   update public.polycup_input_dispatch set last_outcome='dispatch_error:'||code,
     failures=least(failures+1,30),next_dispatch_at=now()+make_interval(secs=>least(900,30*(2^least(cfg.failures,5))::integer)) where singleton;
   return 'dispatch_error';
 end;
 return 'dispatched';
end $$;
revoke all on function public.polycup_input_dispatch_tick() from public,anon,authenticated,service_role,polycup_input_worker;

-- Only the authenticated worker can acknowledge its own dispatch. Commit review
-- writes before this acknowledgement so the next invocation sees completed inputs.
create function public.polycup_input_dispatch_complete(invocation_nonce uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(777,250) then return 'busy'; end if;
 perform 1 from public.polycup_input_dispatch where singleton for update;
 if invocation_nonce is null or not exists(select 1 from public.polycup_input_dispatch
   where singleton and last_request_nonce=invocation_nonce and last_request_id is not null) then return 'stale'; end if;
 update public.polycup_input_dispatch set last_request_id=null,last_request_nonce=null,claimed_at=null,
   failures=0,last_http_status=200,last_success_at=now(),next_dispatch_at=now(),last_outcome='delivered'
 where singleton;
 return public.polycup_input_dispatch_tick();
end $$;
revoke all on function public.polycup_input_dispatch_complete(uuid) from public,anon,authenticated,service_role;
grant execute on function public.polycup_input_dispatch_complete(uuid) to polycup_input_worker;


create function public.polycup_input_dispatch_claim(invocation_nonce uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.polycup_input_dispatch set claimed_at=now() where singleton and enabled and last_request_nonce=invocation_nonce and last_request_id is not null and claimed_at is null and dispatched_at>now()-interval '90 seconds';
 return found;
end $$;
revoke all on function public.polycup_input_dispatch_claim(uuid) from public,anon,authenticated,service_role;
grant execute on function public.polycup_input_dispatch_claim(uuid) to polycup_input_worker;
create function public.polycup_input_wake() returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.polycup_input_dispatch_tick();return null;exception when others then return null;end $$;
revoke all on function public.polycup_input_wake() from public;
create constraint trigger polycup_input_wake after insert on public.polycup_input_runs deferrable initially deferred for each row execute function public.polycup_input_wake();
create constraint trigger polycup_input_settled after update on public.polycup_ranked_matches deferrable initially deferred for each row when(new.status='completed' and old.status is distinct from new.status) execute function public.polycup_input_wake();
create constraint trigger polycup_input_validated after insert on public.polycup_ranked_validations deferrable initially deferred for each row execute function public.polycup_input_wake();
commit;

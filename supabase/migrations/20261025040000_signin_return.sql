-- Short-lived PKCE return-code handoff for launchers without an opener/callback.
-- No account/session tokens or PKCE verifiers are accepted here.
begin;
create table public.polycup_signin_returns (
 attempt uuid primary key,
 reader_hash bytea not null,
 writer_hash bytea not null,
 code text,
 expires_at timestamptz not null default (now()+interval '10 minutes')
);
create table public.polycup_signin_budget (
 singleton boolean primary key default true check(singleton),
 window_at timestamptz not null default now(),
 attempts integer not null default 0
);
insert into public.polycup_signin_budget(singleton) values(true);
alter table public.polycup_signin_returns enable row level security;
alter table public.polycup_signin_budget enable row level security;
revoke all on public.polycup_signin_returns, public.polycup_signin_budget from public,anon,authenticated;

create function public.polycup_signin_return(action text,attempt_key uuid,secret text,peer_secret text default null,return_code text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare h bytea; other_hash bytea; stored public.polycup_signin_returns; used integer;
begin
 if attempt_key is null or secret is null or secret !~ '^[a-f0-9]{64}$' then return '{}'::jsonb;end if;
 h:=sha256(convert_to(secret,'UTF8'));
 if action='begin' then
  if peer_secret is null or peer_secret !~ '^[a-f0-9]{64}$' or peer_secret=secret then return '{}'::jsonb;end if;
  other_hash:=sha256(convert_to(peer_secret,'UTF8'));
  perform pg_advisory_xact_lock(717,40);
  delete from public.polycup_signin_returns where expires_at<=now();
  select * into stored from public.polycup_signin_returns where attempt=attempt_key;
  if found then return jsonb_build_object('available',stored.reader_hash=h and stored.writer_hash=other_hash);end if;
  update public.polycup_signin_budget set attempts=0,window_at=now() where singleton and window_at<=now()-interval '1 hour';
  select attempts into used from public.polycup_signin_budget where singleton;
  if used>=500 or (select count(*) from public.polycup_signin_returns)>=200 then return jsonb_build_object('available',false);end if;
  insert into public.polycup_signin_returns(attempt,reader_hash,writer_hash) values(attempt_key,h,other_hash);
  update public.polycup_signin_budget set attempts=attempts+1 where singleton;
  return jsonb_build_object('available',true);
 elsif action='put' then
  if return_code is null or length(return_code)>600 or return_code !~ '^polycup1:[a-f0-9-]{36}:[a-zA-Z0-9_-]+$'
     or length(split_part(return_code,':',3)) not between 8 and 512
     or split_part(return_code,':',2)<>attempt_key::text then return '{}'::jsonb;end if;
  update public.polycup_signin_returns set code=return_code
   where attempt=attempt_key and writer_hash=h and expires_at>now() and (code is null or code=return_code);
  return jsonb_build_object('received',found);
 elsif action='get' then
  -- Reads are repeatable until acknowledgement, so a lost HTTP response is safe.
  select * into stored from public.polycup_signin_returns where attempt=attempt_key and reader_hash=h;
  if not found then return jsonb_build_object('code',null);end if;
  if stored.expires_at<=now() then delete from public.polycup_signin_returns where attempt=attempt_key;return jsonb_build_object('code',null);end if;
  return jsonb_build_object('code',stored.code);
 elsif action='cancel' then
  delete from public.polycup_signin_returns where attempt=attempt_key and reader_hash=h;
  return jsonb_build_object('cancelled',found);
 end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.polycup_signin_return(text,uuid,text,text,text) from public;
grant execute on function public.polycup_signin_return(text,uuid,text,text,text) to anon,authenticated;
commit;

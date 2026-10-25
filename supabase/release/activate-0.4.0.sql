-- Operator step: run only after the public 0.4.0 bundle and hash are verified.
begin;
select pg_advisory_xact_lock(777, 1);
do $$
begin
  if not exists(select 1 from public.polycup_queue_config where singleton and version in ('0.4.0-dev.1','0.4.0')) then
    raise exception 'Unexpected queue version; inspect before cutover';
  end if;
  if exists(select 1 from public.polycup_ranked_queue) or exists(
    select 1 from public.polycup_ranked_matches where status in ('reserved','drafting','racing','review','disputed')
  ) then raise exception 'Queue or matches are active; wait before cutover'; end if;
  update public.polycup_queue_config set version='0.4.0',enabled=true where singleton;
end $$;
commit;

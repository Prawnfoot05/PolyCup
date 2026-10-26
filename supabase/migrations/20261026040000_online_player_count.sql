begin;
create index if not exists polycup_presence_recent on public.friend_presence_sessions(last_seen,user_id);
-- Public aggregate only: never expose presence identities or session tokens.
create function public.polycup_online_count() returns integer
language sql stable security definer set search_path='' as $$
 select count(distinct p.user_id)::integer from public.friend_presence_sessions p
 join auth.users u on u.id=p.user_id
 where p.last_seen>now()-interval '90 seconds' and not coalesce(u.is_anonymous,true)
$$;
revoke all on function public.polycup_online_count() from public;
grant execute on function public.polycup_online_count() to anon,authenticated,service_role;
commit;

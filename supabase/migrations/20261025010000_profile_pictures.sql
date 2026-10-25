-- Local UI extension: current public profile pictures, not Discord auth metadata.
begin;
create function public.polycup_profile_pictures(player_keys uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(cardinality(player_keys),0)>100 then raise exception 'Too many profiles';end if;
 return coalesce((select jsonb_object_agg(p.id,p.avatar_url) from public.profiles p join auth.users u on u.id=p.id where p.id=any(player_keys) and not coalesce(u.is_anonymous,true)),'{}');
end $$;
revoke all on function public.polycup_profile_pictures(uuid[]) from public;
grant execute on function public.polycup_profile_pictures(uuid[]) to anon,authenticated,service_role;

commit;

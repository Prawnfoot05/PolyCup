begin;
-- Content identity, not an authorization token. This includes frozen rules as
-- well as the bundled catalog, so either changing invalidates client caches.
alter table public.polycup_ranked_matches add column static_key text
 generated always as ('v1:' || md5(track_pool::text || ':' || rules::text)) stored;

-- Preserve the original API for existing clients. All membership, fencing and
-- action validation runs before deciding whether static fields can be omitted.
create function public.polycup_ranked_session_v2(
 match_key uuid,instance_key uuid,action text default 'poll',
 value jsonb default 'null',known_static_key text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; fingerprint text;
begin
 result:=public.polycup_ranked_session(match_key,instance_key,action,value);
 if result is null or jsonb_typeof(result)<>'object' then return result;end if;
 select static_key into fingerprint from public.polycup_ranked_matches where id=match_key;
 if known_static_key=fingerprint then result:=result-'pool'-'rules';end if;
 return result||jsonb_build_object('static_key',fingerprint);
end $$;
revoke all on function public.polycup_ranked_session_v2(uuid,uuid,text,jsonb,text) from public,anon;
grant execute on function public.polycup_ranked_session_v2(uuid,uuid,text,jsonb,text) to authenticated;
commit;

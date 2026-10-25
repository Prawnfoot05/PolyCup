begin;
create table public.polycup_friend_invites (
 id uuid primary key default gen_random_uuid(),
 room uuid not null references public.polycup_rooms(id) on delete cascade,
 sender uuid not null references public.profiles(id) on delete cascade,
 recipient uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(room,sender,recipient), check(sender<>recipient)
);
alter table public.polycup_friend_invites enable row level security;
revoke all on public.polycup_friend_invites from public,anon,authenticated;

create function public.polycup_invite_friend(room_key uuid,instance_key uuid,friend_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid();
begin
 if who is null then raise exception 'Sign in to invite friends.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(who::text,775));
 if not exists(select 1 from public.friendships where status='accepted' and
   ((requester_id=who and addressee_id=friend_key) or (addressee_id=who and requester_id=friend_key))) then
   raise exception 'You can only invite your friends.';
 end if;
 if not exists(select 1 from public.polycup_room_members m join public.polycup_rooms r on r.id=m.room
   where m.room=room_key and m.actor=who and m.instance=instance_key
   and m.seen_at>now()-interval '35 seconds' and r.seen_at>now()-interval '90 seconds') then
   raise exception 'Rejoin the Cup before inviting friends.';
 end if;
 delete from public.polycup_friend_invites where created_at<now()-interval '5 minutes';
 if exists(select 1 from public.polycup_friend_invites where room=room_key and sender=who and recipient=friend_key and created_at>now()-interval '30 seconds') then return; end if;
 if (select count(*) from public.polycup_friend_invites where sender=who)>=20 then raise exception 'Too many pending invitations. Try again shortly.'; end if;
 insert into public.polycup_friend_invites(room,sender,recipient) values(room_key,who,friend_key)
 on conflict(room,sender,recipient) do update set created_at=now();
end $$;

create function public.polycup_friend_invites()
returns table(id uuid,room_title text,sender_name text,code text)
language sql stable security definer set search_path='' as $$
 select i.id,r.data->'cup'->>'name',p.display_name,r.code
 from public.polycup_friend_invites i join public.polycup_rooms r on r.id=i.room
 join public.profiles p on p.id=i.sender
 where i.recipient=auth.uid() and i.created_at>now()-interval '5 minutes'
 and r.seen_at>now()-interval '90 seconds'
 and exists(select 1 from public.polycup_room_members m where m.room=i.room and m.actor=i.sender)
 and exists(select 1 from public.friendships f where f.status='accepted' and
   ((f.requester_id=i.sender and f.addressee_id=i.recipient) or (f.addressee_id=i.sender and f.requester_id=i.recipient)))
 order by i.created_at desc limit 20
$$;
create function public.polycup_dismiss_invite(invite_key uuid)
returns void language sql security definer set search_path='' as $$
 delete from public.polycup_friend_invites where id=invite_key and recipient=auth.uid()
$$;
revoke all on function public.polycup_invite_friend(uuid,uuid,uuid),public.polycup_friend_invites(),public.polycup_dismiss_invite(uuid) from public,anon;
grant execute on function public.polycup_invite_friend(uuid,uuid,uuid),public.polycup_friend_invites(),public.polycup_dismiss_invite(uuid) to authenticated;
commit;

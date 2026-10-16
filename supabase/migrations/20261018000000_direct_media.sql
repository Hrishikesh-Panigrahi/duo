-- Direct delivery of view-once photos and videos, and a members-only room.

-- ─── Direct delivery ───────────────────────────────────────────────────

-- When both apps are open, a photo or video goes straight from phone to phone
-- with no copy in Storage at all. This records which way a file went, so the
-- app knows not to look for it in Storage.
alter table public.messages
  add column media_direct boolean not null default false;

-- Senders set only what the app sends. The server picks the time and the
-- sender, and only the recipient can mark something opened (mark_media_opened).
revoke insert on public.messages from authenticated;
grant insert (id, space_id, cipher, has_media, media_direct) on public.messages to authenticated;

-- ─── Members-only room ─────────────────────────────────────────────────

-- The app's live room (who's online, who's typing, and setting up direct
-- transfers) is a private Realtime channel named room:<space id>. Only the
-- space's two members may join it, listen on it or send to it.
create function public.can_use_room(topic text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then exists (
      select 1 from public.members m
      where m.user_id = (select auth.uid())
        and m.space_id::text = substr(topic, 6)
    )
    else false
  end;
$$;

revoke execute on function public.can_use_room(text) from public, anon;
grant execute on function public.can_use_room(text) to authenticated;

create policy "members listen in their room" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_use_room((select realtime.topic()))
  );

create policy "members talk in their room" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_use_room((select realtime.topic()))
  );

-- ─── Fix: turning encryption on for a space made before it ─────────────

-- A space created before encryption still has its plaintext name, and the
-- ciphertext-only rule on spaces refuses any update to such a row, so both
-- turning encryption on and joining failed. Each now clears that old name in
-- the same step; the app encrypts the name again straight after setup.
create or replace function public.enable_e2e(salt text, check_value text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  select space_id into sid from public.members where user_id = auth.uid();
  if sid is null then
    raise exception 'You are not in a space';
  end if;
  if char_length(salt) not between 16 and 64 or char_length(check_value) not between 16 and 256 then
    raise exception 'Invalid encryption setup';
  end if;

  update public.spaces set e2e_salt = salt, e2e_check = check_value, name = null
  where id = sid and e2e_salt is null;

  if not found then
    raise exception 'Encryption is already set up for this space';
  end if;
end $$;

create or replace function public.join_space(code text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    raise exception 'You are already in a space';
  end if;

  -- FOR UPDATE: if two people race with the same code, the second one
  -- re-checks after the first commits, sees the code cleared, and fails.
  select id into sid
  from public.spaces
  where invite_code = upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))
  for update;

  if sid is null then
    raise exception 'That invite code doesn''t match any space';
  end if;

  insert into public.members (space_id, user_id) values (sid, uid);
  update public.spaces set invite_code = null, name = null where id = sid;
  return sid;
end $$;

-- ─── Least privilege ───────────────────────────────────────────────────

-- These helpers only ever answer "am I a member?", so they mean nothing to
-- someone signed out; don't let them call them at all.
revoke execute on function public.is_member(uuid), public.can_access_media(text) from public, anon;
grant execute on function public.is_member(uuid), public.can_access_media(text) to authenticated;

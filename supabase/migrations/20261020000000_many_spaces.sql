-- Many spaces per person.
--
-- A person can now start or join several spaces (one with a partner, one with
-- a sibling, ...). Each space still has exactly two members: its invite code is
-- cleared once the second person joins. Because a person may be in several
-- spaces, turning encryption on now names the space it's for.

-- ─── Membership ────────────────────────────────────────────────────────

alter table public.members drop constraint members_user_id_key;
-- The dropped constraint was also the index for "which spaces am I in?".
create index members_user_idx on public.members (user_id);

-- ─── Starting and joining ──────────────────────────────────────────────

-- A generous cap, so one account can't collect spaces without end. The lock
-- makes one person's calls take turns, so two at once can't both slip under it.
create or replace function public.create_space()
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  if (select count(*) from public.members where user_id = uid) >= 20 then
    raise exception 'You''re in as many spaces as Duo allows';
  end if;
  insert into public.spaces default values returning id into sid;
  insert into public.members (space_id, user_id) values (sid, uid);
  return sid;
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
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  if (select count(*) from public.members where user_id = uid) >= 20 then
    raise exception 'You''re in as many spaces as Duo allows';
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
  -- The person who started a space can't use its code to fill the second seat.
  if exists (select 1 from public.members where space_id = sid and user_id = uid) then
    raise exception 'That''s the invite for your own space: send it to your person';
  end if;

  insert into public.members (space_id, user_id) values (sid, uid);
  update public.spaces set invite_code = null, name = null where id = sid;
  return sid;
end $$;

-- ─── Turning encryption on ─────────────────────────────────────────────

-- Like enable_e2e, but for the space named. It also clears an older space's
-- plaintext name; the app encrypts the name again straight after setup.
create function public.enable_space_e2e(space uuid, salt text, check_value text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(space) then
    raise exception 'You are not in that space';
  end if;
  if char_length(salt) not between 16 and 64 or char_length(check_value) not between 16 and 256 then
    raise exception 'Invalid encryption setup';
  end if;

  update public.spaces set e2e_salt = salt, e2e_check = check_value, name = null
  where id = space and e2e_salt is null;

  if not found then
    raise exception 'Encryption is already set up for this space';
  end if;
end $$;

revoke execute on function public.enable_space_e2e(uuid, text, text) from public, anon;
grant execute on function public.enable_space_e2e(uuid, text, text) to authenticated;

-- The app version from before this migration still calls enable_e2e, which
-- found "your" space. It now only works while that's unambiguous.
create or replace function public.enable_e2e(salt text, check_value text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  if (select count(*) from public.members where user_id = auth.uid()) <> 1 then
    raise exception 'Please reload Duo to update it';
  end if;
  select space_id into sid from public.members where user_id = auth.uid();
  perform public.enable_space_e2e(sid, salt, check_value);
end $$;

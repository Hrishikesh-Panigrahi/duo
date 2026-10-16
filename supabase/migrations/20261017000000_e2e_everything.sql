-- End-to-end encryption for everything else, plus view-once photos and videos.
--
-- Contacts, notes, lists, list items, the space's name and each member's
-- display name are now encrypted on the phone, like messages. The old
-- plaintext columns stay (nullable) so rows written before this can be
-- upgraded in place by the app the first time someone unlocks it; NOT VALID
-- constraints make every row written or changed from now on ciphertext-only.
-- Length limits move into the app, since the database can't read the values.

-- ─── Space and member names ────────────────────────────────────────────

alter table public.spaces
  add column name_cipher text check (char_length(name_cipher) <= 2000),
  alter column name drop not null,
  alter column name drop default,
  drop constraint spaces_name_check;
alter table public.spaces
  add constraint spaces_name_encrypted check (name is null) not valid;
grant update (name_cipher) on public.spaces to authenticated;

alter table public.members
  add column display_name_cipher text check (char_length(display_name_cipher) <= 2000),
  alter column display_name drop not null,
  drop constraint members_display_name_check;
alter table public.members
  add constraint members_name_encrypted check (display_name is null) not valid;
grant update (display_name_cipher) on public.members to authenticated;

-- Names are no longer passed in: the app encrypts and sets them after the
-- passphrase is entered.
drop function public.create_space(text, text);
drop function public.join_space(text, text);

create function public.create_space()
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
  insert into public.spaces default values returning id into sid;
  insert into public.members (space_id, user_id) values (sid, uid);
  return sid;
end $$;

create function public.join_space(code text)
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
  update public.spaces set invite_code = null where id = sid;
  return sid;
end $$;

revoke execute on function public.create_space(), public.join_space(text) from public, anon;
grant execute on function public.create_space(), public.join_space(text) to authenticated;

-- ─── Content ───────────────────────────────────────────────────────────

alter table public.contacts
  add column cipher text check (char_length(cipher) <= 200000),
  alter column full_name drop not null,
  drop constraint contacts_full_name_check;
alter table public.contacts
  add constraint contacts_encrypted check (
    cipher is not null
    and full_name is null and phones = '{}' and emails = '{}' and company is null
    and address is null and birthday is null and notes is null and tags = '{}'
    and favorite = false
  ) not valid;

alter table public.notes
  add column cipher text check (char_length(cipher) <= 200000),
  drop constraint notes_title_check,
  drop constraint notes_body_check;
alter table public.notes
  add constraint notes_encrypted check (cipher is not null and title = '' and body = '' and pinned = false) not valid;

alter table public.lists
  add column cipher text check (char_length(cipher) <= 4000),
  alter column title drop not null,
  drop constraint lists_title_check,
  drop constraint lists_emoji_check;
alter table public.lists
  add constraint lists_encrypted check (cipher is not null and title is null and emoji is null) not valid;

alter table public.list_items
  add column cipher text check (char_length(cipher) <= 8000),
  alter column text drop not null,
  drop constraint list_items_text_check;
alter table public.list_items
  add constraint list_items_encrypted check (cipher is not null and text is null and done = false and due_date is null) not valid;

-- Messages can't be edited, so a plaintext message from before encryption is
-- swapped for an encrypted copy (same time) in one step, by its sender only.
create function public.encrypt_legacy_message(old_id uuid, new_id uuid, new_cipher text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
begin
  select * into m from public.messages where id = old_id for update;
  if not found or m.sender_id <> auth.uid() or not public.is_member(m.space_id) then
    raise exception 'Message not found';
  end if;
  if m.cipher is not null then
    return; -- already encrypted
  end if;
  insert into public.messages (id, space_id, sender_id, cipher, created_at)
  values (new_id, m.space_id, m.sender_id, new_cipher, m.created_at);
  delete from public.messages where id = old_id;
end $$;

revoke execute on function public.encrypt_legacy_message(uuid, uuid, text) from public, anon;
grant execute on function public.encrypt_legacy_message(uuid, uuid, text) to authenticated;

-- ─── View-once photos and videos ───────────────────────────────────────

-- The file itself lives in Storage, encrypted, at <space id>/<message id>.
alter table public.messages
  add column has_media boolean not null default false,
  add column media_opened_at timestamptz;

-- The recipient marks a photo or video opened; the app then deletes the file.
create function public.mark_media_opened(message_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.messages
  set media_opened_at = now()
  where id = message_id
    and has_media
    and media_opened_at is null
    and sender_id <> auth.uid()
    and public.is_member(space_id);
end $$;

revoke execute on function public.mark_media_opened(uuid) from public, anon;
grant execute on function public.mark_media_opened(uuid) to authenticated;

-- Private bucket; files are ciphertext, so the only type is raw bytes.
-- 50 MB is the Free plan's per-file maximum.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['application/octet-stream'])
on conflict (id) do nothing;

-- True if the object path is <your space id>/<uuid>.
create function public.can_access_media(object_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'
    and exists (
      select 1 from public.members m
      where m.user_id = (select auth.uid())
        and m.space_id::text = split_part(object_name, '/', 1)
    );
$$;

create policy "members upload media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.can_access_media(name));
create policy "members read media" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.can_access_media(name));
create policy "members delete media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.can_access_media(name));

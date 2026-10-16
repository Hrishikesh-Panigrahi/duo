-- End-to-end encrypted messages.
--
-- Messages are encrypted on each phone with a key derived from a passphrase
-- the two of you share. The database only ever stores ciphertext, so nobody
-- with database or dashboard access can read new messages.

-- The salt is random and not secret. The check value is a known string
-- encrypted with the key, so a phone can tell a mistyped passphrase apart
-- from the right one.
alter table public.spaces
  add column e2e_salt  text,
  add column e2e_check text;

-- Set once per space. Changing the salt later would make every existing
-- message unreadable, so this refuses if it's already set.
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

  update public.spaces set e2e_salt = salt, e2e_check = check_value
  where id = sid and e2e_salt is null;

  if not found then
    raise exception 'Encryption is already set up for this space';
  end if;
end $$;

revoke execute on function public.enable_e2e(text, text) from public, anon;
grant execute on function public.enable_e2e(text, text) to authenticated;

alter table public.messages
  add column cipher text check (char_length(cipher) <= 32000);

-- Every new message must be ciphertext only. NOT VALID leaves any rows
-- written before this migration as they were.
alter table public.messages drop constraint message_has_content;
alter table public.messages
  add constraint messages_are_encrypted
  check (cipher is not null and body is null and contact is null) not valid;

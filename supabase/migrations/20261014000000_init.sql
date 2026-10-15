-- Duo: a private space for two people.
--
-- Paste this whole file into the Supabase SQL editor and run it once
-- (or `supabase db push` if you use the CLI).
--
-- Every row of content belongs to a "space". A space has at most two
-- members: whoever creates it, and whoever joins with its invite code.
-- Row-level security means you can only ever read or write rows in the
-- space you belong to.

-- ─── Spaces & members ──────────────────────────────────────────────────

-- 8 characters from an alphabet with no look-alikes (no 0/O, 1/I/L).
-- Bytes come from gen_random_uuid(), which is cryptographically random;
-- bytes 6 and 8 carry fixed UUID version/variant bits, so they're skipped.
create or replace function public.gen_invite_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + get_byte(r.b, i) % 31, 1), ''
  )
  from (select uuid_send(gen_random_uuid()) as b) r,
       unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) as i;
$$;

create table public.spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Us' check (char_length(name) between 1 and 60),
  -- Cleared once the second person joins, so a space can never hold three.
  invite_code text unique default public.gen_invite_code(),
  created_at  timestamptz not null default now()
);

create table public.members (
  space_id     uuid not null references public.spaces (id) on delete cascade,
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at    timestamptz not null default now(),
  primary key (space_id, user_id)
);

-- security definer so policies on `members` can call it without recursing.
create or replace function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.space_id = s and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.create_space(space_name text, my_name text)
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

  insert into public.spaces (name)
  values (coalesce(nullif(trim(space_name), ''), 'Us'))
  returning id into sid;

  insert into public.members (space_id, user_id, display_name)
  values (sid, uid, trim(my_name));

  return sid;
end $$;

create or replace function public.join_space(code text, my_name text)
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

  insert into public.members (space_id, user_id, display_name)
  values (sid, uid, trim(my_name));

  update public.spaces set invite_code = null where id = sid;

  return sid;
end $$;

-- ─── Content ───────────────────────────────────────────────────────────

create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  full_name  text not null check (char_length(full_name) between 1 and 200),
  phones     text[] not null default '{}',
  emails     text[] not null default '{}',
  company    text,
  address    text,
  -- Year 1604 means "year unknown" (the same convention iOS uses in vCards).
  birthday   date,
  notes      text,
  tags       text[] not null default '{}',
  favorite   boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_space_idx on public.contacts (space_id);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  sender_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body       text check (char_length(body) <= 4000),
  -- A snapshot of a contact card shared in chat (not a live reference).
  contact    jsonb,
  created_at timestamptz not null default now(),
  constraint message_has_content
    check (nullif(trim(body), '') is not null or contact is not null)
);
create index messages_space_created_idx on public.messages (space_id, created_at desc);

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  title      text not null default '' check (char_length(title) <= 200),
  body       text not null default '' check (char_length(body) <= 20000),
  pinned     boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_space_idx on public.notes (space_id);

create table public.lists (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  emoji      text check (char_length(emoji) <= 16),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, space_id)
);

create table public.list_items (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null,
  list_id    uuid not null,
  text       text not null check (char_length(text) between 1 and 500),
  done       boolean not null default false,
  due_date   date,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Composite key: an item can't point at a list in a different space.
  foreign key (list_id, space_id) references public.lists (id, space_id) on delete cascade
);
create index list_items_space_idx on public.list_items (space_id);
create index list_items_list_idx on public.list_items (list_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- ─── Access control ────────────────────────────────────────────────────

alter table public.spaces     enable row level security;
alter table public.members    enable row level security;
alter table public.contacts   enable row level security;
alter table public.messages   enable row level security;
alter table public.notes      enable row level security;
alter table public.lists      enable row level security;
alter table public.list_items enable row level security;

-- Start from nothing, then grant exactly what the app uses.
revoke all on public.spaces, public.members, public.contacts, public.messages,
              public.notes, public.lists, public.list_items
  from anon, authenticated;

grant select on public.spaces, public.members to authenticated;
grant update (name) on public.spaces to authenticated;
grant update (display_name) on public.members to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, update, delete
  on public.contacts, public.notes, public.lists, public.list_items
  to authenticated;

create policy "members read their space" on public.spaces
  for select to authenticated using (public.is_member(id));
create policy "members rename their space" on public.spaces
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "members see each other" on public.members
  for select to authenticated using (public.is_member(space_id));
create policy "you can rename yourself" on public.members
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member(space_id));
create policy "members send as themselves" on public.messages
  for insert to authenticated
  with check (public.is_member(space_id) and sender_id = (select auth.uid()));
create policy "senders delete their own messages" on public.messages
  for delete to authenticated
  using (public.is_member(space_id) and sender_id = (select auth.uid()));

-- Contacts, notes, lists and list items: both members can do anything.
do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'notes', 'lists', 'list_items'] loop
    execute format(
      'create policy "members read" on public.%I for select to authenticated
         using (public.is_member(space_id))', t);
    execute format(
      'create policy "members add" on public.%I for insert to authenticated
         with check (public.is_member(space_id) and created_by = (select auth.uid()))', t);
    execute format(
      'create policy "members edit" on public.%I for update to authenticated
         using (public.is_member(space_id)) with check (public.is_member(space_id))', t);
    execute format(
      'create policy "members remove" on public.%I for delete to authenticated
         using (public.is_member(space_id))', t);
  end loop;
end $$;

revoke execute on function public.create_space(text, text), public.join_space(text, text)
  from public, anon;
grant execute on function public.create_space(text, text), public.join_space(text, text)
  to authenticated;
revoke execute on function public.gen_invite_code() from public, anon, authenticated;

-- ─── Realtime ──────────────────────────────────────────────────────────

-- Stream changes to the app. Realtime applies the policies above, so each
-- person only receives rows from their own space.
alter publication supabase_realtime add table
  public.spaces, public.members, public.contacts, public.messages,
  public.notes, public.lists, public.list_items;

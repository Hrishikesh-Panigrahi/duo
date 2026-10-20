-- Vanish mode.
--
-- Either member can turn vanish mode on for their space. Messages sent while
-- it's on vanish once they've been seen: the person they were sent to marks
-- them seen (a photo or video counts as seen once it's opened), and the app
-- deletes the seen ones whenever either person opens or leaves the chat.
-- Messages sent before it was turned on are kept. Whether a message vanishes
-- is decided here, from the space, when it's sent.

alter table public.spaces add column vanish_mode boolean not null default false;

alter table public.messages
  add column vanishing boolean not null default false,
  add column seen_at timestamptz;

-- ─── Sending ───────────────────────────────────────────────────────────

-- The app can't choose: a new message vanishes exactly when its space is in
-- vanish mode, and starts unseen. A message re-encrypted by the one-time
-- upgrade keeps its old time: it was sent before, so it doesn't vanish.
create function public.vanish_by_space_mode() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.vanishing := new.created_at >= now()
    and coalesce((select vanish_mode from public.spaces where id = new.space_id), false);
  new.seen_at := null;
  return new;
end $$;

revoke execute on function public.vanish_by_space_mode() from public, anon, authenticated;

create trigger messages_vanish_by_space_mode before insert on public.messages
  for each row execute function public.vanish_by_space_mode();

-- ─── Turning it on and off ─────────────────────────────────────────────

create function public.set_vanish_mode(space uuid, turn_on boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(space) then
    raise exception 'You are not in that space';
  end if;
  update public.spaces set vanish_mode = turn_on where id = space;
end $$;

-- ─── Seeing and clearing ───────────────────────────────────────────────

-- Only the person a message was sent to can mark it seen. Photos and videos
-- aren't marked here: opening one (mark_media_opened) is what counts.
create function public.mark_vanishing_seen(message_ids uuid[])
returns void
language sql security definer set search_path = '' as $$
  update public.messages
  set seen_at = now()
  where id = any (message_ids)
    and vanishing
    and not has_media
    and seen_at is null
    and sender_id <> (select auth.uid())
    and public.is_member(space_id);
$$;

-- Deletes the space's vanishing messages that have been seen, and photos and
-- videos that expired unopened (the app keeps them 24 hours: MEDIA_TTL_HOURS in
-- src/lib/media.ts), since those can never be seen. Returns how many.
create function public.clear_seen_vanishing(space uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  removed integer;
begin
  if not public.is_member(space) then
    raise exception 'You are not in that space';
  end if;
  delete from public.messages
  where space_id = space
    and vanishing
    and (
      seen_at is not null
      or media_opened_at is not null
      or (has_media and created_at < now() - interval '24 hours')
    );
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.set_vanish_mode(uuid, boolean), public.mark_vanishing_seen(uuid[]),
  public.clear_seen_vanishing(uuid) from public, anon;
grant execute on function public.set_vanish_mode(uuid, boolean), public.mark_vanishing_seen(uuid[]),
  public.clear_seen_vanishing(uuid) to authenticated;

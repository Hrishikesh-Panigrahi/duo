# Architecture

## The shape of it

Duo is a static PWA. Encryption and nearly all app logic run on the phone. Supabase stores the ciphertext and
plaintext metadata (ids, who wrote what, timestamps, media flags), enforces access, and runs a few SQL functions:
creating and joining a space, `enable_space_e2e`, swapping legacy messages, and marking media opened.

```
phone A ──HTTPS/WSS──▶ Supabase (Postgres + RLS, Auth, Storage, Realtime) ◀──HTTPS/WSS── phone B
   └──────────────── WebRTC data channel (direct photos and videos) ─────────────────────┘
          (set up over the private Realtime room; STUN at stun.cloudflare.com, no relay)
```

**Deployment** (configured outside this repo): Cloudflare Pages builds `main` with `npm run build` and serves
`dist/`, applying `dist/_headers`. The Supabase project's migrations are applied by running each file in
`supabase/migrations/` in order: in the SQL editor, or with `supabase db push`. Locally, `npx supabase start`
applies them.

## Who reads what

Inside a space, screens get data and actions from `useSpace()` ([src/lib/store.tsx](../src/lib/store.tsx)), except
sign-out, which goes through `signOut()` in `src/lib/session.ts`. A few places work outside the open space and
call Supabase directly:
- sign-in and password reset (`auth.tsx`);
- creating or joining a space (`space-setup.tsx`);
- listing your spaces and summarising them for the switcher (`src/lib/spaces.ts`).

`SpaceProvider` (through `useSpaceStore`) wires together these modules from `src/lib/space/`, and `useSpace()` reads
the result. `shapes.ts` is used by `view.ts`.

| Module | Job |
| --- | --- |
| `rows.ts` | Rows as stored (ciphertext, or plaintext legacy columns), plus messages still being sent. The reducer, `MESSAGE_LIMIT` (500), and the `CLEARED` and `legacy` helpers. |
| `sync.ts` | `SpaceSync`: loads the space, its members, every content table and the newest 500 messages, then follows Realtime `postgres_changes`. Reloads on every (re)subscribe. Drops inserts and updates for other spaces; DELETEs carry no `space_id`, so all are passed on, and an unknown id is a no-op. |
| `device-key.ts` | This device's `CryptoKey`: from IndexedDB `duo-keys` if saved, otherwise only in memory. Checked against `spaces.e2e_check`. |
| `plaintext.ts` | A cache of decrypted values, keyed by `context|cipher`, so each ciphertext is opened once. |
| `view.ts` | `pendingDecryptions` lists what still needs opening, and checks each result against `shapes`. `deriveView` turns rows and plaintext into what screens show. |
| `shapes.ts` | The shape each decrypted record must have. Anything else counts as undecryptable. |
| `store-actions.ts` | `RowWriter`: `seal`, `insertSealed`, `updateSealed`, `deleteRow`, and `upsertLocally` / `removeLocally` for this device's copy only. `StoreActions` is the base class for every action group. |
| `*-actions.ts` | `useSpace().actions.chat / contacts / notes / lists / names / encryption`. |
| `room.ts` | `Room`: the private Realtime channel `room:<space id>` for presence, typing and sealed WebRTC signalling. `PresenceGate` throttles presence. |

## Several spaces

- **Which one opens:** `App.tsx` loads your spaces in the order you joined them, and opens the one last opened on
  this device (`duo:space` in local storage) if it's still yours, otherwise the one you joined first.
- **Switching:** `SpaceProvider` is keyed by the space id, so switching starts the store, the room and the key
  afresh. Only the open space has a room, so you show as online only there, and direct transfers only reach you
  there; in other spaces photos wait in Storage.
- **The switcher** opens from the space name in the header, or from "Switch space" on the passphrase setup and
  unlock screens when you're in two or more spaces. For each space it shows:
  - its name and your person's, decrypted with that space's key saved on this device (`duo-keys`). A space with
    encryption on whose key isn't saved here shows as locked; one with encryption off shows any plaintext names it
    still has;
  - unread messages: theirs newer than this device's last-read time for that space. That time is set when the
    space's main screen first opens here and moves forward while its Chat tab is open, so a space never opened past
    the unlock screen on this device shows none.
- **Invites:** an invite link opened while signed in tries to join that space straight away, alongside the spaces
  you're in. The server refuses it if you're already in 20, or if it's your own space's code.
- **Each space keeps its own:** passphrase and key (`duo-keys` holds one per space), upgrade flag, last-read time
  and member row. Waiting photos (`duo-inbox`) are shared by every space. A space's sweep removes one only when its
  own loaded message was opened or is more than 24 hours old, or the file itself is more than 24 hours old; a file
  also goes when a message with its id is deleted, or on sign-out.

## Writing rows

- **New rows:** `RowWriter.insertSealed` seals the content under the row's `contexts.*` string and remembers the
  plaintext, so the new row needs no decryption. It then inserts the row, and upserts what the server returns.
- **Edits:** `RowWriter.updateSealed` upserts the change straight away and rolls it back if the server refuses it.
- **Messages:** these go through `ChatActions.sendContent` instead. It calls `encryptMessage`, shows a pending row,
  inserts, then confirms. Message inserts may only set `id, space_id, cipher, has_media, media_direct`; the server
  sets the sender and the time.
- **Contact import:** seals each contact and inserts them in batches of 200.

Other devices get each change over Realtime and decrypt it themselves.

## Encryption

[src/lib/e2e.ts](../src/lib/e2e.ts):

- **The key:** the passphrase is NFKC-normalised and run through PBKDF2-SHA256 (600,000 iterations) with the
  space's random `e2e_salt`. The result is a non-extractable AES-256-GCM key.
- **Formats:** text is `v1:<iv>:<ciphertext>` in base64. Files are a version byte `1`, a 12-byte IV, then the
  ciphertext. There's no padding, so sizes are exact.
- **Contexts:** each ciphertext is sealed to a context (AES-GCM additional data), such as `duo:contact:<space>:<id>`.
  A ciphertext copied into another row, field or space won't decrypt.
- **The check value:** `spaces.e2e_check` is a known string sealed under `contexts.check`. It tells a mistyped
  passphrase from the right one without revealing either. Like any ciphertext, it also lets someone with a copy of
  the database test passphrase guesses offline. PBKDF2 makes each guess slow, and the strength rules in
  `passphrase.ts` reject easily guessed passphrases when one is chosen.
- **Turning it on:** `enable_space_e2e` sets the named space's salt and check once, and clears its plaintext name.
  It refuses if they're already set, you aren't in that space, or their lengths are out of range.
- **The one-time upgrade:** the setup form encrypts the space name and this user's name straight after
  `enable_space_e2e`. The device that turned encryption on also keeps a `duo:upgrade:<space>` flag in local storage (only
  in memory if local storage is unavailable). Until `upgradeLegacy` succeeds, it runs each time the main screen
  opens and re-encrypts:
  - the loaded contacts, notes, lists and list items;
  - this user's own loaded messages, each swapped by `encrypt_legacy_message`;
  - the two names, if they are still plaintext in memory.

  It doesn't upgrade the partner's old messages, or messages older than the newest 500. Those stay plaintext in the
  database and are hidden from the screens. The partner sets their name again on the name screen.

## Photos and videos

- **Preparing:** `media.ts` only accepts `PLAYABLE_TYPE` files: images other than SVG, and videos. Photos are
  re-encoded as JPEG at quality 0.82, scaled down so the longest edge is at most 1600 px (never up). Videos, and photos the browser can't redraw, are
  sent as they are, up to 45 MiB.
- **Direct:** `ChatActions` sends a file through `Room` and `DirectLink` when the partner's presence says `direct`
  (app open, unlocked, WebRTC available). If that fails, it uses Storage instead.
  - The offer, answer and ICE candidates are sealed with `contexts.signal`.
  - The encrypted file goes in 16 KiB chunks.
  - `FileAssembler` refuses a bad header (a message id that isn't a UUID, or a size that isn't a whole number from 1 byte to 50 MiB), a chunk that isn't binary, and more bytes than
    the header promised.
  - The receiver keeps the file, still encrypted, in IndexedDB `duo-inbox`. It's removed when opened, at the next
    sweep after it expires, when its message is deleted, or on sign-out.
- **Stored:** otherwise the encrypted file is uploaded to the private Storage bucket `media` at
  `<space id>/<message id>`, declared as `application/octet-stream`.
- **Opening:** the receiver decrypts the file. The blob gets the sender's type only if it matches `PLAYABLE_TYPE`,
  otherwise `application/octet-stream`.
- **Deleting:** when the recipient opens a file, `deleteViewedMedia` deletes it, then calls `mark_media_opened`. Each
  time the main screen opens (`ShellReady` mounts), `sweepMedia` also removes files whose loaded message was opened
  or is more than 24 hours old.
  - A Storage file with no loaded message is removed once the file itself is more than 24 hours old. Only the first
    1000 files are listed.
  - An inbox file whose message isn't loaded here may belong to another space, so it's removed only once it's more
    than 24 hours old.

  Nothing on the server deletes or expires files, and the read policy doesn't check age.

## Vanish mode

Either person turns it on or off for the space in Settings (`set_vanish_mode`); a banner in the chat shows while
it's on.

- **What vanishes:** messages sent while it's on. A trigger sets `messages.vanishing` from the space when a message
  is sent, so the sending app can't send a non-vanishing message while it's on. A message the one-time upgrade
  re-inserts keeps its old time and doesn't vanish. Messages sent before vanish mode was turned on are kept.
- **Seen:** the person a message was sent to marks it seen (`mark_vanishing_seen`, which sets `seen_at`) once at
  least half of it is in view in the chat list, with no sheet or photo viewer open over it, while the Chat tab is
  open and the app is on screen. Any of their devices can do this. A message this device can't decrypt isn't
  marked. A photo or video counts as seen once it's opened.
- **Deleted:** when a device comes into the chat or leaves it while it has any vanishing message loaded, it calls
  `clear_seen_vanishing` (failures are ignored). That deletes the space's seen vanishing messages on the server, and
  vanishing photos and videos that expired unopened (after 24 hours). Marking seen and deleting are done by the apps.
- **What never vanishes:** a message nobody has seen yet, one this device can't decrypt, and one older than the
  newest 500 messages, which isn't loaded.
- **A visit** (`ChatVisit` in `src/lib/vanish.ts`) lasts from opening the chat until you leave it. Leaving means:
  - another tab, another space, locking or signing out;
  - the app out of view for 30 seconds or more (`AWAY_AFTER_MS` in `src/features/chat.tsx`). A shorter trip, such as
    picking a photo, doesn't count;
  - sheets and the photo viewer don't end a visit.
- **What a visit shows:**
  - A vanishing message that was already seen when it first appears in a visit is hidden.
  - One seen during the visit, by the server's record or by this device, stays on screen until you leave, even if
    it's deleted meanwhile.
  - One you delete yourself, or one deleted before anyone saw it, goes at once.
  - This compares states, not clocks, so a phone's wrong time can't make messages vanish early or stay.
- **Known gap:** coming back after a long time away, the new visit can start before the reload brings fresh rows. A
  message seen meanwhile may then show for that visit, or appear briefly before its deletion arrives.

## Database

[supabase/migrations/](../supabase/migrations/), in order:

1. **`init`:**
   - Tables: spaces, members (at most two, joined by invite code), contacts, messages, notes, lists, list items.
   - RLS is enabled on all of them.
   - All table privileges are revoked from `anon` and `authenticated`, then only what the app uses is granted back.
   - Members-only policies use `is_member`, a `security definer` helper so policies don't recurse.
2. **`e2e_messages`:** `e2e_salt` and `e2e_check`, `enable_e2e`, and the ciphertext-only check on messages.
3. **`e2e_everything`:**
   - `cipher` columns and ciphertext-only checks on contacts, notes, lists and list items.
   - `name_cipher` / `display_name_cipher`, with checks that the plaintext name is null.
   - Name-less `create_space()` and `join_space(code)`.
   - `encrypt_legacy_message`, view-once media, the `media` bucket and its policies (`can_access_media`).
4. **`direct_media`:**
   - `media_direct`.
   - Message inserts limited to five columns.
   - The members-only room policies (`can_use_room`).
   - `enable_e2e` and `join_space` now clear an older space's plaintext name.
   - `is_member` and `can_access_media` executable by signed-in users only.
5. **`many_spaces`:**
   - Drops the one-space-per-account rule (`members_user_id_key`) and indexes `members.user_id` instead.
   - `create_space` and `join_space` refuse a new space once you're in 20, taking one person's calls in turn (an
     advisory lock) so simultaneous calls can't get past the cap. `join_space` also refuses your own space's code.
   - `enable_space_e2e(space, salt, check_value)`. The older `enable_e2e(salt, check_value)` now works only for
     an account in exactly one space, for app versions from before this migration.
6. **`vanish_mode`:**
   - `spaces.vanish_mode`, and `messages.vanishing` / `messages.seen_at`.
   - A trigger sets `vanishing` from the space on every insert (false for a message re-inserted with an older
     time), and starts `seen_at` empty.
   - `set_vanish_mode` (members only); `mark_vanishing_seen` (the recipient only, not photos or videos);
     `clear_seen_vanishing` (members only), which also deletes vanishing photos and videos that expired unopened.
     All three are callable by signed-in users only.

All the ciphertext-only checks are `NOT VALID`: every new insert or update must pass, but rows from before
encryption are left alone. Content rows are upgraded in place. Messages can't be updated, so they're swapped for
an encrypted copy instead.

## Locking and sign-out

- **Locking** ("Lock this device" in Settings) deletes this device's saved key, clears the key from memory and drops
  the plaintext cache. The app then shows the unlock screen.
- **Sign out** through the app runs `signOut()`, which clears `duo-keys` and `duo-inbox` and then ends the session.
  A session that ends any other way, such as expiring, clears nothing.

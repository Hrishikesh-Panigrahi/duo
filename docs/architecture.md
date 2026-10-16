# Architecture

## The shape of it

Duo is a static PWA. Encryption and nearly all app logic run on the phone. Supabase stores the ciphertext and
plaintext metadata (ids, who wrote what, timestamps, media flags), enforces access, and runs a few SQL functions:
creating and joining a space, `enable_e2e`, swapping legacy messages, and marking media opened.

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
sign-out, which goes through `signOut()` in `src/lib/session.ts`. Before a space exists, a few places call Supabase
directly:
- sign-in and password reset (`auth.tsx`);
- creating or joining a space (`space-setup.tsx`);
- finding the user's space (`App.tsx`).

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
| `records.ts` | `Records`: `seal`, `insertSealed`, `updateSealed`. `StoreActions` is the base class for every action group. |
| `*-actions.ts` | `useSpace().actions.chat / contacts / notes / lists / names / encryption`. |
| `room.ts` | `Room`: the private Realtime channel `room:<space id>` for presence, typing and sealed WebRTC signalling. `PresenceGate` throttles presence. |

## Writing rows

- **New rows:** `Records.insertSealed` seals the content under the row's `contexts.*` string and remembers the
  plaintext, so the new row needs no decryption. It then inserts the row, and upserts what the server returns.
- **Edits:** `Records.updateSealed` upserts the change straight away and rolls it back if the server refuses it.
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
- **Turning it on:** `enable_e2e` sets the salt and check once, and refuses if they're already set.
- **The one-time upgrade:** the setup form encrypts the space name and this user's name straight after
  `enable_e2e`. The device that turned encryption on also keeps a `duo:upgrade:<space>` flag in local storage (only
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
- **Deleting:** when the recipient opens a file, `finishMedia` deletes it, then calls `mark_media_opened`. Each
  time the main screen opens (`ShellReady` mounts), `sweepMedia` also removes files whose loaded message was opened
  or is more than 3 days old.
  - A Storage file with no loaded message is removed once the file itself is more than 3 days old. Only the first
    1000 files are listed.
  - An inbox file with no loaded message is removed once it's more than 3 days old, or more than 10 minutes old and
    newer than the oldest loaded message.

  Nothing on the server deletes or expires files, and the read policy doesn't check age.

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

All the ciphertext-only checks are `NOT VALID`: every new insert or update must pass, but rows from before
encryption are left alone. Content rows are upgraded in place. Messages can't be updated, so they're swapped for
an encrypted copy instead.

## Locking and sign-out

- **Locking** ("Lock this device" in Settings) deletes this device's saved key, clears the key from memory and drops
  the plaintext cache. The app then shows the unlock screen.
- **Sign out** through the app runs `signOut()`, which clears `duo-keys` and `duo-inbox` and then ends the session.
  A session that ends any other way, such as expiring, clears nothing.

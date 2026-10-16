# Architecture

## The shape of it

Duo is a static PWA. All logic runs on the phone; Supabase stores ciphertext and enforces who may touch it.

```
phone A ──HTTPS/WSS──▶ Supabase (Postgres + RLS, Auth, Storage, Realtime) ◀──HTTPS/WSS── phone B
   └──────────────── WebRTC data channel (direct photos and videos) ─────────────────────┘
                     (set up over the private Realtime room; STUN only, no relay)
```

- **Hosting:** Cloudflare Pages project `our-duo` builds `main` (`npm run build` → `dist/`). Every branch also
  gets a preview at `<branch>.our-duo.pages.dev`, pointed at the live database.
- **Database:** Supabase project `duo` (Mumbai, Free plan). Migrations are pasted into the SQL editor in filename
  order. Locally, `npx supabase start` applies them for you.

## Data flow inside the app

`useSpace()` in [src/lib/store.tsx](../src/lib/store.tsx) is the only thing screens read. It wires together:

| Module (`src/lib/space/`) | Job |
| --- | --- |
| `rows.ts` | The rows exactly as stored (ciphertext), and a reducer for changes. `MESSAGE_LIMIT` is 500. |
| `sync.ts` | `SpaceSync`: first load, then Realtime `postgres_changes` for every table. Reloads on every (re)subscribe. |
| `device-key.ts` | This device's `CryptoKey` for the space, from IndexedDB `duo-keys`, checked against `spaces.e2e_check`. |
| `plaintext.ts` | A cache of decrypted values, keyed by `context|cipher`, so each ciphertext is opened once. |
| `view.ts` | `pendingDecryptions` finds what still needs opening. `deriveView` turns rows plus plaintext into what screens show. |
| `shapes.ts` | Checks a decrypted value has the shape its screen expects. Anything else counts as undecryptable. |
| `records.ts` | `Records`: the shared ways to seal and write rows. `StoreActions` is the base class for every action group. |
| `*-actions.ts` | `useSpace().actions.chat / contacts / notes / lists / names / encryption`. |
| `room.ts` | `Room`: the private Realtime channel `room:<space id>` for presence, typing and sealed WebRTC signalling. `PresenceGate` throttles presence. |

Writing a row: an action calls `Records.insertSealed` (or `seal` and then update). It encrypts under the
right `contexts.*` string, remembers the plaintext so the screen updates at once, writes the ciphertext, and
upserts the stored row. Other devices get the change over Realtime and decrypt it themselves.

## Encryption

[src/lib/e2e.ts](../src/lib/e2e.ts):

- The passphrase, normalised with NFKC, goes through PBKDF2-SHA256 with 600,000 iterations and the space's random
  `e2e_salt`. The result is a **non-extractable** AES-256-GCM key, kept in IndexedDB on that device.
- Text: `v1:<iv>:<ciphertext>`, base64. Files: version byte `1`, a 12-byte IV, then the ciphertext.
- Every ciphertext is sealed to its **context** (AES-GCM additional data), such as `duo:contact:<space>:<id>`.
  A ciphertext copied into another row, field or space won't decrypt.
- `spaces.e2e_check` is a known string sealed under `contexts.check`. It tells a mistyped passphrase apart from the
  right one without the server learning anything.
- Turning encryption on (`enable_e2e`) sets the salt once and refuses if it's already set. The device that turns it
  on upgrades older plaintext rows once. The `duo:upgrade:<space>` flag in local storage tracks that upgrade.

## Photos and videos

- `media.ts` shrinks photos (longest edge 1600 px, JPEG 0.82) and checks sizes (45 MB). Only `PLAYABLE_TYPE`
  types are accepted: images (never SVG) and videos.
- **Direct:** if the other person is online and can take a direct transfer, `DirectLink` opens a WebRTC data
  channel. The offer, answer and ICE candidates are sealed with `contexts.signal`. The encrypted file goes over
  in 16 KB chunks. `FileAssembler` refuses a bad header, a chunk that isn't binary, or more bytes than the header
  promised. The receiver keeps the file, still encrypted, in IndexedDB `duo-inbox` until it's opened.
- **Stored:** otherwise, the encrypted file goes to the private Storage bucket `media` at `<space id>/<message id>`
  (served as raw bytes only). It's deleted once opened (`mark_media_opened`) or after 3 days.

## Database

[supabase/migrations/](../supabase/migrations/), in order:

1. `init`: spaces, members (two at most, joined by invite code), contacts, messages, notes, lists, list items.
   RLS starts by revoking everything, then grants exactly what the app uses. `is_member` is a `security definer`
   helper so policies don't recurse.
2. `e2e_messages`: `e2e_salt` / `e2e_check`, `enable_e2e`, and ciphertext-only messages.
3. `e2e_everything`: a `cipher` column and ciphertext-only check on every content table and on names.
   `encrypt_legacy_message`, view-once media, the `media` bucket and its policies (`can_access_media`).
4. `direct_media`: records which way a file went, the members-only Realtime room policies, a fix for encrypting
   older spaces, and least-privilege grants on helpers.

The ciphertext-only checks are `NOT VALID`: they apply to every new insert or update, but leave rows from before
encryption alone so the app can upgrade them in place.

## Sign-out and locking

`signOut()` clears `duo-keys` and `duo-inbox` before signing out. Locking forgets the key and the plaintext
cache, so the screens empty at once.

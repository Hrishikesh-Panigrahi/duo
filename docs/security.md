# Security

Security is Duo's first priority. Protection must stay **invisible**. Today a person sees three security steps:
- signing in to their account;
- the shared passphrase;
- "Lock this device" in Settings.

Nothing else should be added for them to see or do.

## What the server can see

New content is ciphertext, and nothing is padded, so sizes are **exact**. Some old rows can stay plaintext in a
space that had content before encryption: the other member's old messages, and messages older than the newest 500
(see the one-time upgrade in [architecture.md](architecture.md)).

Everything else is visible to Supabase, or to anyone with database or dashboard access:
- login emails, who shares a space, the invite code, the salt and the check value;
- each device's IP address and user agent, on every request and Realtime connection;
- who wrote each row (`sender_id`, `created_by`), when (`created_at`, and `updated_at` for contacts and notes), how
  many rows there are, and which list each item is on;
- which messages are photos or videos, whether each went direct, and when it was opened;
- through Realtime: when each person has the app open, whether their device is unlocked (presence `direct`),
  typing pings, and the timing of transfer setup.

Cloudflare's STUN server (`stun.cloudflare.com`) sees both phones' IP addresses when a direct transfer is set up.

## What the code defends against

| Who | What stops them | What it doesn't stop |
| --- | --- | --- |
| Anyone on the network | TLS to Supabase and the host (HSTS is set in production). Content is end-to-end encrypted, and each ciphertext is bound to its context | Traffic timing, sizes and endpoints, including the two phones' IPs during a direct transfer |
| Supabase, or anyone with database or dashboard access | Content is ciphertext bound to its context. Once the space has `e2e_salt`, content rows without ciphertext are hidden. Decrypted records must match `shapes` | See the list below the table |
| A stranger with an account | RLS on every table, Storage policies, members-only room policies, column-limited message inserts. The RPCs and helpers check the caller's membership themselves | Until the second person joins, anyone with the invite code can join the space. Any account can subscribe to DELETE events (row ids and timing) for every space |
| Someone with one person's login but not the passphrase | Everything they can read is ciphertext. Room signals must be sealed with the space key, so theirs are ignored | See the list below the table |
| Hostile content (a .vcf, a message, a file) | React escapes all text, and there's no `dangerouslySetInnerHTML`. Links use fixed forms only. Files are shown only in `<img>` or `<video>`, as a blob typed with the sender's type only if `PLAYABLE_TYPE` matches. The CSP (production and preview only) blocks inline and third-party scripts | — |

**Not stopped: Supabase, or anyone with database or dashboard access.**
- Deleting rows or files.
- Re-inserting a deleted row with its old id and ciphertext, which decrypts again.
- Rolling a row back to an older ciphertext of the same row (every edit reuses its context).
- Editing plaintext columns such as timestamps, `created_by` and the media flags.
- Faking presence and typing, which aren't sealed.
- Replacing `e2e_salt` / `e2e_check`, which locks both devices out.
- Clearing `e2e_salt`, which sends both apps back to the setup screen (see below).

**Not stopped: someone with one person's login but not the passphrase.**
- Deleting or overwriting contacts, notes, lists and items, or rolling them back to an older ciphertext they've
  seen, or re-inserting deleted ones.
- Deleting that person's own messages, and any Storage file in the space.
- Overwriting the space name and that person's display name.
- Posting messages that show as "Couldn't decrypt this message".
- Marking view-once media sent to that person as opened.
- Faking typing and presence.
- Setting the passphrase with `enable_e2e` if encryption isn't on yet.

**Clearing `e2e_salt`.** `Shell` decides whether to show the setup screen from `spaces.e2e_salt` alone. Setting
up again makes a new salt, so the old ciphertext stops decrypting. It also arms the one-time upgrade, which then
adopts every plaintext contact, note, list and item, the space name, this member's name, and this member's own
recent messages. No code notices that the space was encrypted before. The saved key stays in `duo-keys` until a
new check value fails to match it.

**Out of scope:**
- screenshots or another camera;
- an unlocked phone in the wrong hands;
- a weak passphrase (obvious ones are refused);
- anyone who takes over the Cloudflare or GitHub account and ships different code.

## Rules the code keeps, and what tests them

| # | Rule | Where | Tested by |
| --- | --- | --- | --- |
| 1 | Content fields are encrypted before they leave the device. Each table with encrypted content has a `NOT VALID` check that its plaintext columns are empty (and, on content tables, that `cipher` is set). | `e2e.ts`, `store-actions.ts`, `*-actions.ts`, migrations | `e2e.test.ts` round-trips the encryption functions. Nothing tests that the write paths send only ciphertext, and the database checks have no automated test |
| 2 | Existing `contexts.*` strings, the `v1:` format and file version `1` never change. | `e2e.ts` | `e2e.test.ts` pins every context label, and `room.test.ts` the `v1:` prefix; mutant for a label. The file version byte `1` isn't pinned: a consistent change still passes, but stored files stop opening |
| 3 | Every context includes the space id. Rows add their id; messages and media add the sender. | `e2e.ts` `contexts` | `e2e.test.ts`: messages moved to another sender, space or id; files to another id; records to another row, list, field or space; wrong passphrase; tampering |
| 4 | Once `e2e_salt` is set, content rows and messages without ciphertext are dropped, and plaintext space and member names read as null. Only the one-time upgrade on the device that turned encryption on adopts such rows: content rows, the names, and its own messages. | `view.ts`, `encryption-actions.ts` | `view.test.ts`; a mutant for content rows and names. The message case has no mutant, and the upgrade has no test |
| 5 | Decrypted records the screens show must match `shapes`. Anything else is undecryptable: messages say "Couldn't decrypt this message", other records are hidden, and names read as null. Signals get no shape check; only their timestamp and addressing are checked (below). | `shapes.ts`, `view.ts` | `shapes.test.ts`; mutant |
| 6 | Signals are sealed with `contexts.signal`. They're refused if longer than 64,000 characters, or if their timestamp is more than `SIGNAL_MAX_AGE_MS` (2 min) from this device's clock, in either direction. So phones whose clocks differ by 2 minutes or more can't transfer directly. | `room.ts` | `room.test.ts` (past and future timestamps, forgery, junk, size); mutants |
| 7 | A signal counts only if it's addressed to this user and claims to come from the other member. An offer is taken only while fewer than `MAX_INCOMING` (4) transfers, in either direction, are active. | `direct.ts` `handleSignal` | `direct.test.ts` (addressing, the cap of four, outgoing transfers counting towards it); mutants |
| 8 | A transfer header names a UUID and a whole-number size from 1 byte to 50 MiB. Chunks must be binary, and no larger in total than the header said. | `direct.ts` | `direct.test.ts`; mutants |
| 9 | Only `PLAYABLE_TYPE` files can be sent. On opening, a blob gets the sender's type only if it matches, otherwise `application/octet-stream`. The `media` bucket only accepts uploads declared as `application/octet-stream`. | `media.ts`, `chat-actions.ts`, migrations | `media.test.ts` (the pattern and the send refusal) and `chat-actions.test.ts` (the opening fallback); mutants. The bucket rule has no automated test |
| 10 | Keys are derived non-extractable. They're kept in IndexedDB `duo-keys` (or only in memory), and in memory while unlocked. The app's Sign out tries to clear `duo-keys` and `duo-inbox`; if that fails, it signs out anyway. | `e2e.ts`, `keystore.ts`, `session.ts` | `e2e.test.ts` (can't be exported) and `session.test.ts` (sign-out clearing, even when it fails); mutants |
| 11 | Database and Storage errors go through `serverError` / `must`, so no database details are shown. Auth errors from `auth.tsx` are shown as Supabase Auth words them. | `supabase.ts` | `supabase.test.ts` |
| 12 | The CSP allows the app's own (`'self'`) scripts, styles, images, fonts, worker and manifest; `data:` and `blob:` images; `blob:` media; form posts to itself; and connections to the app and its own Supabase project. It's sent only by the production build (`dist/_headers`) and `npm run preview`, not by `npm run dev`. No source maps are built. | `vite.config.ts` | Nothing automated; check the branch preview |
| 13 | Presence changes are capped at `PRESENCE_MAX_PER_WINDOW` (4) per 30 s. The room rejoins with backoff from 1 s, doubling to 30 s. Typing pings (at most one per 2.5 s) and signals aren't budgeted. | `room.ts` | `room.test.ts`; mutants |

The live Realtime limit (about 5 presence changes per 30 s) is noted in `room.ts`; it isn't enforced by this repo.

## Adding something that stores data

1. In a new migration:
   - add a `cipher` column with a length limit, and a `check … not valid` that the plaintext columns stay empty;
   - enable RLS, `revoke all … from anon, authenticated`, grant only what the app uses, and add members-only
     policies. The init migration's revoke covers only its own seven tables, and new tables get the default grants.
2. Add a `contexts.*` entry that includes the space id and the row id.
3. Add a `shapes.*` entry and use it in `pendingDecryptions`.
4. Add tests (round trip, wrong context fails, malformed shape rejected) and a mutant in `scripts/mutate.py`.
5. Apply the migration to the live database before merging the frontend.

## Live project notes (observed in the dashboard, not in this repo)

- **Supabase Security Advisor, checked 2026-10-16:** 0 errors.
  - Its "signed-in users can execute SECURITY DEFINER" warnings cover the app's RPCs and RLS helpers. In the
    migrations, each of these checks the caller and sets `search_path = ''`.
  - `public.rls_auto_enable()` isn't created by any migration here. Supabase added it to turn RLS on for new tables.
  - Leaked-password protection was off.
- **Sign-ups:** the local `supabase/config.toml` allows email sign-ups (`enable_signup = true`). Turning them off on
  the live project after both people join is a dashboard setting.

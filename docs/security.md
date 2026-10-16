# Security

Security is the first priority for Duo. Defences must be **invisible**: the shared passphrase is the only
security step a person ever sees.

## What we protect against

| Who | What they can do | What stops them |
| --- | --- | --- |
| Anyone on the network | Watch or change traffic | TLS; end-to-end encryption; every ciphertext bound to its context, so changes fail to decrypt |
| Supabase, or anyone with database or dashboard access | Read, change, swap or plant rows and files | Ciphertext only, with contexts; once encrypted, rows without ciphertext are ignored; decrypted values must match `shapes` |
| A stranger with an account | Call the API with their own login | RLS on every table, Storage policies, private room policies, least-privilege grants |
| Someone with one partner's login but not the passphrase | Read rows, join the room, send signals | Everything is ciphertext; signals are sealed and refused if more than 2 minutes old; files are accepted only from the partner |
| Hostile content (a .vcf, a message, a file) | Try to run code or render markup | React escaping; a strict CSP; only image and video types are opened, never SVG |

**Out of scope** (say so honestly; don't claim it): screenshots or another camera, an unlocked phone in the wrong
hands, a weak passphrase (refused where obvious), and anyone who takes over the Supabase, Cloudflare or GitHub
account and ships different code.

**What the server still sees:** login emails, who shares a space, when rows change, and rough sizes.

## Invariants (break one and a test should fail)

1. **No plaintext leaves the device.** Every content field goes through `e2e.ts`, and the database gets a
   ciphertext-only check for every encrypted column.
2. **Context strings are permanent.** Don't edit `contexts.*`, the `v1:` text format or file version `1`. If a
   format must change, add a new version and keep reading the old one.
3. **Every context names what and where.** It always includes the space id. Rows add their id, and messages add
   the sender, so a ciphertext can't be replayed into another row, field, space or sender.
4. **Strict once encrypted.** When `spaces.e2e_salt` is set, `view.ts` never shows a row without ciphertext, and
   nothing is adopted from one.
5. **Decrypted isn't trusted.** Values pass `shapes.*` before a screen sees them. A mismatch counts as
   "couldn't decrypt".
6. **Direct transfers:** signals are sealed under `contexts.signal`, refused when older than `SIGNAL_MAX_AGE_MS` or
   longer than 64,000 characters, and accepted only from the partner. At most 4 incoming transfers at once. Files
   are limited to the size their header promised.
7. **Media types:** only `PLAYABLE_TYPE` is sent or opened. Anything else opens as `application/octet-stream`.
   The Storage bucket only accepts raw bytes.
8. **Keys are non-extractable** and live only in IndexedDB `duo-keys`. Sign-out clears it and `duo-inbox`.
9. **Errors never show database details.** Go through `serverError` / `must` in `supabase.ts`.
10. **Headers:** the CSP in `vite.config.ts` allows only the app's own code and its own Supabase origin. No inline
    scripts, no third-party origins, no source maps.
11. **Presence is throttled** (`PRESENCE_MAX_PER_WINDOW` per 30 s, under the server's limit) and the room rejoins
    with backoff, so the app can't get itself rate-limited.

## Adding something that stores data

1. Add a migration with a `cipher` column, a length limit and a ciphertext-only `check … not valid`.
2. Add RLS policies for members only, after the init migration's "revoke everything".
3. Add a `contexts.*` entry that includes the space id and the row id.
4. Add a `shapes.*` entry and use it in `pendingDecryptions`.
5. Add tests: round trip, wrong context fails, malformed shape rejected. Add a mutant in `scripts/mutate.py`.
6. Apply the migration to the live database before merging the frontend.

## Live project notes

- **Supabase Security Advisor** (checked 2026-10-16): 0 errors. The "signed-in users can execute SECURITY DEFINER"
  warnings are by design: they are the app's RPCs and RLS helpers, each checks the caller and sets
  `search_path = ''`.
- `public.rls_auto_enable()` was created by Supabase, not by our migrations. It's an event-trigger helper that
  turns RLS on for new tables. It's harmless; revoking its EXECUTE grant is cosmetic.
- Leaked-password protection is off (it may need a paid plan). It's optional.
- After both people have joined, turn off "Allow new users to sign up" in Supabase.
- The owner should keep two-factor sign-in on for Supabase, Cloudflare and GitHub.

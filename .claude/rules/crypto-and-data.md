---
paths:
  - "src/lib/**/*.{ts,tsx}"
---

# Encryption, sync and the store

See [docs/security.md](../../docs/security.md) for the rules and which tests cover them.

**Formats and contexts**
- Never edit an existing `contexts.*` string in `src/lib/e2e.ts`, the `v1:` text format or file version `1`.
  Stored data would stop decrypting, and only the `v1:` prefix is pinned by a test. To change a format, add a new
  version and keep reading the old one.
- A new context includes the space id, plus the row id for rows (and the sender for messages and media).

**Writing and reading content**
- New content is written through `RowWriter` (`seal`, `insertSealed`, `updateSealed`), or through
  `encryptMessage` / `encryptBytes` for messages and files. Never write a plaintext column.
- Every record type the screens show gets a `shapes.*` entry, used in `pendingDecryptions` (`view.ts`). Signals
  get no shape check: `room.ts` checks the timestamp and `direct.ts` the addressing, and the SDP and ICE data go to
  WebRTC as they are.
- Strict mode: once `e2e_salt` is set, a row without `cipher` is never shown. Only the one-time upgrade on the
  device that turned encryption on (`upgradeLegacy`) may adopt one.

**Keys, media and signals**
- Keys are derived non-extractable (the `false` argument in `deriveKey`). Never log, export or send a key,
  passphrase or plaintext.
- Media: only `PLAYABLE_TYPE` files are sent (`prepareMedia`). When opened, a file gets the sender's type only if
  it matches `PLAYABLE_TYPE`, otherwise `application/octet-stream` (`openMedia`).
- Signals: sealed with `contexts.signal`, with an age limit and a size limit. Offers are taken only when addressed
  to this user from the other member, while fewer than `MAX_INCOMING` transfers are active. Don't loosen
  `SIGNAL_MAX_AGE_MS`, the 64,000-character limit, `MAX_INCOMING` or `PRESENCE_MAX_PER_WINDOW` without a reason in the PR.

**Errors, tests and structure**
- Database and Storage errors go through `must` / `serverError`, so database details never reach the screen.
- Changing a security check? Update or add its mutant in `scripts/mutate.py`, and confirm it's CAUGHT.
- Actions belong in the matching `*-actions.ts` class (a `StoreActions` subclass) and are reached as
  `useSpace().actions.<area>`.
- A new `supabase.channel(...)` needs a name no other live channel uses; see the Realtime notes in docs/gotchas.md.

---
paths:
  - "src/lib/**/*.{ts,tsx}"
---

# Encryption, sync and the store

See [docs/security.md](../../docs/security.md) for the full list of invariants.

- Never edit an existing `contexts.*` string in `src/lib/e2e.ts`, the `v1:` text format or file version `1`.
  Stored data would stop decrypting. To change a format, add a new version and keep reading the old one.
- A new context must include the space id, plus the row id for rows (and the sender for messages).
- New content is written only through `Records` (`seal`, `insertSealed`) or the `encrypt*` functions. Never write
  a plaintext column.
- Every decrypted record type gets a `shapes.*` entry, used in `pendingDecryptions` (`view.ts`).
- Keep strict mode: once `e2e_salt` is set, a row without `cipher` is never shown or adopted.
- Keys stay non-extractable (the `false` extractable argument in `deriveKey`). Never log, export or send a key,
  passphrase or plaintext.
- Media: only `PLAYABLE_TYPE` types are sent or opened. Everything else opens as `application/octet-stream`.
- Signals: sealed with `contexts.signal`, with an age limit, a size limit, and files from the partner only.
  Don't loosen `SIGNAL_MAX_AGE_MS`, the 64,000-character limit, `MAX_INCOMING` or `PRESENCE_MAX_PER_WINDOW`
  without a reason in the PR.
- Server errors go through `must` / `serverError`, so database details never reach the screen.
- Changing a security check? Update or add its mutant in `scripts/mutate.py` and confirm it's CAUGHT.
- Actions belong in the matching `*-actions.ts` class (a `StoreActions` subclass) and are reached as
  `useSpace().actions.<area>`.
- A new top-level `supabase.channel(...)` needs a unique name; see the Realtime notes in docs/gotchas.md.

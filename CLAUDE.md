# Duo

A private, end-to-end encrypted PWA for two people: a shared contact book, chat, lists, notes and view-once
photos and videos. React 19 + Vite 8 + Tailwind 4 + TypeScript 7 on the front, Supabase (Postgres, auth,
storage, Realtime) behind it. The server only ever stores ciphertext. [README.md](README.md) is the
user-facing overview; this file is for working on the code.

## Commands

```bash
npm run dev          # http://localhost:5173 (needs .env.local, see README "Run it locally")
npm test             # vitest, node environment
npm run typecheck    # tsc --noEmit (TypeScript 7 native)
npm run build        # typecheck + production build into dist/, including dist/_headers
npm run preview      # serves dist/ with the real security headers on :4173
npx supabase start   # local stack in Docker; applies supabase/migrations
python scripts/mutate.py          # breaks each security check in turn; every one must be CAUGHT
node scripts/audit-style.cjs .    # function lengths, tiny helpers, repeated blocks
```

Before a PR: `npm run typecheck`, `npm test`, `python scripts/mutate.py`, `node scripts/audit-style.cjs .`.

## Where things are

- `src/lib/e2e.ts`: key derivation, sealing, and the `contexts` every ciphertext is bound to.
- `src/lib/store.tsx`: `useSpace()`. It only wires together the modules in `src/lib/space/`:
  rows, sync, device key, plaintext/view (decryption), room, records, `*-actions.ts`, and shapes.
- `src/lib/direct.ts`: phone-to-phone WebRTC transfer. `src/lib/inbox.ts` holds received files, still encrypted.
- `src/features/`: one file per screen or sheet. `src/components/`: shared UI, `useBusy`, the long-press menu.
- `supabase/migrations/`: schema, row-level security, ciphertext-only checks, the `media` bucket, the private room.
- `vite.config.ts`: CSP and security headers, written to `dist/_headers` for Cloudflare Pages.

More detail: [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md),
[docs/testing.md](docs/testing.md), [docs/gotchas.md](docs/gotchas.md). Path-scoped rules live in
[.claude/rules/](.claude/rules/) and load when you touch matching files.

## Non-negotiables

**Security**
- Nothing readable leaves the device. Every new field is encrypted with `encryptRecord` / `encryptMessage` /
  `encryptBytes` under a `contexts.*` string, and the database gets a ciphertext-only check for it.
- Never change an existing `contexts.*` string, the `v1:` format or the file version byte: every stored row
  would stop decrypting. Add a new context instead.
- Once a space has `e2e_salt`, a row without ciphertext is never shown or trusted. Decrypted records are checked
  against `shapes` before a screen sees them.
- Protection stays invisible. The shared passphrase is the only security step people see: no extra passwords,
  PINs, prompts or settings. Anything user-facing is a recommendation to the owner, not a feature.
- Never weaken the CSP in `vite.config.ts`, add a third-party origin, or turn on source maps.

**Code style**
- Functions, including components, are at most 29 lines. A longer one means the design needs splitting.
- Names explain the code. Comments are short and only say why something non-obvious is done.
- Extract a function or class only for a block of 4–5+ lines repeated more than three times. No one- or two-line
  helpers just to dedupe (the `contexts` one-liners stay because they centralise a security format).
- Match the surrounding code: small classes with short methods, `useSpace().actions.<area>.<verb>()`.

**Process**
- `main` deploys to production on push (Cloudflare Pages `our-duo`). Work on a branch and open a PR; the owner merges.
- A migration that new frontend code depends on is applied to the live database **before** that code is merged.
- Migrations are append-only: add a new file, never edit one that has been applied.
- Claim only what was tested, with a positive control for every "found nothing".
- No Claude attribution lines in commits or PR descriptions.

## Gotchas (short list; details in [docs/gotchas.md](docs/gotchas.md))

- Tailwind scans every non-gitignored file. New top-level folders of docs or scripts need an `@source not` line in
  `src/index.css`, or they add stray CSS. Compare CSS from a clean `git archive` build.
- The service worker serves the previous bundle on the first reload after a rebuild. Unregister it and clear
  caches before trusting what you see.
- Ciphertext checks are `NOT VALID`, so they only block new writes. Old plaintext rows can still exist.
- No `gh` CLI on the owner's machine: push with git, open PRs in the GitHub web UI.
- Public npm is blocked on the owner's machine. On a registry 401/403, stop and ask; don't switch registries.

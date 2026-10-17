# Duo

A private PWA for two people: a shared contact book, chat, lists, notes and view-once photos and videos.
React 19 + Vite 8 + Tailwind 4 + TypeScript 7 on the front, Supabase (Postgres, Auth, Storage, Realtime) behind it.
Content is encrypted on the phone, so the server stores it only as ciphertext. Ids, membership, timestamps and
media flags are plaintext, and rows from before encryption can still be plaintext.
[README.md](README.md) is the user-facing overview; this file is for working on the code.

## Commands

```bash
npm run dev          # http://localhost:5173, no security headers (needs .env.local, see README "Run it locally")
npm test             # vitest, node environment
npm run typecheck    # tsc --noEmit (TypeScript 7 native)
npm run build        # typecheck, then the production build into dist/, including dist/_headers
npm run preview      # serves dist/ on :4173 with the same headers as production
npx supabase start   # local stack in Docker; applies supabase/migrations (the CLI isn't a dependency, npx fetches it)
python scripts/mutate.py          # breaks each check in MUTANTS in turn; each must say CAUGHT
node scripts/audit-style.cjs .    # function lengths and repeated blocks in src/ and vite.config.ts
node scripts/check-doc-names.cjs  # names in the docs' inline code spans (paths, identifiers, npm scripts) still exist
```

Before a PR: `npm run typecheck`, `npm test`, `python scripts/mutate.py`, `node scripts/audit-style.cjs .`,
`node scripts/check-doc-names.cjs`.

## Where things are

- `src/lib/e2e.ts`: key derivation, sealing, and the `contexts` every ciphertext is bound to.
- `src/lib/store.tsx`: `SpaceProvider` (through `useSpaceStore`) wires together rows, sync, device-key, plaintext,
  view, room, store-actions and the `*-actions.ts` classes from `src/lib/space/`. It also adds the partner-typing timer
  and reload-on-foreground. `useSpace()` reads the result; `useAuthorName` is here too.
- `src/lib/direct.ts`: phone-to-phone WebRTC transfer. `src/lib/inbox.ts` keeps files received that way, still encrypted.
- `src/features/`: screens and sheets grouped by feature (some files hold several), plus `nav.ts` and `list-parts.tsx`.
- `src/components/`: shared UI (`ui.tsx`, including `MenuItem` and `errorMessage`), `useBusy`, `useLongPress`, `ErrorBoundary`.
- `supabase/migrations/`: schema, row-level security, ciphertext-only checks, the `media` bucket, the private room.
- `vite.config.ts`: CSP and security headers, written to `dist/_headers` for Cloudflare Pages.

More detail: [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md),
[docs/testing.md](docs/testing.md), [docs/gotchas.md](docs/gotchas.md). Path-scoped rules live in
[.claude/rules/](.claude/rules/) and load when you work on matching files.

## Rules

**Security**
- Every new content field is encrypted with `encryptRecord` / `encryptMessage` / `encryptBytes` (or `RowWriter`)
  under a `contexts.*` string. The database gets a `not valid` check that its plaintext column stays empty.
- Never change an existing `contexts.*` string, the `v1:` format or the file version byte: every stored row
  would stop decrypting. Add a new context or version instead.
- Once a space has `e2e_salt`, `view.ts` drops content rows and messages without ciphertext, and reads plaintext
  space and member names as null. Only the device that turned encryption on adopts such rows, in its one-time upgrade.
- Decrypted records the screens show are checked against `shapes` first.
- Keep protection invisible. Today people see sign-in, the shared passphrase and "Lock this device" in Settings.
  Don't add passwords, PINs, prompts or security settings; suggest anything user-facing to the owner instead.
- Never weaken the CSP in `vite.config.ts`, add an origin to it, or turn on source maps.

**Code style**
- Functions, including components, are at most 29 lines. A longer one means the design needs splitting.
- Names explain the code: someone reading it cold should know what a variable, function or file is from its name
  alone. No cryptic abbreviations (like o, ch or rt); single letters only in tiny lambdas and loop counters.
  Comments are short and only say why something non-obvious is done.
- Readable beats clever. A plain `for` loop or a named intermediate variable beats a dense
  `map`/`filter`/`reduce` chain, a nested ternary or a packed one-liner. Use the compact form only where
  performance needs it, and say why. A simple `.map` to JSX is fine.
- Extract a function or class only for a block of 4–5+ lines repeated more than three times. No one- or two-line
  helpers just to dedupe (the `contexts` one-liners stay because they centralise a security format).
- Match the surrounding code: small classes with short methods, and screens call `useSpace().actions.<area>.<verb>()`.

**Process**
- `main` deploys to production on push (Cloudflare Pages, set up outside this repo). Work on a branch and open
  a PR; the owner merges.
- A migration that new frontend code depends on is applied to the live database **before** that code is merged.
- Migrations are append-only: add a new file, never edit one that has been applied.
- Docs say only what the code does, plus facts clearly labelled as observed outside the repo. When a change alters
  behaviour that CLAUDE.md, README.md, `docs/`, `.claude/rules/` or `.claude/skills/` describe, update them in the
  same PR using the `update-docs` skill. It writes each statement
  from the code and has independent reviewers fact-check it.
- Claim only what was tested, with a positive control for every "found nothing".
- No Claude attribution lines in commits or PR descriptions.

## Gotchas (short list; details in [docs/gotchas.md](docs/gotchas.md))

- Tailwind scans text files that aren't gitignored (including docs and scripts). `src/index.css` excludes `docs/`, `scripts/`, `.claude/` and
  `CLAUDE.md`; a new folder of docs or scripts needs its own `@source not` line. Compare CSS from a clean `git archive` build.
- After a rebuild, the service worker serves the old bundle until the new one activates and reloads the page.
  Unregister it and clear caches before trusting what you see.
- Ciphertext checks are `NOT VALID`: they block plaintext on new writes, but old plaintext rows can still exist.

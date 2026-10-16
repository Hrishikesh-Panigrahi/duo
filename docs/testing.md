# Testing

The rule is **test it, then claim it**. Every "found nothing" needs a positive control showing the check would
have found something. Anything that wasn't tested is reported as untested.

## Every change

```bash
npm run typecheck
npm test
python scripts/mutate.py          # every line must say CAUGHT
node scripts/audit-style.cjs .    # 0 functions over 29 lines, 0 repeated 4-line blocks
```

### Unit tests (`*.test.ts`, vitest, node environment)

| File | Covers |
| --- | --- |
| `e2e.test.ts` | Round trips, the same key on another device, fresh IVs, wrong key, wrong context, tampering |
| `space/view.test.ts` | What screens see; strict mode once encrypted; what still needs decrypting |
| `space/shapes.test.ts` | Accepting what the app writes, rejecting malformed records, end to end through decryption |
| `space/room.test.ts` | Presence budget, sealed signals, replay age, size limit, partner-only files, rejoin backoff |
| `space/rows.test.ts` | The stored-rows reducer, including messages still being sent |
| `direct.test.ts` | Transfer framing: headers, chunking, oversize and non-binary chunks |
| `invite.test.ts` | Invite links and codes, and stale saved invites |
| `media.test.ts` | Size limits, photo scaling, `PLAYABLE_TYPE` |
| `passphrase.test.ts`, `vcard.test.ts`, `dates.test.ts`, `supabase.test.ts` | Passphrase strength, vCard import and export, birthdays, error messages |

Tests that need WebCrypto use Node's built-in `crypto.subtle`. Nothing here talks to Supabase.

### Mutation suite (`scripts/mutate.py`)

This breaks each security check in turn, runs the test file that should notice, and always restores the source.
`MISSED` means a check has no test protecting it. When you add a security check, add a mutant for it. Each anchor
must appear exactly once in its file, or the script stops.

### Style audit (`scripts/audit-style.cjs`)

This reports functions over 29 lines and 4-line blocks repeated more than three times (both must be 0), plus comment
density. It also lists every named one- or two-line function. That list is for review, not a target: short methods
and components are fine, but a new one-line wrapper that only dedupes isn't. It parses with `@babel/parser`, which
comes with the build tooling in `node_modules`.

## Bigger changes: two people, two browsers

Use this for anything touching sync, encryption, the room or media.

1. `npx supabase start`, then `npm run dev` (or `npm run build && npm run preview` for production behaviour).
2. Use two origins, which keep separate logins: `http://localhost:5173` and `http://you.localhost:5173`.
   Emulate a phone for one of them.
3. Walk through: sign up, start a space, the invite link, join, the passphrase on both; chat, typing and unread;
   notes, lists and contacts (including a .vcf import); direct and stored photos and video; long-press, delete,
   lock and unlock, sign-out.
4. Check the console for errors and CSP violations, and check storage after sign-out (`duo-keys` and `duo-inbox` empty).

Test accounts and their passwords belong in the scratchpad or `.env.local`, never in the repo.

### Refactors: prove nothing changed

For a change that shouldn't be visible, seed the same data and compare each screen's DOM against `main`. Then
compare the CSS from clean builds:

```bash
git archive <ref> | tar -x -C /some/empty/dir   # then link node_modules and run npx vite build there
```

An untracked file inside the repo changes Tailwind's output, so compare clean exports, not working trees.

### Privacy checks

- **The wire:** record all traffic between the browsers and the local Supabase. Search every request, response and
  WebSocket frame for the plaintext you typed: text, names, notes, contacts, the passphrase, file names, image or
  video signatures, and unsealed connection setup. Plant a known string in a response as the positive control.
- **Access rules:** with a third account outside the space, every table, RPC, Storage path and the room must refuse
  or return nothing. Check each policy with a member too, so you know the test can see real data.
- **Headers:** on the branch preview (`<branch>.our-duo.pages.dev`), check every response carries the headers from
  `dist/_headers` and that no `.map` files are served.

Keep these harnesses in the scratchpad. Tailwind would scan them inside the repo, and they tend to hold test
credentials.

## Before reporting

List what was tested and how, with numbers. List what wasn't tested and why. Do this in the PR description too.

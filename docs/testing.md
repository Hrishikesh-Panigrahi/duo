# Testing

The rule is **test it, then claim it**. Every "found nothing" needs a positive control showing the check would
have found something. Anything that wasn't tested is reported as untested.

## Every change

```bash
npm run typecheck
npm test
python scripts/mutate.py          # each mutant must say CAUGHT, with a failing test (×) under it
node scripts/audit-style.cjs .    # 0 functions over 29 lines, 0 repeated 4-line blocks
node scripts/check-doc-names.cjs  # names in the docs' inline code spans still exist (see .claude/skills/update-docs)
```

### Unit tests (`*.test.ts`, vitest, node environment)

| File | Covers |
| --- | --- |
| `e2e.test.ts` | Text, contact, list item and member-name round trips. The same key from the same passphrase and salt; a different key with another salt. Fresh IVs. Wrong passphrase. Messages moved to another sender, space or id; files to another id; records to another row, list, field or space. Tampering. The check value |
| `view.test.ts` | What screens see. Content without ciphertext before and after encryption. What still needs decrypting |
| `shapes.test.ts` | Accepting what the app writes, rejecting malformed records, and a malformed record that decrypts counting as undecryptable |
| `room.test.ts` | Presence budget. Announcing whether this device can take files, only once subscribed, and leaving when hidden. Partner presence. Rejoin backoff. Sealed signals. Ignoring replays (past timestamps), forgeries, junk, oversized signals and anything while locked. Passing the partner check through to the link |
| `rows.test.ts` | The stored-rows reducer, including messages still being sent |
| `direct.test.ts` | Transfer framing: headers, reassembly, non-binary chunks, and more bytes than promised |
| `invite.test.ts` | Invite links and codes, and dropping saved invites after two weeks |
| `media.test.ts` | The video size limit, photo scaling, the 3-day expiry, the `PLAYABLE_TYPE` pattern, storage paths |
| `passphrase.test.ts`, `vcard.test.ts`, `dates.test.ts`, `supabase.test.ts` | Passphrase strength; vCard import and export; day counting, birthdays and relative-day labels; error messages |

Tests that need WebCrypto use Node's built-in `crypto.subtle`. Nothing here talks to Supabase.

**Not covered by any unit test:**
- the `to`/`from` check and `MAX_INCOMING` in `DirectLink.handleSignal`;
- refusing signals with a future timestamp (only past ones are tested);
- the room's `private: true` flag (the test's fake channel ignores options);
- the send refusal in `prepareMedia` and the `application/octet-stream` fallback in `openMedia`;
- that the write paths (`RowWriter`, `*-actions.ts`) send only ciphertext;
- `upgradeLegacy` and its upgrade flag, and `useForgetMismatchedKey`;
- non-extractable keys, and sign-out clearing `duo-keys` and `duo-inbox`;
- the context strings themselves (only the `v1:` prefix is pinned);
- the database checks and policies;
- the CSP.

### Mutation suite (`scripts/mutate.py`)

The script holds a fixed list of mutants (`MUTANTS`), each breaking one check in `room.ts`, `view.ts`, `direct.ts`, `invite.ts` or
`media.ts`. For each one it runs the test file that should notice, prints `CAUGHT` or `MISSED`, and always puts the
file back byte for byte (LF or CRLF). `CAUGHT` only means vitest exited non-zero, so confirm a real failing test (`×`) is listed under it.
A crash would also count. The script exits 1 if anything was `MISSED`.

Each anchor must appear exactly once in its file, or the script stops. When you add a security check, add a mutant
for it. The checks listed under "Not covered" above have no mutant either.

### Style audit (`scripts/audit-style.cjs`)

The audit scans `src/**/*.ts(x)` and `vite.config.ts`. It reports:
- functions over 29 lines (`describe` blocks excepted);
- 4-line blocks repeated more than three times, in non-test files;
- comment density.

The first two must be 0. It also lists named functions whose body is one or two lines. Test files and JSX handlers
are skipped, and an arrow function with an expression body counts as one line, however long. That list is for
review, not a target.

The audit needs `@babel/parser`. That isn't in `package.json`: it's in `node_modules` only because
vite-plugin-pwa → workbox-build → `@babel/core` depends on it, so a dependency update could remove it.

## Bigger changes: two people, two browsers

Use this for anything touching sync, encryption, the room or media.

1. `npx supabase start`, then `npm run dev`. For production behaviour, including the CSP, use `npm run build` and
   `npm run preview` (port 4173).
2. Use two origins, which keep separate logins: `http://localhost:5173` and `http://you.localhost:5173` (or `:4173`
   under preview). Emulate a phone for one of them.
3. Walk through:
   - sign-up, starting a space, the invite link, joining, and the passphrase on both;
   - chat, typing and unread;
   - notes, lists and contacts, including a .vcf import;
   - direct and stored photos and video;
   - long-press, delete, lock and unlock, sign-out.
4. Check the console for errors. Under preview, also check for CSP violations. After sign-out, check that `duo-keys`
   and `duo-inbox` are empty.

Test accounts and their passwords belong in `.env.local` or outside the repo, never in a tracked file.

### Refactors: prove nothing changed

For a change that shouldn't be visible, seed the same data and compare each screen's DOM against `main`. Then
compare the CSS from clean builds:

```bash
git archive <ref> | tar -x -C /some/empty/dir   # then link node_modules and run npx vite build there
```

An untracked file inside the repo can change Tailwind's output, so compare clean exports, not working trees.

### Privacy checks

- **The wire:** record all traffic between the browsers and the local Supabase. Search every request, response and
  WebSocket frame for the plaintext you typed: text, names, notes, contacts, the passphrase, file names, image or
  video signatures, and unsealed connection setup.
  - Broadcasts are binary frames; presence and `postgres_changes` are JSON.
  - Plant a known string in a response as the positive control.
- **Access rules:** with a third account outside the space, every table, RPC, Storage path and the room must refuse
  or return nothing. Check each one as a member too, so you know the test can see real data.
- **Headers:** on a Cloudflare branch preview, check every response carries the headers from `dist/_headers` and
  that no `.map` files are served.

Keep these harnesses outside the repo: Tailwind would scan them, and they tend to hold test credentials.

## Before reporting

List what was tested and how, with numbers. List what wasn't tested and why. Do this in the PR description too.

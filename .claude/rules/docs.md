---
paths:
  - "CLAUDE.md"
  - "README.md"
  - "docs/**"
  - ".claude/rules/**"
  - ".claude/skills/**"
---

# Writing docs, rules and skills

A doc states what the code does today. The only other facts allowed are ones clearly labelled as observed outside
the repo (see below). Follow the `update-docs` skill (`.claude/skills/update-docs/SKILL.md`) for any change here.

**Every statement**
- Write it only after reading the code that makes it true. Follow the path end to end; don't go by function
  names, comments or test titles.
- Credit the code that actually does the work. For example, the client deletes opened media; `mark_media_opened`
  only records the time.
- Say whether the server or the client enforces it. A rule enforced only in the app isn't a guarantee against
  the server.

**Words that need checking**
- Check absolute words ("only", "never", "every", "all", "nothing", "can't") for exceptions, and name them. For
  example: inside a space, screens get data and actions from `useSpace()`. Sign-out goes through `signOut()`, and
  the auth screens (sign-in, sign-up, password reset, new password), space setup and the list of your spaces (`src/lib/spaces.ts`) call
  Supabase directly.
- Present a list as complete only if it is. "The server sees X and Y" must be every visible thing, or say
  "for example".

**Numbers, conditions and libraries**
- Give exact numbers, units and conditions: KiB rather than KB; inclusive or exclusive; one- or two-sided; "at the
  next sweep" rather than "when it expires"; "once `e2e_salt` is set" rather than "after locking".
- Say "tested" only after reading the assertions. A test named "joins privately" that never checks the private flag
  doesn't test it. Name what has no test.
- Check claims about libraries (Realtime frames, Vite env parsing, the service worker) in `node_modules`, not from
  memory.

**What doesn't belong**
- No sentence may contradict another. "Only X is sent or opened" next to "anything else opens as Y" is a contradiction.
- Keep facts about one machine, account or dashboard out of the code docs. Put them in `CLAUDE.local.md`
  (gitignored), or label them clearly as observed outside the repo, with a date.
- Leave out counts that go stale (number of tests, lines, claims) except in PR descriptions.

**Before you finish**
- Run `node scripts/check-doc-names.cjs`. Its header lists which span shapes it checks. Add a name to its
  `ABSENT_ON_PURPOSE` list only when the doc names it to say the code doesn't or mustn't contain it, or when it
  isn't in a clean checkout (gitignored or outside the repo).
- When a code change alters behaviour that CLAUDE.md, README.md, `docs/`, `.claude/rules/` or `.claude/skills/`
  describe, update them in the same PR.

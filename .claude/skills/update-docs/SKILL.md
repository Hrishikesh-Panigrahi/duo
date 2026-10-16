---
name: update-docs
description: Use when adding to or changing CLAUDE.md, README.md, docs/, .claude/rules/ or .claude/skills/, or when a code change alters behaviour those files describe. Writes each statement from verified code, then has independent reviewers fact-check it.
argument-hint: "[what changed, e.g. 'media expiry moved to the server']"
---

# Updating Duo's docs

The docs must say what the code does, with nothing assumed. The rules for each sentence are in
[.claude/rules/docs.md](../../rules/docs.md). This is the process.

## 1. Find every statement the change touches

- For a code change: list the functions, constants, columns, files and behaviours it changes. Search the docs for
  each one:

  ```bash
  grep -rn "<name>" CLAUDE.md README.md docs .claude
  ```

  Also search for the *behaviour* in plain words ("expire", "deleted", "only", "tested"), because docs often
  describe code without naming it.
- For a doc change: list each sentence you're adding or rewriting.

## 2. Write each statement from the code

For each statement:

1. Open the code that makes it true and follow it end to end: caller, function, any SQL or RLS policy it relies
   on, and the test that covers it.
2. Write down the evidence as `file:line` in your working notes. If you can't find a line, you can't write the
   sentence.
3. Run through the traps in the rules file, including:
   - absolute words;
   - the wrong place credited;
   - server versus client;
   - an incomplete list;
   - units and conditions;
   - "tested" without reading the assertions;
   - library behaviour from memory;
   - contradictions;
   - facts about one machine;
   - trusting names, comments or test titles;
   - counts that go stale.
4. Prefer saying less, and exactly. "X does A and B" beats "X handles everything".

When a doc lists what's protected or tested, also list what isn't (see `docs/security.md` and `docs/testing.md`).

## 3. Check the names

```bash
node scripts/check-doc-names.cjs
```

It checks the span shapes listed in the script's header. For a path, it proves the file exists with that exact
case; for an identifier, only that each part appears somewhere in the code's text files, comments included. It
can't tell whether `A.b` is really a member of `A`, or whether the sentence is true. That's step 4.

## 4. Have it fact-checked independently

Use reviewer subagents that didn't write the text.

- Give each reviewer two or three files, using the prompt in [reviewer-prompt.md](reviewer-prompt.md).
- Run them in parallel.
- Don't run `scripts/mutate.py` while they're reading. During its run, each target source file in turn holds a
  deliberately broken version.

For each finding:
- **Confirmed** (you read the cited code and agree): fix it.
- **Disputed:** check it yourself with evidence before rejecting it, and measure rather than trust either side.
  Once a reviewer said the source files were CRLF; measuring file sizes showed they were LF, but the bug it pointed
  at (the mutation script restoring CRLF files with LF endings) was real.
- **About things outside the repo:** label the sentence as observed outside the repo, with a date, or move it to
  `CLAUDE.local.md`.

For a rewrite of more than a few sentences, run a second, fresh round on the result. The fixes themselves
introduce new claims.

## 5. Finish

- Run `node scripts/check-doc-names.cjs` again.
- A new non-UI folder or markdown file outside `docs/`, `scripts/` and `.claude/`? Add an `@source not` line to
  `src/index.css`. Then check from a clean `git archive` build that the CSS is unchanged (see `docs/testing.md`).
- In the PR description:
  - say what was checked;
  - give the numbers of claims checked, problems found and problems fixed;
  - say what wasn't checked.

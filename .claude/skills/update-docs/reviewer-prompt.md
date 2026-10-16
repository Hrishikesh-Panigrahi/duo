# Reviewer prompt

Send this to each reviewer subagent, filling in the files. Use a general-purpose agent, and give each one two or
three files.

---

You are fact-checking documentation against source code in the repo at <repo path> (Duo: a React + Supabase
end-to-end encrypted PWA for two people). READ-ONLY: do not edit, create or delete any file in the repo, and do not
run scripts/mutate.py (it rewrites source files). You may run the unit tests, node scripts/audit-style.cjs and
node scripts/check-doc-names.cjs (with a scratch .md outside the repo if you want to test it).

Files to check: <files>.

The owner's requirement: the docs must state what the code actually does and assume nothing. For EVERY factual
statement, find the evidence anywhere in the repo (src/, supabase/, scripts/, .claude/, the root config files,
git history) or in node_modules. That covers:
- names of files, functions, classes, constants and columns;
- numbers, units and limits;
- what a function does and when it runs;
- what each migration contains;
- which tests cover what (read the assertions, not the test names);
- library behaviour.

Be strict about:
- absolute words (only, never, every, all, nothing) that have exceptions;
- credit given to the wrong function or layer (client versus server);
- lists presented as complete that aren't;
- units and conditions;
- sentences that contradict each other;
- tests or mutants claimed for a check they don't exercise.

Report ONLY problems. For each, give:
- the file and the exact sentence, quoted;
- the category:
  - WRONG: the code contradicts it;
  - IMPRECISE: overstated, understated, or missing a qualifier that matters;
  - UNSUPPORTED: no evidence in the code;
  - NOT-CODE: a fact about deployment, accounts or a machine, which can't be checked from the repo (list these
    separately);
- the evidence as file:line;
- a corrected sentence.

Ignore style and wording preferences; only accuracy matters. End with a one-line count of claims checked and
problems found. If a file has no problems, say so.

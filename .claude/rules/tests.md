---
paths:
  - "**/*.test.ts"
  - "scripts/**"
---

# Tests and checks

See [docs/testing.md](../../docs/testing.md).

- Tests sit next to the code (`media.ts` → `media.test.ts`) and run in vitest's node environment, with Node's
  WebCrypto. They never talk to Supabase.
- Test names are plain sentences about behaviour: `it('rejects ciphertext moved to another sender, space or message id')`.
- Security checks need a negative test (wrong key, wrong context, tampered, oversized, replayed) **and** a
  positive one showing the normal case still works.
- `scripts/mutate.py` anchors must match the source exactly once. When you rename or rewrite a checked line,
  update its anchor and rerun; every mutant must be CAUGHT.
- Never put test credentials, real emails, tokens or live IDs in tests or scripts.
- Test files are exempt from the "no tiny helpers" rule but not from the 29-line function limit (except `describe`
  blocks).

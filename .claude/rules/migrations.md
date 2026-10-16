---
paths:
  - "supabase/**"
---

# Database migrations

- Append only. Add a new `supabase/migrations/<timestamp>_<name>.sql`; never edit a file that has been applied.
  All four current files are applied to the live project.
- Start with a short comment block saying what the migration does and why, like the existing files.
- Every content column is ciphertext: a `cipher text` column with a length check, plus a ciphertext-only
  `check (…) not valid` constraint. `not valid` lets the app upgrade older rows in place.
- RLS on every new table, with members-only policies built on `public.is_member(space_id)`. Grant only what the
  app uses; the init migration revokes everything first.
- `security definer` functions set `search_path = ''`, qualify every name (`public.…`), check the caller
  (`auth.uid()`, membership) themselves, and revoke EXECUTE from `public` and `anon` unless anon truly needs it.
- Storage: the `media` bucket is private and stores raw bytes only. Paths are `<space id>/<message id>`, checked by
  `can_access_media`.
- Realtime: the room is the private channel `room:<space id>`, members only. New tables the app streams need
  `alter publication supabase_realtime add table …`.
- Test locally first (`npx supabase start` applies migrations; `npx supabase db reset` re-applies them). Check
  the access rules with a member and with an account outside the space.
- The live database is migrated **before** the frontend that depends on it is merged. Paste into the SQL editor
  wrapped in `begin; … commit;`, and say in the PR that this step is needed.

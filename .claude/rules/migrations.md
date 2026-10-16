---
paths:
  - "supabase/**"
---

# Database migrations

**Files**
- Migrations are append-only. Add a new `supabase/migrations/<timestamp>_<name>.sql`; never edit a file that has
  been applied to the live project.
- Open with a comment saying what the migration does, and comment each section with why.

**Encrypted columns**
- Content tables use a `cipher text` column with a length check.
- Names use `name_cipher` / `display_name_cipher`.
- Add a `check (…) not valid` that the old plaintext columns stay empty (and, for content tables, that `cipher` is
  set). `not valid` leaves older rows alone so the app can upgrade them. Rows are updated in place; messages, which
  have no UPDATE grant, are swapped for an encrypted copy by `encrypt_legacy_message`.

**Access control**
- Turn on RLS for a new table, `revoke all … from anon, authenticated`, grant only what the app uses, and add
  members-only policies built on `public.is_member(space_id)`. The init migration's revoke covers only its own
  seven tables.
- `security definer` functions:
  - set `search_path = ''` and qualify every name (`public.…`);
  - check the caller themselves (`auth.uid()`, membership);
  - revoke EXECUTE from `public` and `anon` unless anon needs it.

**Storage and Realtime**
- The `media` bucket is private and only accepts uploads declared as `application/octet-stream`.
  `can_access_media` allows paths matching `^[0-9a-f-]{36}/[0-9a-f-]{36}$` whose first part is the caller's space.
  It doesn't check that the second part is an existing message.
- The room is the private channel `room:<space id>`, members only (`can_use_room`). Tables the app streams are
  added with `alter publication supabase_realtime add table …`.

**Testing and applying**
- Test locally first: `npx supabase start` applies the migrations, and `npx supabase db reset` re-applies them.
  The Supabase CLI isn't a dependency, so npx fetches it. Check the access rules with a member and with an account
  outside the space.
- Apply the migration to the live database **before** the frontend that depends on it is merged. Say in the PR
  that this step is needed.

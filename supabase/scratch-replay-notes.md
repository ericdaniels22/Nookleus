# Scratch Replay Notes — Build 65b Session A.5

**Date:** 2026-04-29
**Branch:** `build-65b-session-a`
**Scratch project:** `jpzugbioqdjhhmuwqqeg` / `aaa-platform-scratch-65b-2026-04-29`
**Source of truth for replay:** the `supabase/migration-build*.sql` files committed
on this branch as of HEAD.

This file documents the deviations made when replaying the prod migration history
against the scratch project for Session A.5. Future replays (Session B/C, or a
fresh scratch project) should mirror this list.

## Total replay count

53 successful applies, 0 errors, 0 rolled back:

- 3 Phase 1 schema files (`schema.sql` pre-applied by Eric in the dashboard;
  `schema-photos.sql` and `schema-email.sql` applied via MCP)
- 49 `migration-build*.sql` files (build12 through build66, intentional gaps
  preserved per `00-glossary.md` "Build IDs vs migration numbers diverge" note)
- 1 `migration-fix-folder-names.sql` (no-op on empty `emails` table, applied
  for prod parity)

## Order decisions confirmed with Eric

1. **Phase 1 schema files run before `migration-build12.sql`.** Replay order:
   `schema.sql` → `schema-photos.sql` → `schema-email.sql` → `migration-build*.sql`
   in numeric order.
2. **`migration-build13.sql` runs before `migration-build13-attachments.sql`.**
   Lex-sort puts `-attachments.sql` first, but the file's "Build 13 Module 4"
   self-documentation marks it as following Modules 1–3 in `migration-build13.sql`.
3. **All `*-rollback.sql` files skipped.** Forward replay only.
4. **`migration-fix-folder-names.sql` runs at the end as a no-op.** Preserves
   migration-history parity with prod even though scratch has zero `emails`
   rows to update.

## Build 42 deviation: skipped prod-user seed

**What changed:** the migration as authored seeds Eric's prod `user_id`
(`7c55cdd0-2cbf-4c8a-8fdd-e141973ade94`) into `user_organizations` as an admin
of AAA. That user_id does not exist in scratch's `auth.users`, and the FK
(`user_organizations.user_id REFERENCES auth.users(id) ON DELETE RESTRICT`)
would fail.

**How we handled it:** the `INSERT INTO public.user_organizations` line was
removed for the scratch replay only. AAA + Test Co organization rows still seed
exactly as in prod (`a0000000-0000-4000-8000-000000000001` and `…000002`).

**Where the membership comes back in:** `supabase/seed-scratch.sql` re-adds
the membership row, but for a fresh dashboard-created test user
(`eric+scratch@aaacontracting.com`, user_id pasted at session time) instead of
Eric's prod user_id.

**Net effect:** scratch ends in the same shape as prod for `user_organizations`
(one admin row for AAA), just attached to a different person.

## Other notes

- **`build47` per-org counter seeds** were authored for AAA's prod state
  (next_value = 14 for jobs, 2 for invoices). The replay applied those same
  counter values to scratch, so the first scratch job in
  `seed-scratch.sql` was assigned `WTR-2026-0014`. That's a no-harm cosmetic
  consequence of preserving the migration verbatim — not a bug.
- **`build49` enforces tenant isolation via RLS policies** but doesn't drop
  the legacy allow-all policies. `build57` does the drop. `build53` adds
  transitional allow-alls for tables whose original policies were narrower
  than `FOR ALL`. The combination means that during the build49→build57 window
  the policies are written but not enforced; after build57 they are enforced.
  Scratch went through that exact window during this replay.
- **`schema-photos.sql` pre-seeds 10 production photo_tags** (Initial Damage,
  Moisture Reading, Equipment Setup, Drying Progress, Final Dry, Mold Found,
  Repairs, Customer Approval, Before, After). All ten get backfilled to AAA's
  org by `build44`. `seed-scratch.sql` does NOT add three synthetic tags as
  the original Session A.5 prompt's step 4 sub-bullet suggested — the existing
  ten are real production data and provide better signal for the tag-after
  sheet rendering test.
- **`build44` safety assertions ran with 0 rows in every check** because no
  data existed yet; assertions still passed because `IF EXISTS (... WHERE NULL)`
  on an empty table returns false.
- **`auth.users` in scratch was empty** when `build52` ran (it's an
  `UPDATE … WHERE token IS NULL`); 0 rows affected. The migration is still
  applied so future dashboard-created users with NULL token columns get fixed
  retroactively.

## Tooling note (Windows-side smoke test)

The Claude Preview MCP's `preview_start` tool **does not honor the
`runtimeExecutable` / `runtimeArgs` fields** in `.claude/launch.json` —
it always runs `npm run dev` regardless of the launch.json config name.
Verified empirically during Session A.5: a config named `scratch` with
`runtimeExecutable: npx`, `runtimeArgs: ["dotenv", "-e",
".env.scratch.local", "--", "npm", "run", "dev"]` started the server but
the server connected to **prod** Supabase (not scratch).

**Workaround for the Windows smoke test:** invoke `npx dotenv -e
.env.scratch.local -- npm run dev -- --port 3001` directly via Bash
`run_in_background`. Verified on port 3001 that the client bundle had
`jpzugbioqdjhhmuwqqeg.supabase.co` (scratch) inlined.

**Mac session note:** prefer the direct Bash invocation, or add a
`dev:scratch` script in `package.json` (deferred — Eric to decide).

## Reproducing this replay against a fresh scratch project

1. Eric creates a new Supabase project. Pastes URL + anon key + service_role
   key back into chat.
2. Pre-apply `schema.sql` via the dashboard SQL Editor (or MCP). Confirms
   the base 6 tables + the two job-number functions exist before MCP starts
   applying buildNN migrations.
3. Apply via MCP `apply_migration` in this order:
   `schema-photos.sql` → `schema-email.sql` → `migration-build12.sql` →
   `migration-build13.sql` → `migration-build13-attachments.sql` →
   `migration-build14a.sql` (no 14b) → `migration-build14c..14g.sql` →
   `migration-build21-jarvis.sql` → `migration-build23-rnd.sql` →
   `migration-build25a-knowledge.sql` → `migration-build26b.sql` →
   `migration-build27..build41` → `migration-build42` (with prod-user
   seed line removed — see deviation above) → `migration-build43..build60`
   → `migration-build62` → `migration-build62b` → `migration-build63` →
   `migration-build64` → `migration-build66` → `migration-fix-folder-names.sql`.
4. Eric creates the test user via the Supabase dashboard. Pastes back the
   `user_id`.
5. Apply `seed-scratch.sql` with the new user_id substituted into the
   `test_user_id` constant at the top of the DO block.
6. Add `.env.scratch.local` at repo root with the new project's URL + keys.
   Re-run `npx dotenv -e .env.scratch.local -- npm run dev -- --port 3001`
   to verify env loading.

## Branch reference

This replay was performed on branch `build-65b-session-a` against scratch.
The migration text used for each apply is exactly what's committed at HEAD.
If a migration on this branch is amended after the replay date above, the
deltas need to be applied to scratch separately.

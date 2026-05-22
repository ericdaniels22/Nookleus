---
date: 2026-05-21
build_id: 187
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-21-186-backfill-phone-e164]]", "[[2026-05-21-184-masked-date-field]]"]
---

# Build 187 Handoff — 2026-05-21

## What shipped this session

Implemented issue [#187](https://github.com/ericdaniels22/Nookleus/issues/187)
— **the last slice of PRD [#45](https://github.com/ericdaniels22/Nookleus/issues/45)**
(intake-form quality-of-life): a migration flipping `when_happened` from
field-type `"text"` to `"date"` in every existing organization's saved
`form_config`. Built via `/tdd` in an isolated worktree, full red→green loop,
then **applied to AAA prod**.

#187 is the companion to #184. #184 updated only the intake-form builder
*seed*, so orgs created before #184 still carry `when_happened` as `"text"` in
their stored `form_config.config` JSONB and would never get the new
masked-date renderer. #187 brings those rows into line.

Three SQL files in `supabase/`, mirroring the #186 three-file pattern:

- **`migration-187-form-config-when-happened-date.sql`** — the migration. A
  session-local `pg_temp.flip_when_happened_type(jsonb)` helper walks
  `config→sections→fields`, rewrites **only** the `when_happened` field's
  `type` to `"date"`, and rebuilds both arrays in their original order. The
  helper drives both the pre-count and the `UPDATE`, so the rule lives in one
  place with no permanent schema surface. Idempotent — the
  `config IS DISTINCT FROM flip(config)` predicate skips rows already on
  `date` or with no `when_happened`, so `updated_at` is not bumped needlessly;
  a safety assertion aborts if the changed count drifts from the pre-count.
- **`migration-187-dry-run.sql`** — read-only would-change / already-date /
  no-`when_happened` counts plus a `when_happened.type` breakdown.
- **`migration-187-smoke-test.sql`** — the TDD test artifact, kept as a
  committed self-checking script (`begin; … rollback;`): a transform-parity
  battery (C1–C4) plus the exact migration `UPDATE` exercised on a seeded
  temp table shaped like `form_config` (C5–C6).

**TDD ran as 6 red→green cycles executed against the live AAA-prod DB via the
Supabase MCP `execute_sql`** — temp tables / `pg_temp` functions only, no real
rows touched (there is no local Postgres; scratch Supabase is paused). Genuine
RED was demonstrated twice: C1 (an identity-stub helper leaves `when_happened`
on `text`) and C5 (an `UPDATE` without the `WHERE` predicate bumps all 3 seed
rows). All 6 cycles green.

One feature commit `cd044f3` (3 files, +406) on branch
`187-form-config-when-happened-date`, pushed;
[PR #192](https://github.com/ericdaniels22/Nookleus/pull/192) opened against
`main` with `Closes #187` — **not yet merged**.

**The migration was then applied to AAA prod** (`rzzprgidqbnqcdupmpfe`) via
Supabase `apply_migration` (name `migration_187_form_config_when_happened_date`)
after the user's explicit plain-text "yes apply" (per
`feedback_supabase_mcp_prod_migration_approval`). Dry-run on prod first: 110
`form_config` rows — 8 to flip (all `text`), 0 already `date`, 102 with no
`when_happened` (unaffected). Post-apply verified: 8 rows now on `date`, 0 on
`text`, only those 8 received a fresh `updated_at`, the 102 untouched.

## What's next

- **Merge PR #192.** The migration is already applied to prod; merging just
  lands the source-of-truth `.sql` files and auto-closes #187. The PR is
  SQL-only — its Vercel deploy is a web no-op.
- **PRD #45 closes with that merge.** All of #45's slices — #183 (phone util),
  #184 (date field), #185 (phone rollout), #186 (phone backfill), #187 (this)
  — are implemented; #45 should be closed with a wrap-up comment once #192
  merges.
- **Browser-verify the date field on existing orgs.** With prod now flipped,
  an org that previously rendered "When Did It Happen?" as a free-text input
  should render the masked MM/DD/YYYY date field. The #184 component itself
  was never browser-verified either (see the #184 handoff).
- **Tear down the worktree** `.claude/worktrees/187-form-config-migration` and
  its local/remote branch after #192 merges.

## Decisions locked

- None this session. No design decisions were put to the user; the
  implementation followed the established #186 three-file precedent. The user
  gave one explicit plain-text approval — "yes apply" — to run the migration
  against AAA prod, the only gated action.

## Open threads

- **PR #192 is open and unmerged.** #187 stays open until it merges. The
  migration data change is already live on prod, so the PR and prod are
  briefly out of step (acceptable — the same as #186's flow).
- **`00-NOW.md` is still bloated** (~600 KB+, dozens of archived
  `last_verified` entries). Flagged in the #184 handoff and still unaddressed
  — worth a dedicated trim pass.

## Mechanical state

- **Branch:** `main` (this handoff). Work was done on
  `187-form-config-when-happened-date` in worktree
  `.claude/worktrees/187-form-config-migration`, both left in place pending
  the PR #192 merge.
- **Commit at session end:** main checkout at `43cacf7` (`vault: handoff #186
  …`) before this handoff commit; feature commit `cd044f3` (`feat: migrate
  existing orgs' form_config when_happened text -> date (#187)`) on the work
  branch / PR #192.
- **Uncommitted changes:** this handoff file + the `00-NOW.md` update only.
- **Migrations applied this session:** yes —
  `migration_187_form_config_when_happened_date` applied to AAA prod
  (`rzzprgidqbnqcdupmpfe`) via Supabase `apply_migration`; 8 `form_config`
  rows flipped to `date`.
- **Deployed to Vercel:** no — PR #192 is not merged. The migration was
  applied directly to the prod database, independent of any web deploy.

## Notes for next session

- The migration helper text (`flip_when_happened_type`) is duplicated
  verbatim across all three `.sql` files. This is deliberate, matching the
  #186 pattern: each file is self-contained, and a shared `public` function
  would add permanent schema surface for a one-shot migration. Each copy
  carries a comment noting the others are identical — keep them in sync if
  ever edited.
- The 8 flipped rows are the full 7-section default seed configs; the other
  102 `form_config` rows are customized 1–4-section configs that never carried
  a `when_happened` field. The migration's `WHERE` predicate, not a hardcoded
  count, decides what changes — re-running it is a safe no-op.
- The `apply_migration` call records the migration in Supabase's migration
  history under `migration_187_form_config_when_happened_date`, even though it
  is DML (an `UPDATE`), not DDL — consistent with how #186's backfill was
  applied.
- This session ran entirely in the worktree + via the Supabase MCP; the main
  checkout was untouched until this handoff. Main was already in sync with
  `origin/main` at `43cacf7` (concurrent sessions' #185/#186 vault commits had
  already landed).

## Links

- Issue: [#187](https://github.com/ericdaniels22/Nookleus/issues/187)
- Parent PRD: [#45](https://github.com/ericdaniels22/Nookleus/issues/45)
- PR: [#192](https://github.com/ericdaniels22/Nookleus/pull/192)
- Current state: [[00-NOW]]
- Prior handoff: [[2026-05-21-186-backfill-phone-e164]]
- Companion slice: [[2026-05-21-184-masked-date-field]]

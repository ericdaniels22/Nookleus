---
date: 2026-05-18
build_id: full-name
session_type: implementation
machine: TheLaunchPad
related: ["[[2026-05-18-109-full-name-prd-and-slice-1]]"]
---

# Build full-name Handoff — 2026-05-18 (twenty-second session — **slice #112 IMPLEMENTED, MERGED to `main` (`398b6bf`) and pushed; `migration-112` APPLIED to the production DB; issue #112 CLOSED**)

## What shipped this session

The third slice of PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) (combine customer first/last name into a single `full_name`). Issue [#112](https://github.com/ericdaniels22/Nookleus/issues/112) — "full_name slice 3: intake form & form builder". The intake form and form builder now collect the customer name as a single "Full Name" field.

Work was done in worktree `.claude/worktrees/112-intake-form-full-name` (branch `worktree-112-intake-form-full-name`), then merged to `main`.

**Drift corrected at orientation:** the handoff before this one (`2026-05-18-109-...`) recorded `main` at `d6ca443`. By session start `main` had advanced to `a4f7659` — the vault-record commit `9f08740` plus a *crew password reset + invite-by-email* build (`6a0df10`, `6c84ada`, `7da70d2`, `a4f7659`) that merged from branches `crew-password-reset` / `crew-password-reset-copylink` **without its own handoff**. That build is not documented in the vault.

**Slice #112 implemented** (source commit `926fc4d`):

- **`src/lib/form-config-name-collapse.ts`** (new) — the pure `collapseNameFields(config)` transform. Given an org's intake `form_config` JSON, it collapses the two name fields (mapped to `contact.first_name` / `contact.last_name`) into one "Full Name" field mapped to `contact.full_name`: placed at the former first-name field's position (or the lone last-name field's position when only that exists), keeping the anchor field's `id` + built-in flags, marked `required` if either original was required, carrying `merge_field_slug: "customer_name"`. The non-anchor last-name field is dropped. Idempotent; never mutates the input. Built test-first (TDD): **9 tests** in `form-config-name-collapse.test.ts` covering the standard default form, a reordered/relabeled/cross-section form, forms missing one field, required-flag propagation, merge-slug assignment, the neither-field no-op, idempotency, and input non-mutation.
- **`supabase/migration-112-form-config-name-collapse.sql`** (new) — runs the collapse over the **latest `form_config` version per org** (the one the intake form + form builder load); earlier versions are left intact so the version-history / restore flow keeps its pre-collapse snapshots. PL/pgSQL mirrors the TS module.
- **`src/components/form-builder/inspector.tsx`** — the `maps_to` picker drops the `contact.first_name` + `contact.last_name` options for a single `contact.full_name` ("Full name") option.
- **`src/components/intake-form.tsx`** — submission writes `contact.full_name` directly; the required-field check + error copy use "Full Name"; the adjuster path stores the typed adjuster name as `full_name` with **no first/last split**. Also dropped a pre-existing unused `FormSection` import so the changed surface lints clean.

**Verification:** typecheck clean on the changed surface (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` remains); lint clean on the changed surface; full suite **328 green / 52 files** (was 319/51, +9 for the new collapse module). Before applying the migration its collapse logic was verified **read-only** against the prod DB.

## What's next

- **#111 and #113, #114 remain unblocked and parallel-grabbable.** #111 is the one that actually fixes Eric's contract first/last-name gap. #113 (display sites + contact UI) and #114 (QuickBooks) are independent.
- **#115 cleanup** stays blocked until #111, #113, #114 all land.

## Open threads

- **Slice #112 was merged straight to `main`** (`398b6bf`) at Eric's request — no PR/review gate, overriding the usual `feedback_pause_between_issues.md` pause (same as #110).
- **`migration-112` is applied to the production DB** (`rzzprgidqbnqcdupmpfe`, migration name `form_config_name_collapse`). Verified post-apply: both orgs' latest `form_config` now has one `Full Name` field (`contact.full_name`, `required: true`, `merge_field_slug: customer_name`); the legacy mapped fields are gone.
- **First migration apply failed — a real bug, now fixed.** The PL/pgSQL FOR-loop record variable was named `fc`, the same as the table alias in its own correlated subquery, so PostgreSQL resolved `fc.organization_id` to the not-yet-assigned record variable (`record "fc" is not assigned yet`). Fixed in `398b6bf` by renaming the record variable to `rec` and using distinct table aliases (`t` / `t2`). The DO block is atomic, so the failed attempt wrote nothing. **Lesson for #111/#113/#114 migrations:** never name a PL/pgSQL loop variable the same as a table alias it queries.
- **The migration only touches the latest `form_config` version per org** (deliberate — preserves version history; differs from the build67-slice2 backfill which touched all rows). A user restoring a *pre-migration* form_config version would get the two name fields back; that edge case is accepted and out of scope.
- **Bounded coexistence still in force.** The #110 `contacts_sync_name` trigger keeps `full_name` ⇄ `first_name`/`last_name` consistent, so the intake form writing only `full_name` still satisfies the legacy `first_name NOT NULL` column. The trigger + legacy columns are dropped in #115.
- **Two crew password-reset builds shipped without handoffs** (`6a0df10`/`6c84ada` and `7da70d2`/`a4f7659`) — undocumented in the vault. Not investigated this session.
- **No code-level "default form config" exists.** New orgs get an empty `{ sections: [] }` form_config until set up; the build14f seed was a one-time global insert. The #112 acceptance criterion "the default intake config has one required Full Name field" is satisfied by the collapse module's standard-form test case + the migration.
- **Pre-existing unrelated typecheck error** — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.

## Mechanical state

- **`main`:** `398b6bf` — pushed to `origin/main`. Three commits this session: `926fc4d` (slice #112 source), `68cdf41` (merge), `398b6bf` (migration record-variable fix).
- **Branch:** `worktree-112-intake-form-full-name` was merged into `main` and **deleted**; the worktree at `.claude/worktrees/112-intake-form-full-name` was **removed**. (The `worktree-110-full-name-schema` worktree from the prior session was *not* cleaned up this session — still present.)
- **Migrations:** one (`migration-112-form-config-name-collapse.sql`), merged **and applied** to the production Supabase DB (`rzzprgidqbnqcdupmpfe`, name `form_config_name_collapse`) + verified.
- **Vercel deploy:** auto on the `main` push.
- **GitHub:** PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) OPEN; [#112](https://github.com/ericdaniels22/Nookleus/issues/112) CLOSED; slice issues [#111](https://github.com/ericdaniels22/Nookleus/issues/111), [#113](https://github.com/ericdaniels22/Nookleus/issues/113), [#114](https://github.com/ericdaniels22/Nookleus/issues/114), [#115](https://github.com/ericdaniels22/Nookleus/issues/115) OPEN, all `ready-for-agent`.
- **Memories:** none saved this session.

## Notes for next session

- **`form-config-name-collapse.ts` and `contact-name.ts` are the two shared name primitives** for the PRD. The form_config migration mirrors the collapse module in PL/pgSQL.
- The PRD is the design of record — there is no `docs/superpowers/specs` doc for this build.
- Still queued, untouched: #111 (the contract-gap fix), #113, #114; #58 umbrella has #62 + #63 `ready-for-agent`; the #68 real-email demo remains on Eric's plate.
- `00-NOW.md` is still bloated (~hundreds of KB of stacked `last_verified` entries) — a trim is still overdue.

## Links

- PRD: [#109](https://github.com/ericdaniels22/Nookleus/issues/109) — Combine customer first/last name into a single full_name
- This slice: [#112](https://github.com/ericdaniels22/Nookleus/issues/112) — intake form & form builder
- Remaining slices: [#111](https://github.com/ericdaniels22/Nookleus/issues/111) · [#113](https://github.com/ericdaniels22/Nookleus/issues/113) · [#114](https://github.com/ericdaniels22/Nookleus/issues/114) · [#115](https://github.com/ericdaniels22/Nookleus/issues/115)
- Prior session: [[2026-05-18-109-full-name-prd-and-slice-1]]
- Current state: [[00-NOW]]

---
date: 2026-05-18
build_id: full-name
session_type: planning + implementation
machine: TheLaunchPad
related: ["[[2026-05-18-86-request-context-cleanup]]"]
---

# Build full-name Handoff — 2026-05-18 (twenty-first session — **new PRD #109 filed + decomposed into 6 slice issues #110–#115; slice #110 IMPLEMENTED + committed (`58f02db`) on worktree branch `worktree-110-full-name-schema`; no PR opened yet**)

## What shipped this session

A brand-new build, unrelated to the Request Context PRD #78. Eric reported a UX bug: customer first-name + last-name merge fields render with a big gap in sent contracts, and the intake form has two name inputs where one would do. Brainstormed → PRD → issues → implemented the first slice.

**Brainstorming decisions locked** (`/brainstorming`):
- Root cause is the data model — `contacts` stores `first_name` + `last_name` as two columns. Fix: a single `full_name`.
- The contract "Customer Name" merge field (`customer_name`) **already exists** and composes first+last; the gap comes from templates using the *separate* fields.
- Storage: Eric chose **a real `full_name` column** (over split-on-space or store-whole-in-one-column).
- Delivery: **PRD with vertical slices** (over one big change / open-ended phased coexistence).
- Existing data: **auto-migrate all** org intake `form_config`s; **auto-rewrite** existing contract templates.
- Blast radius mapped: ~50+ files, 8 SQL files, the `Contact` type, QuickBooks sync (uses `GivenName`/`FamilyName`).

**PRD + issues filed:**
- PRD **[#109](https://github.com/ericdaniels22/Nookleus/issues/109)** — "Combine customer first/last name into a single full_name" (`ready-for-agent`). Per Eric's request the `docs/superpowers/specs` design doc was **skipped** — the PRD is the design of record.
- `/to-issues` → **6 slice issues**, all `ready-for-agent`: **#110** schema/backfill/coexistence trigger (no blockers); **#111** merge fields + contract templates; **#112** intake form + form builder; **#113** display sites + contact UI; **#114** QuickBooks sync; **#115** cleanup (drop old columns). #111–#114 each blocked only by #110 → parallel-grabbable. #115 blocked by #111–#114. QuickBooks was split into its own slice (#114) at Eric's call to isolate the external-integration risk.

**Slice #110 implemented** (one source commit `58f02db` on `worktree-110-full-name-schema`):
- **`src/lib/contact-name.ts`** (new) — the pure name-split helper. `splitName()` (last-space rule: everything before the final space is given, the rest is family; single token → empty family) + `joinName()` (trimmed, single-spaced join, transitional). Built test-first (TDD): **13 tests** in `contact-name.test.ts` covering single/two/three-plus tokens, leading/trailing + internal whitespace, empty/whitespace-only, missing parts; `joinName`'s cases double as the migration-backfill correctness check.
- **`supabase/migration-110-contacts-full-name-coexistence.sql`** (new) — adds `full_name text` (NULLable for now), backfills it from the legacy parts with a `joinName`-equivalent SQL expression + a safety assertion, and installs the `contacts_sync_name` `BEFORE INSERT OR UPDATE` trigger that keeps `full_name` ⇄ `first_name`/`last_name` consistent both directions. The trigger's PL/pgSQL split/join logic mirrors the TS helper. Follows the `build44`/`build54` migration style (commented, `do $$` blocks, ROLLBACK block).
- **`src/lib/types.ts`** — `Contact` now exposes `full_name: string` (legacy `first_name`/`last_name` kept until the #115 cleanup slice).
- **Verification**: typecheck clean (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322`); lint clean on the changed surface; full suite **319 green / 51 files** (was 306 / 50, +13 for the new helper).

## What's next

- **Open slice #110's PR** (`Closes #110`) — the work is implemented, verified and **committed** (`58f02db`) on `worktree-110-full-name-schema`; no PR opened yet. This session paused at the review gate per `feedback_pause_between_issues.md`.
- **Apply the migration** — `migration-110-contacts-full-name-coexistence.sql` is written but **not applied to any database**. It could not be verified against a live Postgres this session. Applying it (Supabase SQL editor / MCP) is a deliberate authorized step, typically on merge.
- After #110 lands, **#111–#114 unblock and are parallel-grabbable**. #111 is the one that actually fixes Eric's contract gap; #112 fixes the intake form.
- **#115 cleanup** stays blocked until #111–#114 all land.

## Open threads

- **Slice #110 is committed but not yet PR'd.** One commit `58f02db` on `worktree-110-full-name-schema`; opening the PR (`Closes #110`) is the first thing next session should do.
- **The migration is DB-unverified.** No local Postgres; the SQL is pattern-matched to existing migrations but has not been run.
- **Bounded coexistence is deliberate.** `full_name` is NULLable and the legacy columns remain through slices #111–#114; the trigger keeps them in lockstep. #115 drops the columns + trigger and makes `full_name NOT NULL`. The TS helper and the PL/pgSQL trigger must be kept in lockstep until then.
- **QuickBooks trigger untouched in #110.** `trg_qb_enqueue_contact_update` still watches `first_name`/`last_name`; that is correct for slice 1 (the coexistence trigger keeps the legacy columns populated). #114 updates it to watch `full_name`.
- **Pre-existing unrelated typecheck error** — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.
- This build does **not** overlap the open #95 security-triage issues (#96–#107) or the Request Context PRD #78 — no contention.

## Mechanical state

- **Branch:** `worktree-110-full-name-schema` (worktree at `.claude/worktrees/110-full-name-schema`).
- **HEAD:** `58f02db` (`contacts: add full_name column, backfill & coexistence trigger (#110)`).
- **`main`:** `6aa3e73` (`spec: PRD for ungated-endpoint security triage (#95)`). This vault handoff + the `00-NOW.md` edit are committed straight to `main` as a separate vault-only commit (no source code).
- **Source commits this session:** one (`58f02db`, on `worktree-110-full-name-schema`; no PR yet). **Migrations:** one written (`migration-110-...`), not applied. **Vercel deploy:** none.
- **GitHub:** PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) OPEN; slice issues [#110](https://github.com/ericdaniels22/Nookleus/issues/110)–[#115](https://github.com/ericdaniels22/Nookleus/issues/115) OPEN, all `ready-for-agent`.

## Notes for next session

- **`contact-name.ts` is the shared name primitive.** Slice #114 (QuickBooks) consumes `splitName` for `GivenName`/`FamilyName`. The PL/pgSQL trigger mirrors it — change one, change both. `joinName` is transitional and is removed in #115.
- **The PRD is the design of record** — there is no `docs/superpowers/specs` doc for this build (skipped at Eric's request).
- The six other architecture candidates from the #78 planning session remain a backlog for future `/improve-codebase-architecture` runs.
- Still queued, untouched: **#58 umbrella** has #62 + #63 `ready-for-agent`; the **#68 real-email demo** remains on Eric's plate.
- `00-NOW.md` has grown to ~440 KB of stacked archived `last_verified` entries — a trim is overdue.

## Links

- PRD: [#109](https://github.com/ericdaniels22/Nookleus/issues/109) — Combine customer first/last name into a single full_name
- Slices: [#110](https://github.com/ericdaniels22/Nookleus/issues/110) (this session) · [#111](https://github.com/ericdaniels22/Nookleus/issues/111) · [#112](https://github.com/ericdaniels22/Nookleus/issues/112) · [#113](https://github.com/ericdaniels22/Nookleus/issues/113) · [#114](https://github.com/ericdaniels22/Nookleus/issues/114) · [#115](https://github.com/ericdaniels22/Nookleus/issues/115)
- Prior session: [[2026-05-18-86-request-context-cleanup]]
- Current state: [[00-NOW]]

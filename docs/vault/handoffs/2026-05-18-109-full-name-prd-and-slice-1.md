---
date: 2026-05-18
build_id: full-name
session_type: planning + implementation
machine: TheLaunchPad
related: ["[[2026-05-18-86-request-context-cleanup]]"]
---

# Build full-name Handoff — 2026-05-18 (twenty-first session — **new PRD #109 filed + decomposed into 6 slice issues #110–#115; slice #110 IMPLEMENTED, committed and MERGED to `main` (`d6ca443`); issue #110 CLOSED**)

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

- **#111–#114 are now unblocked and parallel-grabbable.** #111 is the one that actually fixes Eric's contract gap; #112 fixes the intake form.
- **#115 cleanup** stays blocked until #111–#114 all land.

## Open threads

- **Slice #110 was merged straight to `main`** at Eric's request (`d6ca443`) — no PR/review gate this time, overriding the usual `feedback_pause_between_issues.md` pause. The merge also pulled in origin's PR #108 (iPad fullscreen fix). The `worktree-110-full-name-schema` worktree is now merged and can be removed.
- **The migration has been applied to the production DB** (`rzzprgidqbnqcdupmpfe`) via the Supabase MCP, migration name `contacts_full_name_coexistence`. Verified post-apply: all 23 contacts backfilled (0 null, 0 mismatched), the `contacts_sync_name` trigger exercised in both directions (split, join, whitespace-normalize, single-token) by a self-rolling-back round-trip test — no test rows persisted.
- **Bounded coexistence is deliberate.** `full_name` is NULLable and the legacy columns remain through slices #111–#114; the trigger keeps them in lockstep. #115 drops the columns + trigger and makes `full_name NOT NULL`. The TS helper and the PL/pgSQL trigger must be kept in lockstep until then.
- **QuickBooks trigger untouched in #110.** `trg_qb_enqueue_contact_update` still watches `first_name`/`last_name`; that is correct for slice 1 (the coexistence trigger keeps the legacy columns populated). #114 updates it to watch `full_name`.
- **Pre-existing unrelated typecheck error** — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.
- This build does **not** overlap the open #95 security-triage issues (#96–#107) or the Request Context PRD #78 — no contention.

## Mechanical state

- **`main`:** `d6ca443` — slice #110 (`58f02db`) merged in, plus origin's PR #108 iPad fix merged in. Pushed to `origin/main`. (Note: the prior-session local-only commit `6aa3e73` / #95 PRD was also pushed for the first time as part of this.)
- **Branch:** `worktree-110-full-name-schema` (`58f02db`) — merged into `main`, worktree at `.claude/worktrees/110-full-name-schema` can be cleaned up.
- **Source commits this session:** one (`58f02db`), merged to `main`. **Migrations:** one (`migration-110-...`), merged **and applied** to the production Supabase DB (`rzzprgidqbnqcdupmpfe`) + verified. **Vercel deploy:** auto on the `main` push. **Issue #110:** CLOSED.
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

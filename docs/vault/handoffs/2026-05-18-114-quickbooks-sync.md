---
date: 2026-05-18
build_id: full-name
session_type: implementation
machine: TheLaunchPad
related: ["[[2026-05-18-109-full-name-prd-and-slice-1]]", "[[2026-05-18-112-intake-form-full-name]]", "[[2026-05-18-111-merge-fields-contract-templates]]"]
---

# Build full-name Handoff — 2026-05-18 (twenty-third session — **slice #114 IMPLEMENTED, MERGED to `main` (`7e75d72`) and pushed; `migration-114` APPLIED to the production DB; issue #114 CLOSED**)

## What shipped this session

The fifth slice of PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) (combine customer first/last name into a single `full_name`). Issue [#114](https://github.com/ericdaniels22/Nookleus/issues/114) — "full_name slice 5: QuickBooks sync". The QuickBooks customer sync now reads the single `contacts.full_name` instead of the legacy `first_name`/`last_name`.

Work was done in worktree `.claude/worktrees/114-quickbooks-sync` (branch `worktree-114-quickbooks-sync`), then merged to `main`.

**Drift corrected at orientation:** orientation was done against the `#112` handoff/`00-NOW.md`, which still listed **#111 as open and the contract-gap fix still outstanding**. In fact #111 ("merge fields & contract templates") had already merged (`5963211`, branch `worktree-111-merge-fields`) and was CLOSED, with its own vault handoff `[[2026-05-18-111-merge-fields-contract-templates]]`. My `#114` push (`5963211..7e75d72`) carried that already-merged #111 commit along. So PRD #109 is further along than the #112 handoff implied.

**Slice #114 implemented** (source commit `477cc54`):

- **`src/lib/qb/sync/customers.ts`** — `buildCustomerPayload` now sets the QuickBooks `DisplayName` from `contacts.full_name` and derives `GivenName`/`FamilyName` with the shared `splitName` last-space helper (`src/lib/contact-name.ts`) so QuickBooks' name fields stay populated. `buildSubCustomerPayload` uses the split family name (falling back to the given name, then `"Customer"`) as the sub-customer DisplayName prefix — preserving the prior `last_name`-prefixed behavior. Both `contacts` `.select(...)` queries fetch `full_name` instead of `first_name, last_name`; the `ContactRow` interface exposes `full_name`. `displayName()` now takes a single `fullName` string. The two payload builders + `ContactRow`/`JobRow` were exported to make them testable.
- **`src/lib/qb/sync/customers.test.ts`** (new) — the payload builders were previously **untested**. Built test-first (TDD): **11 tests** covering `DisplayName` from `full_name`, `GivenName`/`FamilyName` via the last-space split, single-token names, the `(no name)` fallback, whitespace trimming, phone/email/notes carry-through and omission, and the sub-customer prefix (family → given → `"Customer"`) plus `ParentRef`/`BillAddr`/`ClassRef`.
- **`supabase/migration-114-qb-enqueue-contact-update-full-name.sql`** (new) — `CREATE OR REPLACE` of `trg_qb_enqueue_contact_update`; the change-detection `IS NOT DISTINCT FROM` block now watches `full_name` instead of `first_name`/`last_name`, so a name edit still re-triggers a customer sync. Everything else in the function (the `qb_customer_id` guard, `qb_get_active_connection()` lookup, dedup, `organization_id`-carrying INSERT) is preserved verbatim from the build54 version.

**Verification:** typecheck clean on the changed surface (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` remains); lint clean on the changed surface; full suite **339 green / 53 files** (was 328/52, +11 for the new `customers.test.ts`). Before applying the migration the live `trg_qb_enqueue_contact_update` definition was fetched read-only and confirmed to match the build54 version the migration replaces.

## What's next

- **#113 (display sites & contact UI) is the only remaining open slice of PRD #109.** #110, #111, #112, #114 are all done.
- **#115 cleanup is now blocked solely by #113.** Once #113 lands, #115 (drop the legacy `first_name`/`last_name` columns + the `contacts_sync_name` coexistence trigger, make `full_name` `NOT NULL`) unblocks.

## Open threads

- **Slice #114 was merged straight to `main`** (`7e75d72`) — no PR/review gate, consistent with #110 and #112, overriding the usual `feedback_pause_between_issues.md` pause.
- **`migration-114` is applied to the production DB** (`rzzprgidqbnqcdupmpfe`, migration name `qb_enqueue_contact_update_full_name`). Verified post-apply: `trg_qb_enqueue_contact_update` now references `NEW.full_name` and no longer references `first_name`.
- **Bounded coexistence still in force.** The #110 `contacts_sync_name` trigger keeps `full_name` ⇄ `first_name`/`last_name` consistent, so the QB enqueue trigger watching only `full_name` still catches every name edit during the transition. The legacy columns + that trigger are dropped in #115.
- **Two `qb` routes are intentionally never auto-name-affected** — n/a here; the QB name change is entirely in the sync payload builders + the enqueue trigger.
- **`supabase/schema.sql` is stale** — it still shows `contacts.first_name text NOT NULL` and has no `full_name` column or `trg_qb_enqueue_contact_update`. It has not been kept in sync since at least #110; this slice did not update it either (consistent with #110/#112). Not in scope.
- **Two crew password-reset builds shipped without handoffs** (`6a0df10`/`6c84ada` and `7da70d2`/`a4f7659`) — still undocumented in the vault. Not investigated this session.
- **Pre-existing unrelated typecheck error** — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.

## Mechanical state

- **`main`:** `7e75d72` — pushed to `origin/main`. Two commits this session: `477cc54` (slice #114 source), `7e75d72` (merge). The push range `5963211..7e75d72` also carried the already-merged #111 merge commit (`5963211`) to origin for the first time.
- **Branch:** `worktree-114-quickbooks-sync` was merged into `main` and **deleted**; the worktree at `.claude/worktrees/114-quickbooks-sync` was **removed**. Other worktrees still present from parallel/older work: `110-full-name-schema`, `113-display-sites-contact-ui`.
- **Migrations:** one (`migration-114-qb-enqueue-contact-update-full-name.sql`), merged **and applied** to the production Supabase DB (`rzzprgidqbnqcdupmpfe`, name `qb_enqueue_contact_update_full_name`) + verified.
- **Vercel deploy:** auto on the `main` push.
- **GitHub:** PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) OPEN; [#110](https://github.com/ericdaniels22/Nookleus/issues/110), [#111](https://github.com/ericdaniels22/Nookleus/issues/111), [#112](https://github.com/ericdaniels22/Nookleus/issues/112), [#114](https://github.com/ericdaniels22/Nookleus/issues/114) CLOSED; [#113](https://github.com/ericdaniels22/Nookleus/issues/113), [#115](https://github.com/ericdaniels22/Nookleus/issues/115) OPEN, both `ready-for-agent`.
- **Memories:** none saved this session.

## Notes for next session

- **#113 is the last feature slice; #115 is the cleanup.** Grab #113 next; #115 follows once #113 lands.
- `contact-name.ts` (`splitName`/`joinName`) is the shared name primitive; #114's QB payload + the #110 `contacts_sync_name` trigger + the #114 enqueue trigger all mirror the last-space split.
- The PRD is the design of record — there is no `docs/superpowers/specs` doc for this build.
- Still queued, untouched: #58 umbrella has #62 + #63 `ready-for-agent`; the #68 real-email demo remains on Eric's plate.
- `00-NOW.md` is still bloated (~hundreds of KB of stacked `last_verified` entries) — a trim is still overdue.

## Links

- PRD: [#109](https://github.com/ericdaniels22/Nookleus/issues/109) — Combine customer first/last name into a single full_name
- This slice: [#114](https://github.com/ericdaniels22/Nookleus/issues/114) — QuickBooks sync
- Remaining slices: [#113](https://github.com/ericdaniels22/Nookleus/issues/113) · [#115](https://github.com/ericdaniels22/Nookleus/issues/115)
- Prior sessions: [[2026-05-18-112-intake-form-full-name]] · [[2026-05-18-111-merge-fields-contract-templates]]
- Current state: [[00-NOW]]

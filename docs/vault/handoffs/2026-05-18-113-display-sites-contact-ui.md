---
date: 2026-05-18
build_id: full-name
session_type: implementation
machine: TheLaunchPad
related: ["[[2026-05-18-109-full-name-prd-and-slice-1]]", "[[2026-05-18-111-merge-fields-contract-templates]]", "[[2026-05-18-114-quickbooks-sync]]"]
---

# Build full-name Handoff — 2026-05-18 (twenty-fourth session — **slice #113 IMPLEMENTED, MERGED to `main` (`c19a59b`) and pushed; issue #113 CLOSED**)

## What shipped this session

The fourth slice of PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) (combine customer first/last name into a single `full_name`). Issue [#113](https://github.com/ericdaniels22/Nookleus/issues/113) — "full_name slice 4: display sites & contact UI". Every place that displayed or edited a customer name now reads the single `contacts.full_name` instead of concatenating `first_name + last_name`.

Work was done in worktree `.claude/worktrees/113-display-sites-contact-ui` (branch `worktree-113-display-sites-contact-ui`), then merged to `main`. No migration this slice — `full_name` already exists and is kept populated by the #110 `contacts_sync_name` coexistence trigger; the dialogs write only `full_name` and the trigger derives the legacy `first_name`/`last_name` columns.

**Drift corrected at orientation / mid-session:** orientation was run against the #112 handoff, which listed #111, #113, #114 all open and `main` at `398b6bf`. By session start `main` was at `40d2f95` (the #112 vault commit). During the session #111 and #114 each merged to `main` from their own parallel sessions (`5963211` #111, `7e75d72` #114) — so the #113 worktree branched from `40d2f95` but the #113 merge landed on top of `7e75d72`. Git merged clean (no file overlap with #111/#114). The #114 vault-record commit `3b4bb62` then landed on top of the #113 merge and was pushed, carrying the #113 commits to `origin`.

**Slice #113 implemented** (source commit `e4f398e`, 11 files, +58 / −112):

- **Display sites** — `job-card.tsx`, `job-detail.tsx` (header `contactName`, condensed homeowner card, `AdjusterCard`, the `ContractsSection` `customerName` prop), `jobs/page.tsx` job card, `contacts/page.tsx` (list heading, search filter, delete-confirm), `estimate-builder/customer-block.tsx`, `estimates/[id]/page.tsx`, and the Jarvis surfaces — `lib/jarvis/tools.ts` (`toolGetJobDetails` customer + adjuster name, `toolSearchJobs` select + customer name), `api/jarvis/chat/route.ts` (the `JobAdjusterRow` interface, the job-context select, customer + adjuster name), `api/jarvis/field-ops/route.ts` — all switched from `${first_name} ${last_name}` to `contact.full_name` / `adjuster.full_name`. Supabase nested-select strings narrowed from `(first_name, last_name)` to `(full_name)` where they weren't already `(*)`.
- **Contact UI** — the `contacts/page.tsx` add/edit dialog, the `job-detail.tsx` `EditContactDialog`, and the `job-detail.tsx` `AddAdjusterDialog` create-new mode each replaced their two First/Last `Input`s with one **"Full Name"** input; form state, `useEffect` population, validation copy ("Full name is required"), and the `contacts` upsert payload all collapsed to `full_name`. The `AddAdjusterDialog` existing-adjuster search switched its `.or(...)` `ilike` filter from `first_name`/`last_name` to `full_name`, and its result rows display `c.full_name`.
- **Read paths** — `api/settings/export/route.ts` contacts CSV `.select(...)` swapped `first_name, last_name` → `full_name` (the CSV header column becomes `full_name`); `api/accounting/profitability/route.ts` selects `id, full_name` and sets `customer_name` from `c.full_name`.

No new pure module and no new tests — #113's spec calls for none (unlike #110/#111/#114, which each extracted a tested module); the display/dialog conversions are mechanical.

**Verification:** typecheck clean on the changed surface (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` remains). Lint clean on the changed surface — the 17 lint problems on the touched files were confirmed **identical** to the base (`git stash`) count: all pre-existing `react-hooks/set-state-in-effect` / `no-unused-vars` / one `no-explicit-any`, **zero new**. Full suite on the #113 branch **328 green / 52 files** (unchanged baseline, no new tests); re-run on merged `main` (with #111 + #114 in) **348 green / 54 files**.

## What's next

- **#115 cleanup is now the only remaining open slice of PRD #109.** #110, #111, #112, #113, #114 are all done. #115 drops the legacy `first_name`/`last_name` columns + the `contacts_sync_name` coexistence trigger, makes `full_name` `NOT NULL`, removes the dead transitional split/join code, and finalizes the `Contact` type.
- **Before #115 can safely drop the columns**, the un-slotted readers below must be migrated — otherwise #115 breaks them.

## Open threads

- **Slice #113 was merged straight to `main`** (`c19a59b`) — no PR/review gate, consistent with #110/#112/#114.
- **Un-slotted legacy readers — IMPORTANT for #115.** #113 was scoped strictly to the issue's explicit site list. These files still read `contacts.first_name`/`last_name` and are **named in no PRD #109 slice**, so #115 as currently written ("drop old columns") would break them: `src/components/invoices/invoice-list-client.tsx` + `invoice-read-only-client.tsx`, `src/app/invoices/[id]/page.tsx`, `src/app/api/invoices/route.ts` + `invoices/[id]/route.ts`, `src/lib/payment-emails.ts`, `src/app/api/payment-requests/route.ts`, `src/app/api/email/contacts/route.ts`, `src/lib/pdf-renderer/render-and-upload.ts`, `src/app/api/jobs/[id]/contact-email/route.ts`, `src/app/api/settings/contract-templates/jobs/route.ts`. (`stripe/webhook/handlers/charge-refunded.ts` also matches but reads `user_profiles`, a different table — not affected.) **#115 must widen its scope to sweep these, or a #113-followup must convert them first.**
- **Bounded coexistence still in force.** The #110 `contacts_sync_name` trigger keeps `full_name` ⇄ `first_name`/`last_name` consistent, so the #113 dialogs writing only `full_name` still satisfy the legacy `first_name NOT NULL` column, and the un-slotted readers above still work — until #115 drops the columns + trigger.
- **`supabase/schema.sql` is stale** — still shows `contacts.first_name text NOT NULL`, no `full_name`. Not kept in sync since #110; #113 touched no SQL. Not in scope.
- **Two crew password-reset builds shipped without handoffs** (`6a0df10`/`6c84ada` and `7da70d2`/`a4f7659`) — still undocumented in the vault.
- **Pre-existing unrelated typecheck error** — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.

## Mechanical state

- **`main`:** local `3b4bb62` = `origin/main` (clean, up to date). #113 added two commits — `e4f398e` (slice #113 source) and the merge `c19a59b`; both are on `origin/main`, pushed as part of the #114 session's `3b4bb62` push. The `git push origin main` at the end of this session reported "Everything up-to-date" for that reason.
- **Branch:** `worktree-113-display-sites-contact-ui` was merged into `main` and **deleted**; the worktree at `.claude/worktrees/113-display-sites-contact-ui` was **removed**. One stale worktree remains: `.claude/worktrees/110-full-name-schema` (`worktree-110-full-name-schema`, `58f02db`) — long merged, never cleaned up.
- **Migrations:** none this slice.
- **Vercel deploy:** auto on the `main` push.
- **GitHub:** PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) OPEN; [#110](https://github.com/ericdaniels22/Nookleus/issues/110)–[#114](https://github.com/ericdaniels22/Nookleus/issues/114) all CLOSED; [#115](https://github.com/ericdaniels22/Nookleus/issues/115) OPEN, `ready-for-agent`, now unblocked.
- **Memories:** none saved this session.

## Notes for next session

- **#115 is the last slice.** Grab it next — but first read the "Un-slotted legacy readers" thread above: #115's spec must be widened to sweep the invoices / payment-emails / email-picker / pdf-renderer / contact-email / contract-templates-jobs readers, or they break when the columns drop.
- `contact-name.ts` (`splitName`/`joinName`) is the shared name primitive; #115 keeps `splitName` (still used by #114's QuickBooks payload) and removes the transitional `joinName`.
- The PRD is the design of record — there is no `docs/superpowers/specs` doc for this build.
- Still queued, untouched: #58 umbrella has #62 + #63 `ready-for-agent`; the #68 real-email demo remains on Eric's plate.
- `00-NOW.md` is still bloated (~hundreds of KB of stacked `last_verified` entries) — a trim is still overdue.

## Links

- PRD: [#109](https://github.com/ericdaniels22/Nookleus/issues/109) — Combine customer first/last name into a single full_name
- This slice: [#113](https://github.com/ericdaniels22/Nookleus/issues/113) — display sites & contact UI
- Remaining slice: [#115](https://github.com/ericdaniels22/Nookleus/issues/115) — drop old columns & cleanup
- Prior sessions: [[2026-05-18-114-quickbooks-sync]] · [[2026-05-18-111-merge-fields-contract-templates]]
- Current state: [[00-NOW]]

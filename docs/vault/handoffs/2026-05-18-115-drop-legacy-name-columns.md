---
date: 2026-05-18
build_id: full-name
session_type: implementation
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-18-113-display-sites-contact-ui]]", "[[2026-05-18-114-quickbooks-sync]]", "[[2026-05-18-109-full-name-prd-and-slice-1]]"]
---

# Build full-name Handoff — 2026-05-18 (twenty-fifth session — **slice #115 IMPLEMENTED, MERGED to `main` (`36e3bc2`) and pushed; `migration-115` APPLIED to the production DB; issue #115 CLOSED; PRD #109 CLOSED — the full-name migration is COMPLETE**)

## What shipped this session

The sixth and final slice of PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) (combine customer first/last name into a single `full_name`). Issue [#115](https://github.com/ericdaniels22/Nookleus/issues/115) — "drop old columns & cleanup". With every reader and writer on `full_name`, the transitional machinery is gone.

Work was done in worktree `.claude/worktrees/115-drop-legacy-name-columns` (branch `worktree-115-drop-legacy-name-columns`), then merged `--no-ff` to `main`. The worktree + branch (local and remote) were cleaned up after the merge.

**Scope was widened before implementation.** #115's original spec named only the schema/type/helper cleanup. Per Eric's instruction this session, the GitHub issue body was widened to also sweep the un-slotted legacy readers flagged in the #113 handoff — files that still read `contacts.first_name`/`last_name` and were named in no PRD #109 slice, which the column drop would otherwise break.

**Slice #115 implemented** (source commit `08572ec`, 18 files, +100 / −112):

- **`migration-115-contacts-drop-legacy-name-columns.sql`** — drops the `contacts_sync_name_trg` trigger + `contacts_sync_name()` function, asserts every row has a non-empty `full_name`, sets `full_name NOT NULL`, drops the `first_name`/`last_name` columns. Has a `-- ROLLBACK ---` block that re-derives the legacy parts from `full_name` (but does not re-install the trigger — re-run migration-110 for that).
- **Dead transitional code removed** — `contact-name.ts`: `joinName` deleted (the migration's backfill mirror is no longer needed); `splitName` **kept** — QuickBooks (`qb/sync/customers.ts`) still derives `GivenName`/`FamilyName` from it. `contact-name.test.ts`: the 6 `joinName` test cases removed; the 7 `splitName` cases stay. `types.ts`: `Contact` now carries only `full_name` (no `first_name`/`last_name`).
- **11 widened-scope legacy readers swept to `full_name`** — `api/invoices/route.ts` + `[id]/route.ts` (nested selects), `invoices/[id]/page.tsx` (select + inline type), `invoice-list-client.tsx` (type + two display sites), `invoice-read-only-client.tsx` (prop type), `payment-emails.ts`, `api/payment-requests/route.ts`, `api/email/contacts/route.ts` (select + the `.or()` ilike filter + name join), `pdf-renderer/render-and-upload.ts`, `api/jobs/[id]/contact-email/route.ts`, `api/settings/contract-templates/jobs/route.ts`. Every `[first_name, last_name].join(" ")` collapsed to `full_name`.
- **`schema.sql`** contacts block corrected (`first_name`/`last_name` → `full_name text NOT NULL`); two stale comments in `merge-fields.ts` / `merge-field-resolver.ts` updated.

**`migration-115` applied to production** (Supabase project `rzzprgidqbnqcdupmpfe`, migration name `contacts_drop_legacy_name_columns`) — applied **after** the `main` merge + Vercel prod deploy went green, so the old deployed code's legacy reads never hit dropped columns. Verified on prod: `contacts` name column is `full_name` only (`NOT NULL`); `first_name`/`last_name` gone; `contacts_sync_name` trigger + function gone; remaining triggers are `qb_enqueue_contact_update` (#114) and `trg_contacts_updated_at`.

**Verification:** typecheck clean on the changed surface (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` remains). Lint zero-new — the one `react-hooks/set-state-in-effect` in `invoice-list-client.tsx:81` is a pre-existing untouched `useEffect`. Full suite **342 green / 54 files** (baseline 348 − the 6 intentionally-removed `joinName` cases).

Issue [#115](https://github.com/ericdaniels22/Nookleus/issues/115) and PRD [#109](https://github.com/ericdaniels22/Nookleus/issues/109) both CLOSED.

## What's next

- **PRD #109 is fully done — no remaining slices.** `contacts` stores a single `full_name`; the transition is over.
- Still queued / untouched (carried from the #113 handoff): the #58 umbrella has #62 + #63 `ready-for-agent`; the #68 real-email demo remains on Eric's plate; the ungated-endpoint security triage PRD exists at `docs/superpowers/specs/2026-05-18-ungated-endpoint-security-triage-prd.md`.

## Decisions locked

- **#115's scope is widened to sweep the un-slotted legacy readers** — Eric directed this explicitly ("widen its scope to handle legacy readers"). The GitHub issue body was updated to record the 11 files before implementation.

## Open threads

- **Two crew password-reset builds shipped without handoffs** — `crew-password-reset` (`6a0df10`/`6c84ada`) and `crew-password-reset-copylink` (`7da70d2`/`a4f7659`), both now merged to `main`, still undocumented in the vault.
- **`00-NOW.md` is bloated** — the body sections ("Current build" etc.) are stale (stuck at slice #70 / fourteenth session); only the stacked `last_verified` frontmatter is being maintained. A trim/rewrite is overdue.
- **`schema.sql` is still stale in other respects** — #115 fixed only the `contacts` name columns; it has not been kept in sync with later migrations generally.
- **Pre-existing typecheck error** — `sync-folder-incremental.test.ts` `TS2322`, untouched; filter it from repo-wide typecheck.
- Two unrelated worktrees remain on disk: `.claude/worktrees/84-request-context-settings` and `.claude/worktrees/85-request-context-email-jarvis` (request-context work, not full-name).

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `36e3bc2` (Merge worktree-115-drop-legacy-name-columns: drop legacy name columns, finalize full_name (#115))
- **Uncommitted changes:** none (untracked `out/` build dir only)
- **Migrations applied this session:** `migration-115` / `contacts_drop_legacy_name_columns` — applied to production (`rzzprgidqbnqcdupmpfe`)
- **Deployed to Vercel:** yes — `36e3bc2`, prod deploy confirmed green before the migration ran

## Notes for next session

The full-name PRD is closed. The one durable lesson worth carrying: when a slice both ships breaking-for-old-code SQL and changes app code, the order is **merge → wait for the Vercel deploy to go green → then apply the migration**. Dropping the legacy columns before the new code is live would have 500'd the un-slotted readers; polling the GitHub commit status for the `Vercel` context until `success` is a reliable gate.

The widened-scope sweep is the reason #115 touched 18 files instead of ~4 — the original spec under-scoped it. The 11 extra readers were all mechanical `[first_name, last_name].join(" ")` → `full_name` conversions; the `Contact` type losing its legacy fields is what makes the typechecker catch any future stragglers.

`splitName` in `contact-name.ts` is intentionally kept — it is the sole surviving name primitive, used only by the QuickBooks customer sync. Do not remove it.

## Links

- PRD: [#109](https://github.com/ericdaniels22/Nookleus/issues/109) — Combine customer first/last name into a single full_name (CLOSED)
- This slice: [#115](https://github.com/ericdaniels22/Nookleus/issues/115) — drop old columns & cleanup (CLOSED)
- Prior sessions: [[2026-05-18-113-display-sites-contact-ui]] · [[2026-05-18-114-quickbooks-sync]]
- Current state: [[00-NOW]]

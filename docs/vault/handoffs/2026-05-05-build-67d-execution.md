---
date: 2026-05-05
build_id: 67d
session_type: focused
machine: Eric (TheLaunchPad)
related: ["[[build-67d]]", "[[build-66]]", "[[build-67c2]]", "[[2026-05-05-build-67d-planning]]"]
---

# Build 67d Execution Handoff — 2026-05-05

Continuation of the morning's planning session ([[2026-05-05-build-67d-planning]]). Executed Tasks 1-24 of the 27-task plan via subagent-driven-development (SDD) with hybrid-B reviewer discipline. Schema applied to prod, all 8 trash routes shipped, both shared dialogs + read-only banners + edit redirects live, `npx tsc --noEmit` clean throughout. 23 commits on top of the planning-session HEAD (`195325f`); current HEAD `f117b3b` is unpushed at handoff start. Tasks 25-27 (manual test pass + code-reviewer pass + orphan PDF cleanup) deferred to a fresh session.

## What shipped this session

### Phase 0 — Pre-flight (Task 1)

Four read-only Supabase MCP captures against prod. Three matched plan expectations (CHECK list 17 values, child cascades intact, no `contract_events` parent FK to estimates/invoices). Fourth surfaced a **material divergence**: the estimates-side back-pointer FK is named `fk_estimates_converted_to_invoice`, NOT the plan-template-assumed `estimates_converted_to_invoice_id_fkey`. Capture file landed at `docs/superpowers/specs/2026-05-05-build-67d-preflight-capture.md` (transient — gitignored at handoff time, not committed).

### Phase 1 — Migration (Tasks 2-3)

`supabase/migration-build67d-soft-delete-estimates-invoices.sql` (231 lines) committed at `8a8f594` and applied to prod via `apply_migration` MCP. Includes: `deleted_at` + `delete_reason` columns on both tables, composite `(organization_id, deleted_at)` indexes, both convert-linkage FKs flipped to `ON DELETE SET NULL` (estimates-side correctly drops by `fk_estimates_converted_to_invoice` then standardizes to `estimates_converted_to_invoice_id_fkey`), `contract_events.event_type` CHECK widened from 17 → 23 values (+ 6 new `*_trashed/*_restored/*_purged`), and `convert_estimate_to_invoice` RPC body verbatim from `pg_get_functiondef` plus a single-char addition `AND deleted_at IS NULL` on line 99's source-estimate SELECT (`FOR UPDATE`). All 4 smoke checks passed: 4 columns, 2 indexes, 2 FKs with `ON DELETE SET NULL`, 23-value CHECK.

### Phase 2-3 — Types + helpers (Tasks 4-6)

- `c2b22a5` types(67d): added `deleted_at` + `delete_reason` to `Estimate` and `Invoice` interfaces. Necessary side-effect: `src/lib/sample-pdf-data.ts` had typed object literals that required the new fields (mechanical consequence of adding non-optional fields to interfaces — folded into the same commit).
- `35e7ffe` lib(67d): `src/lib/api/assert-not-trashed.ts` — tiny gate (`row?.deleted_at` → 404 NextResponse, else null).
- `c907827` lib(67d): `src/lib/documents/purge.ts` — `purgeEstimateStorage` + `purgeInvoiceStorage` mirroring `src/lib/jobs/purge.ts`. Authed-client row fetch (RLS), service-client bucket remove.

### Phase 4 — Estimate trash routes (Tasks 7-10)

- `6398f79` `POST /api/estimates/[id]/delete` — soft-delete, audit `estimate_trashed`
- `fac8228` `POST /api/estimates/[id]/restore` — clears `deleted_at`/`delete_reason`, audit `estimate_restored`
- `15d38c9` `GET /api/estimates/trash` — lazy 30d auto-purge + list, optional `?job_id=` scope
- `4837ea2` flipped `DELETE /api/estimates/[id]` from soft-void to hard-purge + added `deleted_at` guard to PUT in the same file

### Phase 5 — Invoice trash routes (Tasks 11-14)

Mirror of Phase 4 with `manage_invoices` permission key + `invoice_*` event types:
- `cca2fb5` `POST /api/invoices/[id]/delete`
- `2533128` `POST /api/invoices/[id]/restore`
- `1184cda` `GET /api/invoices/trash`
- `6f3b1b8` `DELETE /api/invoices/[id]` — **plan claimed no DELETE existed but one did** (soft-void via `voidInvoice` from `@/lib/invoices`). Subagent correctly replaced the body, dropped the now-unused `voidInvoice` import (helper itself untouched), flipped permission gate `edit_invoices`→`manage_invoices`, and added the same PUT trashed guard.

### Phase 6 — Mutating-route guard sweep (Tasks 15-16)

20 file modifications adding `assertNotTrashed` to every existing mutating estimate + invoice route:

- `391ad6e` Estimate side (10 files): send/preview/pdf/convert/sections/sections-by-id/line-items/line-items-by-id/status/apply-template. For 4 of these (`pdf`, `convert`, `sections` POST+PUT, `apply-template`) a small new `deleted_at` fetch was added since no existing parent fetch was reusable.
- `bbd03bd` Invoice side (10 files): send/preview/pdf/sections/sections-by-id/line-items/line-items-by-id/status/mark-sent/void. The status route DOES exist on the invoice side (plan was unsure). `mark-sent` and `void` use service-client fetches; `deleted_at` added inline there.

GET-by-id routes intentionally unfiltered.

### Phase 7 — Active-list filters (Task 17 + scope-extension follow-up)

- `1e23f33` API routes: `.is("deleted_at", null)` on `GET /api/estimates` and `GET /api/invoices` list queries.
- `cbbf209` follow-up: plan listed only 4 sites for Task 17, but a controller spot-check after the subagent landed surfaced 5 additional aggregation sites that would let trashed invoices inflate displayed totals:
  - `src/components/job-detail.tsx` per-job invoiced widget
  - `src/lib/accounting/margins.ts` per-job + global margin calcs (2 sites)
  - `src/lib/jarvis/tools.ts` per-job invoice list + cross-job outstanding-balance aggregation (2 sites)

  All 5 filtered. **QB sync paths intentionally unchanged** — `src/lib/qb/sync/invoices.ts` and `…/payments.ts` need a deliberate decision (push QB delete on trash? leave stale?) that's out of 67d scope.

### Phase 8 — UI (Tasks 18-24)

- `20abadd` `TrashConfirmDialog` shared component (with reason input, autofocus, Enter-to-submit, Escape-to-cancel, in-flight blocking)
- `153efef` `ForceDeleteConfirmDialog` shared component
- `3598fb7` per-job rewire: removed inline `VoidConfirmDialog` + `voidTarget`/`isVoiding` state + `handleVoidConfirm`; added Trash + Force-delete state, handlers (with toast Undo→Restore action), per-row Trash button gated on `useAuth().hasPermission("manage_estimates")`. Any-status trashable per Q1=A.
- `6460685` per-job "Show trashed" toggle: checkbox in section header, `useEffect`-driven dual fetch from `/api/{estimates,invoices}/trash?job_id=...`, muted-row rendering with "In trash · X days left" + Restore/Delete-now buttons. **Note:** invoices half of the section uses an existing `<InvoicesList>` child component that wasn't modified per task boundary; trashed invoice rows render in a parallel table below `<InvoicesList>`. Trashing an active invoice from the per-job view requires using the invoice's own read-only page (covered by Task 23's banner) or the global `/invoices` list (Task 22).
- `5eacd86` `/invoices` Trash filter chip: widened the `StatusFilter` union with `"trash"`, branched the existing `refresh` callback, separate `trashRows` state, hoisted `daysLeft` to `src/lib/trash/days-left.ts` so per-job and global views share one helper.
- `7cdc6ae` `TrashedBanner` shared component (amber banner with Restore + Delete-now); applied to estimate read-only via `EstimateWithContents.deleted_at` direct access; applied to invoice read-only via `isTrashed` + `deletedAt` props passed through to `InvoiceReadOnlyClient` (which now gates Edit/Send/Payment Request/Record Payment/Export PDF buttons behind `{!isTrashed && ...}`).
- `f117b3b` server-component redirects on both edit pages (`redirect('/estimates/{id}')` / `redirect('/invoices/{id}')`) when `deleted_at` is set.

## What's next

Three tasks remain. Recommended order:

1. **Task 25 — §11 manual test pass.** 12 scenarios in spec §11. Run via `npm run dev` against prod Supabase Test Co. Test fixtures from 67c2 wrap (`WTR-2026-T67C2` job + 5 estimates A–E + 1 invoice in Test Co) likely still exist; reuse them or wipe and recreate. Should take ~45-60 min.
2. **Task 26 — `superpowers:code-reviewer` pass.** Mirror 67c2's pattern (3 fix-now findings + several deferred). Best with fresh eyes after the test pass surfaces any behavioral issues.
3. **Task 27 — One-off MCP cleanup of 67c1 orphan PDFs.** Real org id captured from `storage.objects` first (don't paste the placeholder `a0000000-XXXX-…` UUID). Two paths:
   - `INV-2.pdf` and `INV-3.pdf` purged via `DELETE FROM storage.objects WHERE bucket_id='pdfs' AND name='<real-org>/WTR-2026-0018/INV-{2,3}.pdf'` (the rows are already gone — orphan storage only).
   - `EST-7.pdf` cleaned via the new trash flow when EST-7 is eventually trashed (the row is still live, status=`sent`).

After all three: push (currently 23 commits unpushed at handoff start), then write the wrap handoff.

## Decisions locked

None this session. The 7 brainstorm decisions were locked in the morning's planning session.

## Open threads

### From the build itself

- **Per-job trashing of an active invoice**: requires using the invoice's own read-only page (banner has Delete-now → can also use the modal-driven trash flow there) or the global `/invoices` list. The per-job `<InvoicesList>` child component wasn't modified. Acceptable boundary call but worth flagging — could add a Trash button to `<InvoicesList>` rows in a follow-up if Eric wants symmetric per-job UX.
- **QB sync paths intentionally not filtered for trashed invoices.** `src/lib/qb/sync/invoices.ts` lines 86-89 (the unsynced-invoices fetch) and `src/lib/qb/sync/payments.ts:177` (single invoice read-by-id for payment sync) both query without `.is("deleted_at", null)`. Decision deferred: should sync push a QB delete when an invoice is trashed-after-synced? Or leave QB stale? Out of 67d scope.
- **Manual test pass owed.** Task 25 not run.

### Inherited

- **AAA QB sandbox token refresh** still punted to Eric's OAuth flow.
- **C1 from 67c2:** SendModal stays visually open after successful send (base-ui Dialog flips `data-closed` but `display: grid` persists). Same flaw inherited by `TrashConfirmDialog` and `ForceDeleteConfirmDialog` since they use the same `@/components/ui/dialog` wrapper. Cosmetic; functional state correct.
- **Build-wide settings-pages consistency pass** still pending from 67c1.
- **F4-F8 follow-ups from 67c2** still deferred.

## Mechanical state

| Knob | State |
|---|---|
| Branch | `main` |
| Commit at session end | `f117b3b` (`ui(67d): edit pages redirect to read-only when doc is trashed`) |
| Commit at session start | `195325f` (`vault: mark 67d planning session pushed`) |
| Commits this session | 23 |
| Uncommitted changes | 1 untracked file (`docs/superpowers/specs/2026-05-05-build-67d-preflight-capture.md` — transient by plan design, intentionally not committed) |
| Migrations applied this session | `build67d_soft_delete_estimates_invoices` |
| Deployed to Vercel | n/a (unpushed at handoff start; will deploy on push) |
| `npx tsc --noEmit` | clean (verified after each commit batch + final run after Task 24) |
| Active workspace | Test Co (`a0…0002`) — leftover from 67c2 wrap, no impact |

## Notes for next session

- **Pre-flight discipline paid off again, twice.** Task 1's pre-flight caught the `fk_estimates_converted_to_invoice` FK-name divergence before the migration ran (would have left two FKs on the same column with different ON DELETE semantics; the NO ACTION FK would have continued to block hard-purge). Task 14's "plan said no DELETE existed but one did" was caught at file-read time by the subagent. Same pattern as the 2026-05-05 morning learning ("a spec is a draft, not a contract — grep an existing call site"): both saved by the subagent reading the actual code before writing.

- **Active-list filter scope is wider than the plan's enumeration.** Task 17's plan listed 4 sites; controller spot-check after the subagent reported DONE found 5 more aggregation sites (`job-detail.tsx`, `accounting/margins.ts` ×2, `jarvis/tools.ts` ×2). The general rule is: any list query that aggregates financial state needs the filter, not just the plan-named API routes. **Worth a future sweep with `grep -n 'from("\(estimates\|invoices\)")' src/`** when more soft-deletable resources land — the 67d sweep covered estimates + invoices but missed QB sync; a future build adding sync semantics will need to revisit.

- **SDD batching for tightly-coupled tasks works well.** Tasks 4-6 (3 small tasks), 7-10 (4 estimate routes), 11-14 (4 invoice routes), 15-17 (sweep + filter + follow-up), 18-19 (two dialogs), 20-21 (per-job rewire), 22-24 (global UI bits) — each batch was 2-4 sequential commits in one subagent dispatch. ~7 dispatches total for 24 tasks. Each dispatch ran self-review (read its own diff, ran tsc, then reported), and the controller did spot-checks before kicking off the next batch. The pattern matches the "hybrid-B" discipline from 67b/67c1 sessions.

- **One scope-creep correction caught at controller level.** After Task 17's subagent reported DONE, the controller's grep for `from("estimates")` / `from("invoices")` across `src/lib/` and `src/components/` found the 5 additional aggregation sites. Subagent had stopped at the plan-listed sites (correct boundary discipline) but the plan was incomplete. Controller follow-up commit `cbbf209` closed the gap. **Pattern:** after a sweep-style task, the controller should do a quick parallel grep to verify the subagent's coverage matches actual scope, especially when the plan's site list was a "from memory" enumeration vs. a fresh grep.

- **One latent base-ui Dialog issue inherited.** The two new trash dialogs use `@/components/ui/dialog` like the rest of the codebase. Per 67c2 C1, base-ui's Dialog flips `data-closed=""` but `display: grid` and `visibility: visible` persist on close — the modal stays visually open even though `open=false`. Same will be true for TrashConfirmDialog and ForceDeleteConfirmDialog. Cosmetic; user has to click X/Cancel to dismiss after Move-to-Trash succeeds. Worth fixing at the wrapper level (one place, fixes everywhere) when Eric has appetite.

- **Test fixture decision for Task 25.** The 67c2 Test Co fixtures (`WTR-2026-T67C2` job + 5 estimates A–E + 1 invoice + various preset/audit rows) would let the §11 test pass run without setup. Reuse them. The estimates' statuses span draft/sent/voided/converted, which exercises Q1=A's "any-status trashable" assertion across the dropdown options. Wipe + recreate only if confidence in the fixture state is low.

- **23 commits unpushed.** The session worked directly on `main` per the established 67-series pattern. Push happens at end of handoff. Vercel will auto-deploy on push.

- **Storage MCP for Task 27.** The Supabase MCP doesn't expose Storage delete directly; the canonical path for the orphan PDF cleanup is `DELETE FROM storage.objects WHERE bucket_id='pdfs' AND name=...` via `execute_sql`. Capture the real org id first via `SELECT name FROM storage.objects WHERE bucket_id='pdfs' AND name LIKE '%/WTR-2026-0018/INV-%.pdf'` to fill in the placeholder UUID.

- **The 67d preflight-capture file is intentionally untracked.** Per the plan ("gitignored or transient, your choice — it's just a clipboard between tasks"), it stays in the working tree as a scratch note and won't be committed. Leave it; the handoff and the migration file together preserve everything important.

## Links
- Build card: [[build-67d]]
- Current state: [[00-NOW]]
- Pattern source: [[build-66]]
- Predecessor: [[2026-05-05-build-67d-planning]]

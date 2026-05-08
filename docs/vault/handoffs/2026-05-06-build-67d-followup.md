---
date: 2026-05-06
build_id: 67d-followup
session_type: focused
machine: Eric
related: ["[[build-67d]]", "[[2026-05-05-build-67d-wrap]]"]
---

# Build 67d Follow-up Handoff — 2026-05-06

## What shipped this session

- **67d Vercel verification (top of session).** Confirmed via GitHub Deployments API that the wrap-session's two pushes both reached `state: success` in Production: deployment `4590844896` for `036edb8` (I3 + N1) at 03:54:27Z, deployment `4590580643` for `724eca3` (I1 + I2) at 03:09:41Z, plus deployment `4590893917` for the wrap handoff `6b75595` at 04:03:08Z. Live site `aaaplatform.vercel.app` 200s end-to-end (307 → /login → 200, 20.6 KB rendered, 0.57s, `Server: Vercel`). 67d formally confirmed shipped to prod before any new work began.

- **Bug found via Eric's screenshot: per-job Invoices list had no Trash affordance.** 67d wrap session's 00-NOW claimed "the previously-flagged 'per-job InvoicesList symmetric UX' follow-up is now CLOSED" — the claim was wrong. Wrap-session's I3 only updated the global `/invoices` dropdown (View/Edit/Trash); the per-job Invoices section under `/jobs/[id]` was a different surface (`<InvoicesList>` child component delegated to from `<EstimatesInvoicesSection>`) that 67d execution had explicitly skipped (file comment line 414 read "Trashed invoices — rendered below InvoicesList without modifying it"). Active invoice rows on the job page rendered "View" only — contradicting spec §1 ("trash any estimate or invoice from the per-job table"). Slipped past §11 Test 9.2 because the QA subagent invoked `POST /api/invoices/[id]/delete` via API rather than clicking a UI button; slipped past code-reviewer because it focused on the `/invoices` global dropdown for I3 specifically; slipped past wrap-session browser-verification because that ran on `/invoices` global, not on `/jobs/[id]`.

- **Fix 1 — `ce971ca` (`fix(67d): add Trash button to per-job invoice list`).** Smallest possible fix: extended the existing child `<InvoicesList>` to accept `canManage?: boolean` + `onTrash?: (row) => void` props and render a destructive-styled Trash button next to View. Parent `<EstimatesInvoicesSection>` passes `manage_invoices` permission + a `setTrashTarget({ kind: "invoice", row })` callback. `TrashConfirmDialog` wiring downstream needed no changes — the existing `handleTrashConfirm` already routed to `/api/invoices/[id]/delete` and the dialog already handled `kind: "invoice"`. Trash handler only uses `id` + `invoice_number`, so the parent's `trashTarget` invoice arm union was relaxed from `Invoice` to `Pick<Invoice, "id" | "invoice_number">` (the previous arm was unreachable — no caller existed). +31/-4 lines across 2 files. tsc clean. Vercel deployment `4596755943` reached `state: success`.

- **Fix 2 — `daa3863` (`ui(67d): replace Trash text with red Trash2 icon on per-job rows`).** Eric requested the Trash word be replaced with a small red trash-can icon. Estimate row: `<Button>` with `Trash` text → square ghost button (`h-7 w-7 p-0 text-destructive`) with `<Trash2 size={14} />`. Invoice row: bare `<button>` with `Trash` text → `<Trash2 size={14} />` icon. Both keep `title="Move {kind} to trash"` + new `aria-label="Move {kind} to trash"` for screen readers. +8/-6 lines across 2 files. tsc clean. Vercel deployment `4597544743` reached `state: success`.

- **Fix 3 — `2bcd3ea` (`ui(67d): per-job invoice card mirrors estimate card`).** Eric flagged 5 visual mismatches between the per-job Estimates card and Invoices card: (1) "+ New Invoice" missing border, (2) no column headers, (3) no Edit button, (4) spacing didn't match, (5) "any other changes". Pulled the active-invoice render inline into `<EstimatesInvoicesSection>` and deleted `<InvoicesList>` entirely — the truly-matching layout requires merging active+trashed invoices into a single `<Table>` like estimates do, which means owning all render in one place. The Invoices card now mirrors Estimates card 1:1: bordered "+ New Invoice" button (`size="sm" variant="outline"` + `<Plus size={14} />`), real `<Table>` with column headers (# / Title / Total / Status / Actions), source-estimate link `← EST` next to invoice number (mirrors estimate's `→ INV`), View (Eye) + Edit (Pencil) + Trash (icon) action buttons in same `h-7 px-2 gap-1 text-xs` ghost shape, Edit gated on `edit_invoices` AND `inv.status !== "voided" && inv.status !== "paid"` (mirrors estimate's voided/converted gate), status badge uses `getStatusBadgeClasses("invoice", ...)` for invoice-specific colors, active+trashed rows merged into one `<Table>` with trashed rows at `opacity-60 bg-muted/30`. +198/-127 lines (1 file modified, 1 deleted). tsc clean. Vercel deployment `4597674172` reached `state: success`.

- **Bonus bug fix caught during refactor.** `ce971ca` introduced a latent bug: clicking the new per-job invoice Trash button moved the row to the trash in the DB but left it visible in the active list until page reload. Cause: the old `<InvoicesList>` child only fetched on `jobId` change, never after a trash POST; the parent's `await fetchEstimates()` was a no-op for invoices because it didn't refresh the child's state. Fix landed in `2bcd3ea` as a side-effect of moving render to the parent — the parent now owns active-invoices state and calls `fetchInvoices()` after trash/restore. Same fix applies to invoice restore (previously also stale until reload).

## What's next

- **Three deferred carry-overs from 67d wrap remain unchanged and non-blocking:**
  - **Q1** — lazy 30-day auto-purge runs under `view_*` permission (jobs/trash precedent; revisit in a deliberate permission-tightening build).
  - **F2 / Q2** — audit `signer_id` left NULL on all 8 new audit-row inserts; defense-in-depth nit consistent with 67c2 audit shape.
  - **C1** — base-ui Dialog visual-stay-open quirk inherited from 67c2; affects `TrashConfirmDialog` + `ForceDeleteConfirmDialog` + the now-also-affected `SendModal`.

- **AAA QB sandbox token still expired** since 2026-04-21. Carry-over from prior sessions; refreshing requires Eric's OAuth flow.

- **67c2 reviewer carry-overs F4–F8** still open: best-effort audit warn-only on send routes, renderer 4xx errors masked as 500, settings PATCH route org-blind, `from_unconfigured` reply-shape inconsistency, migration trigger lacks `DROP TRIGGER IF EXISTS`, `BLOCKED_STATUSES` Set vs inline divergence, `MERGE_FIELDS` cross-domain coupling.

- **5xx error redactor sweep across the remaining ~80 routes.**

- **A "post-ship live screenshot pass" should be a chip on every build going forward** — see "Notes for next session" below.

## Decisions locked

- **Land all three fixes inline on `main`, no PR/worktree.** Eric explicitly: "fix it on main" → all three commits direct to main with sequential push + Vercel verify. Mirrors the 67d wrap-session's own inline-on-main pattern.
- **Trash → icon-only `<Trash2 size={14} />` with destructive color, no text.** Eric explicitly: "change the 'trash' word to a small red trash can icon." Both estimate and invoice rows updated.
- **Refactor the per-job Invoices card to match the Estimates card 1:1.** Eric explicitly enumerated 5 specific changes + "Any other changes that can be made in order to match the estimates bubble." Resulted in deleting `<InvoicesList>` and inlining all invoice render into `<EstimatesInvoicesSection>`.
- **No code-review subagent dispatch this session.** Each fix was small, mechanical, mirrored existing in-file patterns, and Vercel-verified end-to-end. Eric's recommendation accepted.

## Open threads

- All threads from this session closed inline. The "per-job InvoicesList symmetric UX" gap that the 67d wrap-session 00-NOW.md falsely declared CLOSED is now genuinely CLOSED.
- No new structural threads opened. Three pre-existing 67d carry-overs (Q1, F2/Q2, C1) unchanged.

## Mechanical state

- **Branch:** main
- **Commit at session end:** `2bcd3ea` (`ui(67d): per-job invoice card mirrors estimate card`)
- **Uncommitted changes:** 1 untracked file (`docs/superpowers/specs/2026-05-05-build-67d-preflight-capture.md` — carry-over from prior handoff, intentionally transient)
- **Migrations applied this session:** none
- **Deployed to Vercel:** yes — three pushes, three deploys, all reached `state: success`. Production alias `aaaplatform.vercel.app` now serves `2bcd3ea`. Deployment IDs: `4596755943` (ce971ca), `4597544743` (daa3863), `4597674172` (2bcd3ea).

## Notes for next session

- **The 67d wrap session's 00-NOW.md was wrong about per-job InvoicesList being closed.** Wrap-session's I3 fixed the global `/invoices` dropdown ONLY. The per-job per-row Trash affordance under `/jobs/[id]` was a separate, untouched surface. Eric caught it by literally taking a screenshot of the per-job page right after the wrap session shipped. **Pattern lesson — see "Recently learned" below.**

- **Live screenshot verification after a "shipped" build catches gaps that automated tests + code review miss.** The QA subagent's §11 Test 9.2 (per-job invoice trash) drove the trash via direct `POST /api/invoices/[id]/delete` API call — never clicked a UI button. Verified the DB result + the trashed-rows sub-section render. Missed the missing UI affordance entirely. The code-reviewer subagent focused on the global `/invoices` dropdown for I3 specifically (the explicit fix-now item) and didn't notice the per-job side. The wrap-session's browser-verification ran on `/invoices` global, not on `/jobs/[id]`. **Three independent gates — all blind to the same surface gap.** Eric's screenshot in this session was the first thing to actually look at the per-job page on prod after the build "shipped." **Going forward:** every build that ships a UI feature should end with the controller (or Eric) walking through every surface the spec mentions in a real browser session post-Vercel-deploy. Cheap, high-value, can't be delegated to a subagent because the subagent's harness fails to reach prod Supabase from inside dispatch.

- **When refactoring "duplicate UI to match a peer," watch for latent bugs in the original.** The active-list-stale bug introduced by `ce971ca` (Trash button moves row to DB but doesn't refresh active list until reload) was caught only because `2bcd3ea` consolidated state into one place — the bug surfaced as a question during the refactor ("wait, where does this re-fetch happen?") rather than from any test. The original `<InvoicesList>` had been stale-fetching its own data from the start; `ce971ca` made it visibly broken. The refactor fixed it as a side-effect. **Pattern:** when consolidating duplicated UI, the consolidation step is a natural moment to audit the original's state-management discipline. Don't just port the bug forward.

- **Type-relaxation via `Pick<Type, "field1" | "field2">` is the cleanest way to widen a state union for a new lighter-weight caller.** `ce971ca` had to make `setTrashTarget` accept a callback row from `<InvoicesList>` (which only has `id` + `invoice_number` available cheaply) but the existing union arm typed `row: Invoice` (the full DB shape). Casting `as Invoice` would've been dishonest. Defining a parallel minimal interface would've been duplicative. `Pick<Invoice, "id" | "invoice_number">` is honest about what the handler actually uses + backward-compatible (the full `Invoice` still satisfies the `Pick`). Worth remembering when a callback-style API needs to handle multiple row shapes.

- **`gh api repos/.../deployments` + `/statuses` is the canonical way to verify "Current" badge equivalence without the Vercel CLI.** Used three times this session. The `state: "success"` + `description: "Deployment has completed"` from the deployment-status endpoint is what the Vercel dashboard renders as the "Current" badge. Combine with `until ... do sleep 15; done` in `run_in_background: true` for a one-notification-when-done verify pattern. Better than poll-loops because the harness can't always sleep.

- **`<EstimatesInvoicesSection>` is now the single source of truth for per-job estimate + invoice render.** No more child `<InvoicesList>`. Estimates rendered inline (lines ~280-440 area), invoices rendered inline (lines ~440-590 area). The "Show trashed" toggle in the Estimates card header still controls both — that asymmetry stayed because Eric didn't ask to duplicate the toggle. Any future per-job estimate/invoice surface change goes in this one file.

## Links

- Build card: [[build-67d]]
- Current state: [[00-NOW]]
- Predecessor: [[2026-05-05-build-67d-wrap]] (declared 67d FULLY SHIPPED — overstated; this session caught the per-job gap)
- Related: [[2026-05-05-build-67d-execution]] (Tasks 1–24 + the comment that admitted "rendered below InvoicesList without modifying it"), [[2026-05-05-build-67d-planning]] (spec §1: "trash any estimate or invoice from the per-job table")

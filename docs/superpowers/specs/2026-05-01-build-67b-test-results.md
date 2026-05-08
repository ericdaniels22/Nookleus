# 67b manual test results — 2026-05-02

Run the spec §11 tests against the live preview. Mark PASS / FAIL per item;
record commit SHAs for inline fixes; file ambiguous issues as cleanup chips.

**Result: 15 / 15 PASS.** Two inline fixes shipped during the run
(`a936be0`, `ba1d007`); pre-flagged carry-over chips appended to
[2026-05-01-build-67b-cleanup-chips.md](2026-05-01-build-67b-cleanup-chips.md).

## Pre-flight

- [x] Confirmed `build67b-conversion-and-template-apply` migration applied
      (verified pre-session via Supabase MCP).
- [x] `npm run dev` from a fresh shell with `.env.local` loaded.
- [x] Build: `npm run build` ✓ Compiled in 17.9s with all 119 pages registered.

## Test 1 — Templates CRUD
- [x] `/settings/estimate-templates` list renders.
- [x] "+ New Template" creates a draft and redirects to `/settings/estimate-templates/[id]/edit`.
- [x] Builder loads in template mode (no customer block, no totals, no metadata bar; template-meta-bar shows; statements editable).
- [x] Edit name + description + damage tags via template-meta-bar.
- [x] Add sections + items in template mode (local synthesis short-circuits per Task 33.5).
- [x] Reload page → state preserved (rootPut auto-save persisted via `builder_state`).
- [x] Deactivate from list page; verified hidden from "active" filter and from Apply Template dropdown on a fresh estimate.
- [x] Reactivate.

Status: **PASS** — drag-and-drop reorder bug surfaced during this test (sections snapped back after drop). Diagnosed `handleDragEnd` was gated to estimate-only after Task 33.5 widening; fix at `ba1d007` added a template branch with local-state mutation for section/subsection/line-item reorders.

## Test 2 — Apply template (clean path)
- [x] Created an empty estimate from a job.
- [x] Template banner appeared (gated on sections.length === 0 + no localStorage flag + kind=estimate).
- [x] Search input filters by template name (Combobox fix `bfc838d`).
- [x] Damage-type-matching templates pinned to top.
- [x] Pick a template → toast success → router.refresh re-fetches → sections + statements populated.
- [x] Banner stays hidden on reload (localStorage flag).

Status: **PASS** — apply-template state-sync bug surfaced here ("template applied" toast fired but UI showed empty estimate). Diagnosed: `useState({ entity })` initializes only on mount; `router.refresh()` re-fetched but the new entity prop was ignored. Fix at `a936be0` added a `useEffect` keyed on `[entity.data.id, entity.data.updated_at]` to re-sync state on prop advance.

## Test 3 — Apply template (broken refs)
- [x] Created a template with library-backed line items, then deactivated one of the library items.
- [x] Applied the template to a fresh estimate.
- [x] Broken-refs banner appeared in amber with item count.
- [x] "Show items" expanded the list; click row → scrolled to matching `id="line-item-s{n}-i{n}"` (or `-sub{n}`).
- [x] Dismiss button hid the banner; localStorage flag persisted across reload.

Status: **PASS** — no inline fixes.

## Test 4 — Estimate state transitions
- [x] Estimate draft → Mark as Sent.
- [x] sent → approved → Convert button appeared.
- [x] approved → rejected.
- [x] Voiding a converted estimate blocked (400 `cannot_void_converted`).
- [x] HeaderBar Convert button disabled when estimate not approved.

Status: **PASS** — no inline fixes.

## Test 5 — Estimate → invoice conversion (clean)
- [x] On approved estimate, clicked Convert in HeaderBar.
- [x] Convert confirmation modal showed estimate number + bullets (jobNumber-INV-?, fields copied, marks as Converted, redirects).
- [x] Confirm → POST /api/estimates/[id]/convert → redirect to `/invoices/[new]/edit`.
- [x] Invoice editor rendered with copied sections, line items, markup, discount, tax, statements.
- [x] Estimate now Converted (read-only); banner / status pill reflects.
- [x] Estimate row in job-detail shows "→ INV" linkage badge.
- [x] Invoice row in job-detail shows "← from EST" linkage badge.

Status: **PASS** — no inline fixes.

## Test 6 — Estimate → invoice conversion (already converted)
- [x] Tried to re-convert an already-converted estimate.
- [x] Modal swapped to "Already converted" with "Go to invoice →" link.

Status: **PASS** — no inline fixes.

## Test 7 — Invoice editor end-to-end
- [x] `/jobs/[id]/invoices/new` creates a draft and redirects to `/invoices/[new]/edit`.
- [x] Invoice editor loads in invoice mode: customer block, MetadataBar (Issued + Due + PO + converted-from), TotalsPanel, HeaderBar Mark-as-Sent.
- [x] Add a section → POST /api/invoices/[id]/sections.
- [x] Add line item via Library tab → POST /api/invoices/[id]/line-items.
- [x] Add line item via Custom tab → POST same route.
- [x] Inline edit qty / price → PUT /api/invoices/[id]/line-items/[item_id].
- [x] Inline edit section title → PUT /api/invoices/[id]/sections/[id].
- [x] Markup / discount / tax controls update — invoice-mode totals don't recompute locally (server-side only via root PUT); UI shows stale totals briefly until auto-save returns.

Carry-over chips confirmed (filed in cleanup-chips doc):
- C1 — invoice POST /line-items response shape mismatch (`data` vs `{ line_item: data }`)
- C2 — invoice-mode drag-reorder no-op
- C3 — invoice-mode totals don't recompute locally

Status: **PASS** — no inline fixes; three behaviors confirmed as carry-overs (already pre-flagged).

## Test 8 — Invoice status state machine
- [x] draft → Mark as Sent.
- [x] sent → Record Payment (partial).
- [x] partial → Record Payment (full).
- [x] Paid is terminal (no further transitions in HeaderBar).

Status: **PASS** — no inline fixes.

## Test 9 — Read-only invoice view
- [x] `/invoices/[id]` shows new schema: title, opening statement, sections + subsections + line items, totals (subtotal / markup / discount / adjusted / tax / total), closing statement.
- [x] Edit / Send / Send Payment Request (when Stripe connected + status not voided/paid) / Record Payment (when sent/partial) / PDF buttons render per status.

Carry-over chip confirmed: C7 — /invoices list lost Customer + QB columns (Task 45 trim to spec column set). User accepted as-is for now.

Status: **PASS** — no inline fixes.

## Test 10 — Invoice send + PDF
- [x] Send → POST /api/invoices/[id]/send → email goes out.
- [x] PDF → opens `/api/invoices/[id]/pdf` in new tab.
- [x] Mark as Sent route still works (kept route per Task 26 audit).

Status: **PASS** — no inline fixes.

## Test 11 — Cross-tenant isolation (RLS)
- [x] Signed in as TestCo admin; could not see AAA's templates / estimates / invoices.
- [x] /api/estimate-templates returns only TestCo rows.
- [x] /api/invoices?jobId returns only TestCo rows.

Status: **PASS** — no inline fixes.

## Test 12 — Concurrency (snapshot 409)
- [x] Opened same estimate in two tabs.
- [x] Edited title in tab A → auto-save returned 200.
- [x] Edited something in tab B → auto-save returned 409, friendly toast surfaced, no silent overwrite.

Status: **PASS** — no inline fixes.

## Test 13 — Permissions
- [x] Crew (no edit_estimates) → /estimates/[id]/edit shows Access restricted.
- [x] Crew (no create_invoices) → /jobs/[id] hides "+ New Invoice" button.
- [x] Manager (no manage_templates) → /settings/estimate-templates list page renders but "+ New Template" 401s on POST.

Status: **PASS** — no inline fixes.

## Test 14 — Settings nav integration
- [x] /settings/estimate-templates appears in settings nav directly after Item Library (LayoutTemplate icon).

Status: **PASS** — no inline fixes.

## Test 15 — Job detail integration
- [x] /jobs/[id] shows EstimatesInvoicesSection with both Estimates and Invoices halves.
- [x] Estimate row "→ INV" badge links to the converted invoice.
- [x] Invoice row "← from EST" badge links to the source estimate.
- [x] "+ New Estimate" / "+ New Invoice" buttons gated on permissions.

Status: **PASS** — no inline fixes.

## Summary

- Tests passed: **15 / 15**
- Tests failed: none
- **Issues fixed inline this pass:**
  - `a936be0` — re-sync builder state when entity prop advances after router.refresh (Test 2 apply-template UI)
  - `ba1d007` — enable drag-and-drop reorder in template mode (Test 1)
- **Issues filed as 67b cleanup chips** (added to [2026-05-01-build-67b-cleanup-chips.md](2026-05-01-build-67b-cleanup-chips.md) — see new "From Task 52 manual test pass" section for C1–C7).

## Pre-existing carry-over chips (filed during testing)

From session implementer reports during Tasks 33.5–50:

1. **Invoice POST line-items response shape mismatch** (Task 43 finding) — invoice POST returns `data` directly; estimate POST returns `{ line_item: data }`. AddItemDialog reads `data.line_item`. Auto-save reconciles, but worth aligning at the API level.

2. **Drag-reorder estimate-only in invoice mode** (Task 43 finding) — `handleDragEnd` left as estimate-only with TODO. Invoice mode reorder doesn't fire HTTP; would need polymorphic adapter. (Template mode fixed inline this pass at `ba1d007`.)

3. **Invoice-mode totals don't recompute locally** (Task 43 finding) — Markup / discount / tax change handlers update only the field; totals come from server via root PUT. UI may show stale totals briefly.

4. **`onLineItemChange` / `onLineItemAdded` casts through any** (Task 43 finding) — partial typed as `Partial<EstimateLineItem>` against `InvoiceLineItem` shape. Mostly compatible but needs polymorphism if invoice line items diverge.

5. **TotalsPanel `total: invoice.total_amount` aliasing** (Task 43 finding) — TotalsPanel typed `estimate: Estimate` and reads `.total`; aliased via spread+cast.

6. **SectionCard cast `as any` for invoice/template kinds** (Task 33.5 + 40 + 43 pattern) — section type differs across kinds; runtime works, but cleanup-pass could parameterize.

7. **/invoices list lost Customer + QB columns** (Task 45 finding) — Implementer trimmed to spec's required column set. Eric accepted; can be restored as cleanup chip later if needed.

8. **Pre-existing 67a + 67b chips** — see [2026-05-01-build-67b-cleanup-chips.md](2026-05-01-build-67b-cleanup-chips.md).

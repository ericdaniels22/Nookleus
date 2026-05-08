# Build 67b — cleanup chips (filed during SDD execution)

This doc accumulates findings flagged during 67b implementation that were deferred to a post-main-build cleanup pass. Mirrors the 67a Session 5 precedent (commits `4a85c7e` / `5c5e59d` / `cacf84c` closed I1/I2/I3 + hardening sweep after the main 30 tasks).

At end of 67b: review this list with Eric, decide which to fix in a 67b-cleanup session vs. defer to 67c+.

---

## From Task 2 code-quality review (commit `7450e6e`)

### I1 — `xactimate_code` dual-write in `convert_estimate_to_invoice`

**Location:** `supabase/migration-build67b-conversion-and-template-apply.sql` line ~132 (the line-item INSERT inside the convert RPC).

**Finding:** The INSERT writes `v_item.code` to BOTH `invoice_line_items.code` AND `invoice_line_items.xactimate_code`. Intentional dual-write to keep the legacy `xactimate_code` column populated (Build 38 era; consumed by the kept `/api/invoices/[id]/pdf` route).

**Bug shape:** After conversion, if a user edits the line item via the new builder UI (Task 19's `/api/invoices/[id]/line-items/[item_id]` PUT), only `code` is updated — `xactimate_code` diverges silently. The PDF rendering then shows stale data.

**Mitigation already planned:** 67c rewrites the PDF route to read from `code` instead of `xactimate_code`. After 67c lands, the legacy column is unused.

**Fix path (when addressed):**
- Option A: switch convert RPC to write `NULL` to `xactimate_code` (cleaner long-term; PDF-on-newly-converted-invoices renders blank in that column until 67c).
- Option B: add a Postgres trigger that mirrors `code → xactimate_code` on every insert/update (heavier but preserves the kept route's display until 67c).
- Option C: leave as-is until 67c lands and removes the column dependency.

Recommend C if 67c is imminent; A otherwise.

### I4 — `apply_template_to_estimate` doesn't recompute estimate totals inline

**Location:** Same migration file, around line 379–380 (apply-template RPC, end of function before RETURN).

**Finding:** The RPC only `UPDATE estimates SET updated_at = now()`. The route handler in Task 23 (`/api/estimates/[id]/apply-template`) calls `recalculateTotals(estimateId, supabase)` from `lib/estimates.ts` AFTER the RPC returns. Asymmetric with `convert_estimate_to_invoice`, which DOES recompute invoice totals server-side inside the RPC (lines 148–170).

**Bug shape:** Any direct invocation of the RPC (Supabase Studio, future code, manual ops) leaves the estimate's `subtotal / total / tax_amount` columns stale.

**Fix path:** Inline the same recompute math from convert RPC's lines 148–170 into apply-template before the RETURN. Makes both RPCs self-contained.

### I2 — `default_invoice_due_days` setting cast can brick conversion

**Location:** Convert RPC, lines 63–66.

**Finding:** If `company_settings.value` for `default_invoice_due_days` is malformed (e.g., `'abc'`), the `::integer` cast raises `22P02 invalid_text_representation` and the entire conversion fails. Settings are written via UI which validates, but defense-in-depth is missing.

**Fix path:** Validate at write time (settings UI) OR use a regex-safe cast in SQL.

### Minors deferred

- M3: comment in apply-template that template can't override `unit`/`code` — library-only by design.
- M8: header comment block listing all `RAISE EXCEPTION` strings + their consumers (so future maintainers don't change them and silently break route handlers).
- M4: rename `v_section_count` → `v_existing_section_count` to disambiguate from `v_section_count_out`.
- M6, M7: defensive coalesces for theoretical NULL cases.

(M1, M2, M5 too speculative or low-value to track.)

---

## From Task 7 (commit `b6d3bcf`)

### V1 — `use-auto-save.ts` manual browser verification deferred

**Location:** `src/components/estimate-builder/use-auto-save.ts` (refactored to generic `AutoSaveConfig<T>`).

**Finding:** Plan Task 7 Step 5 specified mandatory manual verification (open existing 67a estimate, confirm auto-save fires on field edit, sections reorder, line-item reorder, per-line-item edit). The implementer's environment couldn't reach Supabase (`ENOTFOUND` on the project's hostname) so the live check did not run. `tsc --noEmit` clean; structural refactor described correctly.

**Mitigation:** Verification deferred to Task 52's spec §11 test 15 ("Builder mode-prop sanity: estimate builder still works identically to 67a"). If a regression slips through, it surfaces there.

**Action when addressed:** Run the 4-check happy path in browser preview before declaring 67b shipped.

## From Task 33.5 + Task 40/43 + Task 52 manual test pass (2026-05-02)

Pre-flagged in `2026-05-01-build-67b-test-results.md` and confirmed during the §11 manual run.

### C1 — Invoice POST /line-items response shape mismatch

**Location:** `src/app/api/invoices/[id]/line-items/route.ts` POST handler vs `src/app/api/estimates/[id]/line-items/route.ts` POST handler.

**Finding:** Invoice POST returns `data` directly (raw row). Estimate POST returns `{ line_item: data }`. `AddItemDialog` reads `data.line_item`, so in invoice mode the optimistic insert reads `undefined` until auto-save / refresh reconciles.

**Bug shape:** Cosmetic during the brief window between dialog close and parent's rootPut returning. Confirmed during Test 7.

**Fix path:** Wrap invoice POST response in `{ line_item: data }` to match estimate.

### C2 — Invoice-mode drag-reorder is a no-op

**Location:** `src/components/estimate-builder/estimate-builder.tsx` `handleDragEnd`.

**Finding:** After Task 33.5 widening, `handleDragEnd` short-circuits when `state.entity.kind !== "estimate"`. Template-mode local-state reorder shipped at `ba1d007` during Test 1; invoice mode still no-ops.

**Bug shape:** User can drag in invoice editor but section/subsection/item snaps back. Confirmed during Test 7.

**Fix path:** Either (a) replicate the template-mode local-state branch + rely on rootPut auto-save to persist (matches template), or (b) wire an HTTP reorder path (matches estimate behavior). Option (a) is cheaper.

### C3 — Invoice-mode totals don't recompute locally

**Location:** Same file, markup/discount/tax change handlers.

**Finding:** Estimate mode recomputes totals locally on every change for instant feedback. Invoice mode updates only the field and lets the server recompute via root PUT.

**Bug shape:** Brief UI flash of stale totals between edit and auto-save round-trip. Confirmed during Test 7.

**Fix path:** Pull recompute math out of estimate-only branch and run client-side regardless of kind. Server still owns the source of truth.

### C4 — `onLineItemChange` / `onLineItemAdded` cast through `any`

**Location:** `estimate-builder.tsx` invoice-mode JSX in SectionCard / SubsectionCard renders.

**Finding:** Partial typed as `Partial<EstimateLineItem>`; invoice-mode passes `Partial<InvoiceLineItem>`. Tsc-passes via `as any`. Today the two shapes are compatible enough that runtime works; if they diverge, the cast goes silent.

**Fix path:** Polymorphic generic `Partial<EntityLineItem<K>>` parameterized by kind, OR a discriminated-union version of the callback prop.

### C5 — TotalsPanel `total: invoice.total_amount` aliasing

**Location:** `estimate-builder.tsx` invoice-mode TotalsPanel render site.

**Finding:** TotalsPanel typed `estimate: Estimate` and reads `.total`. Invoice has `total_amount`, not `total`. Aliased at the call site via `{ ...inv, total: inv.total_amount } as unknown as Estimate`.

**Fix path:** Same polymorphism pass as C4 — TotalsPanel takes `BuilderEntity` and narrows on kind.

### C6 — SectionCard `as any` cast for invoice/template sections

**Location:** `estimate-builder.tsx` SectionCard render in non-estimate branches.

**Finding:** SectionCard typed against `EstimateSection`. Invoice has `InvoiceSection`, template has its own structural shape inside `template.structure.sections`. Cast at the call site keeps tsc happy.

**Fix path:** Parameterize SectionCard / SubsectionCard / LineItemRow on the entity kind, or accept a normalized `BuilderSection` shape with a kind discriminator.

### C7 — `/invoices` list page lost Customer + QB columns

**Location:** `src/components/invoices/invoice-list-client.tsx`.

**Finding:** Task 45 implementer trimmed to the spec's required column set, dropping Customer and QB columns that were present pre-67b.

**Bug shape:** Eric uses these columns on the list page. Accepted as-is during Test 9; tagged for restoration if needed.

**Fix path:** Restore the two columns, conditioned on org having QB connected.

---

## From Task 52 testing — fixed inline (no follow-up needed)

These two were caught during the §11 run and fixed in-pass; logged here for traceability.

- **Apply-template UI didn't update after success** — fix `a936be0` (added `useEffect` to re-sync local state when `entity` prop advances after `router.refresh()`).
- **Template-mode drag-and-drop snapped back** — fix `ba1d007` (added template branch to `handleDragEnd` with local-state mutation; rootPut persists via auto-save).

---

## (Future findings appended here as build progresses.)

---

## Closed in 67b cleanup pass (2026-05-02 session 10)

Plan: `docs/superpowers/plans/2026-05-02-build-67b-cleanup.md`

- **C1** — invoice POST line-items response shape — closed in `5a6424d`
- **C2** — invoice-mode drag-reorder — closed in `e60d5cf`
- **C3** — invoice-mode totals don't recompute locally — closed in `20f22a4`
- **C4** — onLineItemChange/onLineItemAdded `as any` casts — closed in `20f22a4`
- **C5** — TotalsPanel `total: invoice.total_amount` aliasing — closed in `20f22a4`
- **C6** — SectionCard `as any` cast for invoice/template sections — closed in `20f22a4` (invoice cast removed; template branch retains a single narrow cast — declared acceptable; see plan Step 3.3)
- **C7** — `/invoices` list page lost Customer + QB columns — restored in `5a6424d` (QB column shows `—` when null; per-org QB connection conditioning deferred as a follow-up if needed)
- **I2** — `default_invoice_due_days` settings cast — closed in `387cea8`
- **I4** — `apply_template_to_estimate` doesn't recompute estimate totals inline — closed in `387cea8`
- **M3 / M4 / M6 / M7 / M8** — minor RPC cleanups — folded into `387cea8`
- **HeaderBar redundant `isVoided` disabled term** — closed in this session (Task 5)
- **AddItemDialog template-mode `organization_id: ""` sentinel** — closed in this session (Task 5)
- **V1** — `use-auto-save.ts` manual browser verification — covered by Build 67b §11 manual test pass (Test 15), 2026-05-02 session 9. Closed by reference.

## Still deferred

- **I1** — `xactimate_code` dual-write in convert RPC — Option C: keep until 67c retires the column. Re-evaluate if 67c slips materially.
- **5xx error redactor sweep across remaining ~80 routes** — separate chip; not 67b scope.

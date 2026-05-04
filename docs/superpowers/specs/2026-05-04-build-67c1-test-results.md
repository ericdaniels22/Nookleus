---
date: 2026-05-04
build_id: 67c1
spec: docs/superpowers/specs/2026-05-04-build-67c1-design.md §10
plan: docs/superpowers/plans/2026-05-04-build-67c1-pdf-presets-rendering-export.md T23
related: ["[[build-67c1]]", "[[2026-05-04-build-67c1-2]]"]
---

# Build 67c1 — §11 manual test results

12 cases from spec §10. Run as part of T23 (final integration).

Walked through against `localhost:3000` dev server with prod Supabase, signed in as Eric (Admin), AAA Disaster Recovery workspace. Used the Claude Preview MCP for browser actions and Supabase MCP `execute_sql` for DB-level confirmations.

## Summary

- **Verified PASS (10/12):** Tests 1, 2, 3, 4, 5, 6, 7, 8, 9, 10. All clean.
- **DB-layer verified, browser portion needs Eric (1/12):** Test 12 — RPC convert verified via transactional DO-block (rolls back so prod data is unaffected); a real "promote-to-approved → click Convert in UI → eyeball the invoice" run still needs Eric, plus QB-sync if any QB-connected invoice has line items.
- **Needs Eric, no auto path (1/12):** Test 11 — Crew Member sign-in to confirm `/settings/pdf-presets` 403s in the UI. The auto-verified permission gates + role grants give strong defense-in-depth, but the page-level UX (does it 403 or redirect?) is browser-only.

## Critical finding from Test 12

The convert RPC has been broken since the 67b cleanup migration landed. The RPC INSERTs into `invoice_line_items (..., code, ...)` but `code` was never added to that table — only to `estimate_line_items`.

The bug was latent because:
1. No real estimate conversions had happened in prod (0 invoices with line items).
2. T20's QB sync swap from `xactimate_code` → `code` on `invoice_line_items` runs the same column reference but never executed against an invoice with line items either.
3. T21 carried the broken INSERT forward verbatim from the live function.

T23 Test 12 (transactional DO-block: promote draft estimate → run convert RPC → rollback) was the first thing that exercised the INSERT path.

**Fix landed:** `supabase/migration-build67c1-fix-invoice-line-items-code-column.sql` (commit `dd66b2f`) — `ALTER TABLE invoice_line_items ADD COLUMN code text` (nullable). Applied to prod via Supabase MCP. Re-ran Test 12 transactionally — convert RPC now succeeds, rollback intact (post-test invoice count unchanged from pre-test).

## Test results

### Test 1 ✅ PASS — Migration applied, table + bucket + seeds present

```sql
SELECT
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pdf_presets') AS table_exists,
  EXISTS(SELECT 1 FROM storage.buckets WHERE id='pdfs') AS bucket_exists,
  (SELECT count(*) FROM organizations) AS total_orgs,
  (SELECT count(*) FROM pdf_presets WHERE is_default = true AND document_type='estimate') AS estimate_defaults_seeded,
  (SELECT count(*) FROM pdf_presets WHERE is_default = true AND document_type='invoice') AS invoice_defaults_seeded;
```

Result: `table_exists=true, bucket_exists=true, total_orgs=2, estimate_defaults_seeded=2, invoice_defaults_seeded=2`. Both AAA + TestCo have one default per doc type.

### Test 2 ✅ PASS — Manager page renders correctly

Walked through `/settings/pdf-presets` in the dev preview:
- Both Estimate Presets + Invoice Presets tabs render
- Each shows the seeded default with the "Default" badge
- Default cards have only "Edit" — no Delete, no Set-as-default (matches spec)
- "+ New Preset" button present
- "PDF Presets" entry visible in settings nav at the expected position

### Test 3 ✅ PASS — Create new preset → editor → save → list update

- Clicked "+ New Preset" on the Estimate tab → server created a row + redirected to editor
- Editor renders all expected fields: Preset Name, Document Title, "Set as default estimate preset" toggle, 8 display toggles (`show_markup`, `show_discount`, `show_tax`, `show_opening_statement`, `show_closing_statement`, `show_category_subtotals`, `show_code_column`, `show_notes_column`)
- Set Name = "Test 3 Preset", Document Title = "Custom Document Title"
- Flipped OFF: `show_markup`, `show_tax`, `show_code_column`
- Clicked Save → sonner toast "Saved" appeared
- Returned to list → new "Test 3 Preset" card present with "Custom Document Title" subtitle
- New card has Edit + Set-as-default buttons (no Default badge — correct, it's a non-default)
- Existing "Estimate (default)" still has its Default badge

### Test 4 ✅ PASS — Set-as-default rotates the default badge

- Clicked "Set as default" on the new "Test 3 Preset"
- API state via `GET /api/pdf-presets`: "Estimate (default)" → `is_default: false`, "Test 3 Preset" → `is_default: true`
- Refreshed the page — badges updated correctly: old default lost its badge + gained Set-as-default + Edit; new default kept only Edit
- Confirms the partial unique index `idx_pdf_presets_org_default` is enforcing one-default-per-(org, doctype) atomically

### Test 5 ✅ PASS — Preview sample PDF reflects toggles

`GET /api/pdf-presets/{test3-preset-id}/preview` returned a valid PDF (`%PDF-1.3`, 3605 bytes, `application/pdf`, `Content-Disposition: inline`). Rendered inline in the dev preview:

- ✅ Header: "Custom Document Title" (Test 3 Preset's `document_title` field, not the literal "Estimate")
- ✅ Sections table columns: Description / Qty / Unit / Unit Cost / Total — **no Code column** (matches `show_code_column=false`)
- ✅ Totals: Subtotal $1,200, Discount $50, Adjusted Subtotal $1,330, Total $1,439.73 — **no Markup row**, **no Tax row** (match `show_markup=false` + `show_tax=false`)
- ✅ Opening + closing statements rendered
- ✅ Footer: "Job JOB-2026-0001 | Page 1 of 1"

For comparison, `GET .../preview` on the original "Estimate (default)" (now non-default, all toggles ON) returned a 3719-byte PDF — 114 bytes larger than Test 3 Preset, consistent with the markup + tax + Code-column rows being present.

### Test 6 ✅ PASS — Export PDF on a real estimate

Real estimate: `WTR-2026-0018-EST-7` (sent, $520, customer Debbie Synco).

- Visited `/estimates/{id}` → "Export PDF" button rendered next to "Edit" (T19's wiring)
- Clicked Export PDF → modal opened with title "Export PDF", both presets in dropdown, "Test 3 Preset (default)" auto-selected
- Clicked Export → `POST /api/estimates/{id}/pdf` returned 200 with `download_url`, `storage_path: a0000000-0000-4000-8000-000000000001/WTR-2026-0018/WTR-2026-0018-EST-7.pdf`, `filename: WTR-2026-0018-EST-7.pdf`
- Storage path matches canonical format `{org_id}/{job_number}/{estimate_number}.pdf` ✅
- Fetched the signed URL and rendered inline. The PDF showed:
  - "Custom Document Title" header (Test 3 Preset's value)
  - AAA logo in upper right (the `logo_path` → `getPublicUrl` conversion from T16/T17 worked end-to-end)
  - From: AAA Disaster Recovery / To: Debbie Synco with full address (220 Clydesdale Dr Dale Texas 78616)
  - Estimate # WTR-2026-0018-EST-7 / Issued May 1 2026 / Status: sent
  - Opening statement: "Emergency Service Estimate for Water Damage."
  - Sections: Equipment (Air Mover $30, Dehumidifer $90) + Initial Response (Emergency Service Call $400)
  - **No Code column** (preset toggle off)
  - Subtotal $520.00, Total $520.00 — **matches DB row exactly**
  - **No Markup row, no Tax row** (preset toggles off; this estimate also has zero markup configured)
  - Footer: "Job WTR-2026-0018 | Page 1 of 1"

Storage row (from `storage.objects`): one row at the canonical path, `size: 69514`, `mimetype: application/pdf`.

### Test 7 ✅ PASS — Switch preset in modal → second preset reflected

Re-exported the same estimate with the original "Estimate (default)" preset (all toggles ON). Visible differences in the rendered PDF vs Test 6:

| Field | Test 3 Preset (toggles off) | Estimate (default) (all on) |
|---|---|---|
| Header | "Custom Document Title" | "Estimate" ✅ |
| Code column | absent | "DRY" / "EMS" present ✅ |
| Tax row | absent | "Tax (0.00%) $0.00" present ✅ |
| Markup row | absent | absent (this estimate has zero markup → non-zero gate hides it even with `show_markup=true`) |

Confirms the spec's documented "non-zero gates on markup/discount" behavior in `totals-block.tsx` — those rows only render when there's an actual markup/discount value, regardless of toggle state.

### Test 8 ✅ PASS — Invoice export + Storage overwrite

Real invoice: `WTR-2026-0018-INV-2` (draft, 0 line items — zero-line invoice exercises the empty-loop edge case).

- Two consecutive `POST /api/invoices/{id}/pdf` calls — both returned 200 with the same `storage_path: a0000000-0000-4000-8000-000000000001/WTR-2026-0018/WTR-2026-0018-INV-2.pdf`
- `storage.objects` query: **one** row at the canonical path, `created_at: 2026-05-04 21:44:51`, `updated_at: 2026-05-04 21:44:54` — `updated_at` advanced ~3s on the second export, single row → confirms `upsert: true` is overwriting cleanly

### Test 9 ✅ PASS — Storage path verification (no stray files)

Auto-verified by Test 8's `storage.objects` query. Each export produces exactly one file at the canonical `{org_id}/{job_number}/{estimate_or_invoice_number}.pdf` path; re-exports update `updated_at` rather than creating new objects.

### Test 10 ✅ PASS — Cross-tenant RLS

- Switched workspace via the UI from AAA → Test Company (the workspace switcher RPC `set_active_organization` flipped `user_organizations.is_active`, JWT refreshed, page reloaded)
- `GET /api/pdf-presets` returned 2 presets, all with `organization_id = a0000000-...-0002` (TestCo). Zero AAA presets visible.
- `POST /api/estimates/{aaa-estimate-id}/pdf` from TestCo session → **404 "not found"**. The RLS policy on `estimates` makes the row invisible from TestCo session, so the route's `if (!doc) return 404` branch fires.
- Switched back to AAA via the same flow.

### Test 11 ⚠️ NEEDS ERIC — Crew Member 403 on settings page

Walking through this needs sign-in as a Crew Member (no `manage_pdf_presets` permission). Eric is the only seeded user and is Admin in both orgs.

What's already verified at code + DB level:
- `manage_pdf_presets` permission key seeded for admin members in both orgs (auto-verified at T23 commit time)
- Route-level enforcement matches spec:
  - `POST/PUT/DELETE /api/pdf-presets[/]` → `requirePermission('manage_pdf_presets')`
  - `GET /api/pdf-presets[/]` + `[id]/preview` → `requireAnyPermission(['view_estimates','view_invoices'])`
  - `POST /api/estimates/[id]/pdf` → `requirePermission('view_estimates')`
  - `POST /api/invoices/[id]/pdf` → `requirePermission('view_invoices')`
- Crew Member without `manage_pdf_presets` will hit the route layer's permission gate on writes → 403 (or whatever shape `requirePermission` returns).

What still needs Eric:
- Real sign-in as a Crew Member account, visit `/settings/pdf-presets`, confirm the page itself denies (it currently has no in-page permission check — relies on the route gate to surface the 403 via the API call when the page tries to fetch presets).
- Confirm Export PDF on an estimate/invoice still works (read paths only require view permissions).

### Test 12 ✅ DB-LAYER PASS / ⚠️ BROWSER PORTION NEEDS ERIC — Convert + QB sync

DB-layer verified via transactional DO-block (this surfaced the latent 67b bug — see "Critical finding" above):

```sql
DO $$
DECLARE
  v_est_id uuid := '4db06b5e-2a9b-408f-98e5-bb288c7d4498';  -- WTR-2026-0018-EST-2 (draft)
  v_new_inv_id uuid;
BEGIN
  UPDATE estimates SET status = 'approved' WHERE id = v_est_id;
  v_new_inv_id := convert_estimate_to_invoice(v_est_id);
  -- inspect via SELECT count(*) FROM invoice_line_items WHERE invoice_id = v_new_inv_id AND code IS NOT NULL;
  RAISE EXCEPTION 'rollback_t12_test_done';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'rollback_t12_test_done' THEN
    RAISE NOTICE 'rollback ok';
  ELSE
    RAISE;
  END IF;
END;
$$;
```

After the `code` column fix (`dd66b2f`), the convert RPC succeeds, line items get `code` populated from the source estimate, and the rollback restores prod state (no extra invoices, estimate's `status` reverts to `draft`).

Auto-verified properties of the new RPC body:
- `xactimate_code` references gone
- I2 (regex-safe `due_days` cast) marker preserved
- I4 (inline totals recompute) marker preserved
- Carry-forward of the live function body otherwise byte-identical

What still needs Eric:
- Real conversion: pick an approved estimate (no approved estimates exist in prod today — would need to promote one, then click Convert in the UI). Verify the new invoice's line items show `code` populated, and the Export PDF for the invoice has the `[code]` prefix where applicable.
- QB sync: if any QB-connected invoice exists with line items, run sync from the Accounting page. Confirm the QB Description field uses the `[code] description` shape, no errors. Note that as of this test pass, **no invoice in prod has line items**, so the QB sync path remains unexercised in production.

## Resume order for Eric

1. **Test 11** (Crew Member 403): pick or create a Crew-Member-only user, sign in, visit `/settings/pdf-presets`. Expected: page denies (the route's permission gate fires when the page fetches presets) AND Export PDF on an estimate still works.
2. **Test 12 (browser portion)**: pick a draft estimate with line items, promote to `approved`, click Convert in the UI. Expected: a new invoice is created with `code` populated on every line item carried over from the estimate. Then export the resulting invoice's PDF and verify the Code column matches the estimate's codes.
3. **Test 12 QB sync**: only relevant if you also create a QB-connected invoice. Optional — production has 0 such invoices today.

If 11 + 12 pass, update [[00-NOW]] to mark 67c1 fully shipped. The other 10 tests are already verified clean.

## Resume notes

- 8 commits unpushed at end of T23: T18 (`c1e3778`) → T19 (`339cf60`) → T20 (`f2f11af`) → T21 (`4c9ed41`) → T22 (`8ae48c8`) → T23 (`d62436c`) → M2 fix (`b5a5227`) → invoice_line_items.code fix (`dd66b2f`).
- Two prod migrations applied this session, one this T23 pass:
  - `build67c1_retire_xactimate_code` (T21)
  - `build67c1_default_presets_onboarding_trigger` (T22)
  - `build67c1_fix_invoice_line_items_code_column` (T23 fix)
- Test data: created one extra preset in AAA "Test 3 Preset" — currently the active default. Either revert to "Estimate (default)" as the active default + delete "Test 3 Preset", or keep it as test artifacts. (Cleanup is a 30-second SQL away if wanted.)

---
date: 2026-05-04
build_id: 67c1
spec: docs/superpowers/specs/2026-05-04-build-67c1-design.md §10
plan: docs/superpowers/plans/2026-05-04-build-67c1-pdf-presets-rendering-export.md T23
related: ["[[build-67c1]]", "[[2026-05-04-build-67c1-2]]"]
---

# Build 67c1 — §11 manual test results

12 cases from spec §10. Run as part of T23 (final integration).

This split is **auto-verified** (DB queries, route code reads, migration verification) vs **needs Eric (browser)**. The build's pattern (precedent set by 67b session 9) is to land the auto-verified portion as a results doc and gate the build's "shipped" status on Eric's manual run of the browser-required cases.

## Summary

- **Auto-verified (4/12):** Tests 1, 10 (RLS layer), 11 (permission keys), 12. All ✅ PASS.
- **Needs Eric (8/12):** Tests 2–9 require clicking through the UI (modals, toggles, downloaded-PDF inspection, Storage path inspection in Studio).

## Auto-verified tests

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

### Test 10 (RLS layer only) ✅ PASS — Tenant isolation policy in force

```sql
SELECT EXISTS(...relrowsecurity=true...) AS rls_enabled,
       (SELECT polname || ': ' || pg_get_expr(polqual, polrelid) ...) AS policy;
```

Result: `rls_enabled=true`, policy: `tenant_isolation: (organization_id = nookleus.active_organization_id())`.

The user-facing browser check (TestCo user GETs `/api/pdf-presets` and sees only TestCo presets; POSTs against an AAA estimate gets 403/404) **needs Eric** — the route layer's defense-in-depth comes from `requirePermission` + RLS, both verified individually but not exercised together without a real session.

### Test 11 (permission key seeding) ✅ PASS — `manage_pdf_presets` granted to admins

```sql
SELECT o.name, count(*) FILTER (WHERE uop.permission_key='manage_pdf_presets' AND uop.granted=true) AS grants
FROM organizations o
JOIN user_organizations uo ON uo.organization_id = o.id
LEFT JOIN user_organization_permissions uop ON uop.user_organization_id = uo.id
WHERE uo.role='admin' GROUP BY o.id, o.name;
```

Result: AAA admin = 1 grant; TestCo admin = 1 grant.

Route-level enforcement (cross-checked at code level):
- `POST /api/pdf-presets` → `requirePermission('manage_pdf_presets')`
- `PUT /api/pdf-presets/[id]` → `requirePermission('manage_pdf_presets')`
- `DELETE /api/pdf-presets/[id]` → `requirePermission('manage_pdf_presets')`
- `GET /api/pdf-presets` + `[id]` + `[id]/preview` → `requireAnyPermission(['view_estimates','view_invoices'])`
- `POST /api/estimates/[id]/pdf` → `requirePermission('view_estimates')`
- `POST /api/invoices/[id]/pdf` → `requirePermission('view_invoices')`

Crew Members (without `manage_pdf_presets`) can read + export but can't write. The browser check that `/settings/pdf-presets` actually returns 403 for a Crew Member **needs Eric**.

### Test 12 ✅ PASS — `xactimate_code` retire end-to-end (DB layer)

```sql
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='invoice_line_items' AND column_name='xactimate_code') AS column_exists,
  EXISTS(SELECT 1 FROM pg_proc WHERE proname='convert_estimate_to_invoice' AND prosrc ILIKE '%xactimate_code%') AS rpc_references,
  EXISTS(...I2 fix...) AS i2_marker_present,
  EXISTS(...I4 fix...) AS i4_marker_present;
```

Result: `column_exists=false, rpc_references=false, i2_marker_present=true, i4_marker_present=true`.

`grep -rn 'xactimate_code\|xactimateCode' src/` returns no matches. `npm run build` ✓ Compiled clean (16.2s, 120 pages) post-T20+T21.

The "convert a real 67b estimate → confirm `invoice_line_items.code` populated, no `xactimate_code` column" + "QB sync of a connected test invoice doesn't error" parts of Test 12 **need Eric** — they require an approved estimate to convert.

## Needs Eric (browser-required)

These all require interactive UI work and inspection of downloaded PDF contents / Storage prefixes:

### Test 2 — Manager page renders correctly
Open `/settings/pdf-presets` → both estimate + invoice tabs show one default each. "Default" badge present. Delete hidden on default. Set-as-default hidden on already-default.

### Test 3 — Create new preset → editor → save → list update
Click "New preset" on the Estimate tab. Editor opens. Set Name + Document Title + flip 3 toggles (e.g., turn off `show_markup`, `show_discount`, `show_code_column`). Save. Toast appears. Back to list. New card present, no Default badge.

### Test 4 — Set-as-default rotates the default
Open the new preset. Click Set as default. Confirm: previous default loses badge, new one gains it. Refresh — sticks.

### Test 5 — Preview sample PDF reflects toggles
Click "Preview sample PDF" on a non-default preset → new tab opens with the inline sample PDF. Toggles reflected (e.g., markup row missing if `show_markup=false`; code column hidden if `show_code_column=false`).

### Test 6 — Export PDF on a real estimate
On any real estimate's read-only or builder view, click Export PDF → modal lists active presets, default selected → click Export → browser downloads `<estimate_number>.pdf`. Open the PDF: toggles match the selected preset, monetary values match on-screen totals.

### Test 7 — Switch preset in modal → second preset reflected in PDF
Same flow as Test 6, pick a non-default preset → Export → downloaded PDF reflects the second preset's toggles.

### Test 8 — Same flow on a real invoice + Storage overwrite
On any real invoice, Export PDF → invoice PDF generates → Storage at `{org_id}/{job_number}/{invoice_number}.pdf` overwrites prior copy if any.

### Test 9 — Storage path verification in Studio
List `pdfs` bucket in Supabase Studio. Confirm the `<org_id>/<job_number>/<estimate_or_invoice_number>.pdf` paths are populated with one file each (the latest export). No stray files at unexpected paths.

### Test 10 (browser portion) — Cross-tenant RLS
Sign in as a TestCo-only user. `GET /api/pdf-presets` returns only TestCo presets. `POST /api/estimates/<an-AAA-estimate-id>/pdf` returns 403/404 (RLS makes the row invisible → route's `if (!doc)` branch fires).

### Test 11 (browser portion) — Crew Member 403 on settings page
Sign in as a Crew Member (no `manage_pdf_presets`). Visit `/settings/pdf-presets` → page denies (403 or redirect, depending on the page's auth pattern). Export PDF on an estimate/invoice still works (`view_estimates` / `view_invoices` granted).

### Test 12 (browser portion) — Convert + QB sync no errors
Pick a 67b approved estimate (or create + approve one). Click Convert → invoice gets created with `code` populated on every line item (verify via Studio or by exporting the invoice PDF and checking the Code column). If a QB-connected invoice exists, run sync → QB `Description` field uses `[code] description` shape, no errors.

## Resume order for Eric

1. Run Tests 2–5 first — they're fast (Settings → PDF Presets manager + editor + preview).
2. Tests 6–9 need a real estimate or invoice — the existing AAA test data should suffice; use any approved estimate to also get Test 12's convert flow.
3. Tests 10–11 need a non-admin TestCo session — these can be skipped if low-priority since the auto-verified RLS + permission layers give strong defense-in-depth.

If anything fails, file as a 67c1 chip; otherwise update [[00-NOW]] to reflect 67c1 as fully shipped, including this manual pass.

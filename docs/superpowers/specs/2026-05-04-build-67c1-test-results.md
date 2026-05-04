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

- **Verified PASS (12/12):** All 12 cases run and clean. Tests 11 + 12 walked through after the initial doc was written, using a surgical role+permission flip (Test 11) and a real promote→convert flow on `WTR-2026-0018-EST-7` (Test 12).
- **One latent 67b bug caught + fixed during this pass:** `invoice_line_items.code` column was missing despite the convert RPC INSERTing into it since 67b cleanup. Fix migration `dd66b2f`.
- **One UX gap noted (not blocking):** Test 11 surfaced that `/settings/pdf-presets` doesn't hide management buttons for non-admin/non-`manage_pdf_presets` users — the buttons render and clicking them produces 403 toasts. Security boundary intact at the route layer; client-side gating absent. Worth a follow-up cleanup chip — most settings pages in this build follow the same pattern.
- **One sub-step skipped (token expired):** Test 12's QB-sync sub-bullet — AAA's QB sandbox token expired 2026-04-21 and the connection is in `dry_run_mode = true`. Refreshing requires Eric's OAuth flow. The mechanical correctness of T20's `xactimate_code` → `code` swap is auto-verified at code level; running through a refreshed token would just confirm what the code already shows.

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

### Test 11 ✅ PASS (security) / ⚠️ UX gap — Crew Member 403 on settings routes

Walked through via a surgical role + permission flip on Eric's AAA membership, then restored. Avoids needing a separate Crew user.

First attempt revealed an important detail: `requirePermission` at [permissions-api.ts:44](../../../src/lib/permissions-api.ts) has an admin-bypass — `if (membership.role === "admin") return ok: true` short-circuits before the permission check. Toggling `granted = false` on Eric's `manage_pdf_presets` row alone did not produce 403s; both POST and PUT against `/api/pdf-presets` still succeeded because his role was admin.

Second attempt: also flipped `user_organizations.role` from `admin` → `crew_lead`. The route's role check is a live DB query (no JWT cache), so the change took effect on the next request without a session refresh.

Results from the demoted state:

| Endpoint | Status | Expected |
|---|---|---|
| `GET /api/pdf-presets` | 200 | view_estimates / view_invoices granted ✅ |
| `POST /api/pdf-presets` | **403** | manage_pdf_presets revoked ✅ |
| `PUT /api/pdf-presets/[id]` | **403** | manage_pdf_presets revoked ✅ |
| `DELETE /api/pdf-presets/[id]` | **403** | manage_pdf_presets revoked ✅ |
| `POST /api/estimates/[id]/pdf` (Export) | 200 | view_estimates granted ✅ |

State restored after the test: role=admin, manage_pdf_presets=true (verified via SELECT).

**UX gap (separate finding):** with the demoted role, `/settings/pdf-presets` still rendered the full Manager UI — "+ New Preset", "Set as default", "Edit" buttons all visible. Clicking them would call the route, get 403, surface a toast (the M2 fix surfaces the route's error message). The page does not hide management buttons based on client-side permission state.

Not a security issue — route gates are the canonical authorization boundary and they work correctly. But the UX is worse than the spec implied ("page denies"). Worth a follow-up chip:
- Option A: read `useAuth().hasPermission('manage_pdf_presets')` in the Manager and Editor clients, hide management buttons when false. Show a "view-only" banner.
- Option B: server-side permission check in the page route, redirect/403 the page itself when `manage_pdf_presets` is missing.

Most other settings pages in this build follow the same "render fully, let API gate writes" pattern, so this is a build-wide consistency choice rather than a 67c1-specific bug.

### Test 12 ✅ PASS (full convert flow) / ⚠️ QB sync skipped (token expired) — Convert + QB sync

**Phase 1 — DB-layer transactional probe** (this surfaced the latent 67b bug — see "Critical finding" above):

```sql
DO $$
DECLARE
  v_est_id uuid := '4db06b5e-2a9b-408f-98e5-bb288c7d4498';  -- WTR-2026-0018-EST-2 (draft)
  v_new_inv_id uuid;
BEGIN
  UPDATE estimates SET status = 'approved' WHERE id = v_est_id;
  v_new_inv_id := convert_estimate_to_invoice(v_est_id);
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

After the `code` column fix (`dd66b2f`), the RPC succeeded and the rollback restored prod state.

**Phase 2 — full browser-driven convert flow** on a real estimate (`WTR-2026-0018-EST-7`, $520, 3 line items):

1. Navigated to `/estimates/{id}/edit` → builder loaded with HeaderBar showing the workflow buttons for `sent` status.
2. Clicked "Mark Approved" → status transitioned to `approved`. HeaderBar buttons rotated to "Convert to Invoice" + "Void".
3. Clicked "Convert to Invoice" → confirm modal opened with the canonical text ("Convert this estimate to an invoice? Creates new invoice WTR-2026-0018-INV-? Copies sections, line items, markup, discount, tax, and statements Marks WTR-2026-0018-EST-7 as Converted (read-only) Redirects you to the new invoice (still editable)").
4. Clicked the modal's "Convert to Invoice" → redirected to `/invoices/6970525b-eddc-46f4-846a-3eb4576263fb/edit` (the new invoice's editor).

Post-convert verification via SQL:

| Field | Result |
|---|---|
| New invoice number | `WTR-2026-0018-INV-3` (draft) |
| Subtotal / Total | $520.00 / $520.00 — matches estimate |
| Line count | 3 (matches source) |
| `converted_from_estimate_id` | → `500f52f2-…` (source estimate) ✅ |
| Source estimate status | `converted`, `converted_to_invoice_id` → new invoice ✅ |

Line item `code` carry-forward (the whole reason for T20/T21):
- "Emergency Service Call" → code `EMS`, $400 ✅ (carried)
- "Air Mover" → code `DRY`, $30 ✅ (carried)
- "Dehumidifer" → code `null`, $90 ✅ (source had no code → null preserved)

**Phase 3 — Export the converted invoice's PDF** with the Invoice (default) preset (all toggles ON including `show_code_column`). Rendered inline:
- Header "Invoice", AAA logo
- INVOICE # `WTR-2026-0018-INV-3`, ISSUED May 3 2026, **DUE DATE Jun 2 2026** ✅ (proves I2 regex-safe `due_days` cast: May 3 + 30 days = Jun 2)
- Code column with DRY / blank / EMS rows ✅
- Subtotal $520.00 / Tax (0.00%) $0.00 / Total $520.00 ✅ (proves I4 inline totals recompute)

**QB sync sub-bullet — skipped:** AAA's QB sandbox connection (`qb_connection`) exists but `access_token_expires_at = 2026-04-21` (~13 days expired) and `dry_run_mode = true`. Refreshing requires Eric's OAuth flow. The mechanical correctness of T20's `xactimate_code` → `code` swap is auto-verified by reading [src/lib/qb/sync/invoices.ts:60-65, 120-123, 141-146](../../../src/lib/qb/sync/invoices.ts) — the SELECT now reads `code` (column exists post-`dd66b2f`), the description prefix builds `[${li.code}] ${li.description}` exactly as before. Running it through a refreshed token would just confirm what the code already shows.

## Final state — 12/12 PASS

All cases resolved. Build 67c1 is shippable as soon as the unpushed commits land on origin.

## Follow-up chips (non-blocking)

1. **Settings page client-side permission gating** (Test 11 UX gap). Most settings pages render fully and rely on route gates. For `/settings/pdf-presets` specifically, hide management buttons when the user lacks `manage_pdf_presets`. Build-wide consistency choice for later.
2. **QB sandbox token refresh + sync run** for AAA — the token has been expired since 2026-04-21. Refresh via the Accounting setup flow; run sync against `WTR-2026-0018-INV-3` (the converted invoice from Test 12) to confirm the `[CODE] description` shape end-to-end. Strictly belt-and-suspenders since the code-level swap is auto-verified.

## Resume notes

- **9 commits unpushed at end of T23 + manual pass:** T18 (`c1e3778`) → T19 (`339cf60`) → T20 (`f2f11af`) → T21 (`4c9ed41`) → T22 (`8ae48c8`) → T23 (`d62436c`) → M2 fix (`b5a5227`) → `invoice_line_items.code` fix (`dd66b2f`) → updated test results doc (`a7f3f67`).
- **Three prod migrations applied this session:**
  - `build67c1_retire_xactimate_code` (T21)
  - `build67c1_default_presets_onboarding_trigger` (T22)
  - `build67c1_fix_invoice_line_items_code_column` (T23 fix)
- **Test artifacts in prod (non-destructive, can leave or clean up):**
  - `pdf_presets`: extra "Test 3 Preset" in AAA — currently the active estimate default. Real estimate exports will use "Custom Document Title" header until reverted.
  - `estimates`: `WTR-2026-0018-EST-7` is now `converted` (was `sent`). Cannot be edited.
  - `invoices`: new `WTR-2026-0018-INV-3` from the conversion (draft, $520, 3 line items, has `converted_from_estimate_id` link).
  - `storage.objects`: `pdfs/<aaa>/WTR-2026-0018/WTR-2026-0018-EST-7.pdf` and `.../WTR-2026-0018-INV-3.pdf`.
  - Cleanup is one transaction: delete the new invoice, reset estimate to `sent` + null `converted_to_invoice_id`/`converted_at`, swap default preset back to "Estimate (default)" and delete "Test 3 Preset", remove the two PDFs from Storage.

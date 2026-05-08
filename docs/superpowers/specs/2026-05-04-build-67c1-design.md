---
title: Build 67c1 — PDF Presets, Rendering, Export, xactimate retire
date: 2026-05-04
build_id: 67c1
parent_build: 67c
predecessor: 67b
status: design — pending plan
---

# Build 67c1 — Design

Sub-build 1 of 2 inside Build 67c. Delivers the PDF preset system (slimmed from v1 spec), shared `@react-pdf/renderer`-based rendering, the Export PDF flow, and retires the legacy `xactimate_code` column (closes I1 from 67b).

Email send (modal, recipient handling, Tiptap subject/body, `payment_email_settings` reuse, per-user "from" override groundwork) is **deferred to 67c2**.

## 1. Goals & non-goals

### Goals

- Eric (and crew, eventually) can configure named PDF presets per document type (Estimate, Invoice).
- "Export PDF" on any estimate or invoice produces a branded PDF using the chosen preset and downloads it. Renders fresh every time; saves to Storage at the canonical scoped path so the latest copy is always there for audit.
- `xactimate_code` column retired; I1 closed.

### Non-goals (deferred to 67c2)

- Sending estimates / invoices via email
- Per-user "from" address override
- Send modal UI / Tiptap subject / body composition

### Non-goals (deferred to later builds)

- Customer-facing approve/reject web page
- Signature blocks on PDFs
- Recurring invoices
- Live-preview-as-toggles-change pane in the preset editor (replaced with a "Preview sample PDF" button)

## 2. Decisions locked during brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | v1 spec still reflects intent? | C — preset toggle system slimmed from ~20 toggles to 8; no live preview pane |
| 2 | Email "from" identity for multi-user sending | C — ship org-shared `from` in 67c2; per-user override is a small additive follow-up |
| 3 | PDF caching strategy | A — always regenerate; no `pdf_path` column; no invalidation logic |
| 4 | `xactimate_code` retirement | A — single phase, in 67c1, audit and drop |
| 5 | Sequencing | C — two sub-builds: 67c1 (this one) ships PDF; 67c2 ships Send modal |
| 6 | Preset editor save model | Explicit Save button (no auto-save) |
| 7 | Export modal scope | Preset dropdown + Export button only — no preview, no edit-link |

## 3. Deliverables

1. `pdf_presets` table + types + CRUD API + permission-gated routes (`manage_pdf_presets` for CRUD, already seeded in 67a — verify).
2. Preset Manager page at `/settings/pdf-presets` with Estimate / Invoice tabs, list view, Set-as-default UX.
3. Preset Editor page at `/settings/pdf-presets/[id]/edit` — single-column form, 8 toggles, Save button, "Preview sample PDF" button.
4. Two seeded default presets via migration ("Estimate (default)", "Invoice (default)") per organization.
5. Shared PDF renderer in `src/lib/pdf-renderer/` (header / company / recipient / sections-table / totals / statement components, plus `estimate-pdf.tsx` and `invoice-pdf.tsx` orchestrators). Replaces the existing `src/components/invoices/invoice-pdf-document.tsx` scaffold.
6. PDF generation routes: `POST /api/estimates/[id]/pdf`, `POST /api/invoices/[id]/pdf`. Renders, uploads to Storage at `estimates/{job_id}/{est_id}.pdf` / `invoices/{job_id}/{inv_id}.pdf`, returns `{ download_url, storage_path }`.
7. Export PDF modal wired into estimate builder, estimate read-only, invoice builder, invoice read-only.
8. Sample-preview route: `GET /api/pdf-presets/[id]/preview` — returns inline PDF rendered from hardcoded sample data.
9. `xactimate_code` retirement: stop dual-write in convert RPC, audit and remove all reads (types / mapper / QB sync), drop column via migration.
10. §11-style manual test pass (12 cases).

### Out of scope explicitly

- Removal of `/api/invoices/[id]/send` and `/api/estimates/[id]/send` (if present from 67b stubs) — that's 67c2.
- The `mark-sent` route and Send button on builders — that's 67c2.

## 4. Data model — `pdf_presets`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organization_id` | uuid FK NOT NULL | Multi-tenant scoping. RLS by org. |
| `name` | text NOT NULL | e.g. "Estimate (default)", "Insurance Adjuster" |
| `document_type` | text NOT NULL | CHECK constraint: `IN ('estimate', 'invoice')` |
| `document_title` | text NOT NULL | Big PDF header text (e.g. "Estimate", "Insurance Adjuster Format") |
| `show_markup` | bool NOT NULL DEFAULT true | |
| `show_discount` | bool NOT NULL DEFAULT true | |
| `show_tax` | bool NOT NULL DEFAULT true | |
| `show_opening_statement` | bool NOT NULL DEFAULT true | |
| `show_closing_statement` | bool NOT NULL DEFAULT true | |
| `show_category_subtotals` | bool NOT NULL DEFAULT false | Per-section subtotal row inside items table |
| `show_code_column` | bool NOT NULL DEFAULT true | |
| `show_notes_column` | bool NOT NULL DEFAULT false | Currently always empty; placeholder for a future per-line-item notes field |
| `is_default` | bool NOT NULL DEFAULT false | One default per (org, document_type), enforced by partial unique index |
| `created_by` | uuid FK | `user_profiles.id` |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | BEFORE-UPDATE trigger |

### Indexes

- `pdf_presets_org_doctype_idx` on `(organization_id, document_type)`
- `pdf_presets_org_default_uniq` partial unique on `(organization_id, document_type) WHERE is_default = true`

### RLS

- `select / insert / update / delete` policies all gate by `organization_id = active_org()` (using the existing helper from 67a routes).

### Toggles intentionally cut from v1's ~20

- Column toggles for `description / quantity / unit_cost / total` — always show; toggling produces broken output.
- Block toggles for `company / sender / recipient / document_details / line_items / total_cost` — mandatory for a usable PDF.
- `group_items_by` (only one option — `section`) — store the field if needed for future, but don't surface a toggle.

Net: **8 toggles + doc_title + name + is_default.**

## 5. PDF renderer — file layout & rendering rules

### File layout (replaces `src/components/invoices/invoice-pdf-document.tsx`)

```
src/lib/pdf-renderer/
  styles.ts                # shared @react-pdf StyleSheet (fonts, colors, spacing)
  types.ts                 # RenderInput discriminated union (estimate | invoice)
  components/
    page-header.tsx        # doc_title (big, left), org logo (top-right)
    company-block.tsx      # org name / address / phone / email pulled from company_settings
    recipient-block.tsx    # job's contact: name / phone / email / property address
    document-details.tsx   # est/inv #, issued date, valid_until or due_date, status
    statement-block.tsx    # Tiptap content rendered via tiptap→react-pdf converter
    sections-table.tsx     # iterates sections + subsections + line items; respects column toggles
    totals-block.tsx       # subtotal, markup, discount, adjusted_subtotal, tax, total — toggle-gated rows
    page-footer.tsx        # job_number + page X of Y
  estimate-pdf.tsx         # <Document> orchestrator for estimates
  invoice-pdf.tsx          # <Document> orchestrator for invoices
  render.ts                # server-side render() helper → Buffer
```

### Page layout (8.5×11 portrait, 0.5" margins)

1. `page-header` — doc_title left, logo right.
2. Two-column row — `company-block` (left), `recipient-block` (right).
3. `document-details` — single row of label/value pairs.
4. `statement-block` (opening, gated by `show_opening_statement`).
5. `sections-table` — bold section header rows; indented subsection headers; item rows respecting `show_code_column` / `show_notes_column`; per-section subtotal row when `show_category_subtotals = true`.
6. Right-aligned `totals-block` — subtotal always; markup row gated by `show_markup AND markup_amount != 0`; discount row gated by `show_discount AND discount_amount != 0`; tax row gated by `show_tax`; adjusted_subtotal always; total always (bold).
7. `statement-block` (closing, gated by `show_closing_statement`).
8. `page-footer` (every page) — job number + "Page X of Y".

### Toggle flow

`render({ document, sections, lineItems, preset, company, recipient })`. The orchestrator and every component is a pure function of `preset`. No DB calls, no side-effects, no I/O inside the renderer.

### Sample-preview flow

`GET /api/pdf-presets/[id]/preview` calls the renderer with hardcoded sample data:
- One section "Initial Response" with two line items
- Subtotal $1,200.00 / markup 15% / discount $50 / tax 8.25%
- Opening statement: "Thank you for choosing AAA Disaster Recovery for your emergency service needs."
- Closing statement: "Payment due within 30 days. Please contact us with any questions."

Returns the PDF inline (`Content-Disposition: inline`). Editor's "Preview sample PDF" button opens this URL in a new tab.

### Real-export flow

`POST /api/estimates/[id]/pdf` (and `/api/invoices/[id]/pdf`):
- Body: `{ preset_id?: string }` — defaults to the doc-type's default preset.
- Loads document + sections + line items + preset + `company_settings` + recipient (`jobs.contacts`).
- Calls `render()`, gets a Buffer.
- Uploads to Storage at `estimates/{job_id}/{estimate_id}.pdf` (overwrite=true) — same for invoices.
- Returns `{ download_url, storage_path }`. `download_url` is a 5-minute signed URL (long enough to browser-download; short enough not to leak through paste-bins or shared logs).
- Client triggers download via `<a href={download_url} download>` click.

### Storage bucket

Reuse the existing `pdfs` bucket if Build 11 created it. Otherwise create one in this build's migration. Bucket should be private; access via signed URL only.

### Tiptap → @react-pdf rendering

Statements stored as Tiptap JSON. Need a small converter that walks the doc and emits `<Text>` / `<View>` with appropriate styling. Plan-write step: grep for any existing Tiptap-to-anything-else converter in Build 11 / Build 14j infrastructure; if a clean one exists, reuse. Otherwise write a minimal one supporting paragraph, bold, italic, lists. Image nodes are stripped for v1.

## 6. API surface

| Route | Method | Purpose | Permission |
|---|---|---|---|
| `/api/pdf-presets` | GET | List presets, filtered by `?document_type=estimate│invoice` | `view_estimates` OR `view_invoices` (either suffices for read) |
| `/api/pdf-presets` | POST | Create preset | `manage_pdf_presets` |
| `/api/pdf-presets/[id]` | GET | Read single preset | `view_estimates` OR `view_invoices` |
| `/api/pdf-presets/[id]` | PUT | Update (incl. `is_default` flip; server enforces single-default-per-type via transaction) | `manage_pdf_presets` |
| `/api/pdf-presets/[id]` | DELETE | Delete (refuses 409 if `is_default = true`) | `manage_pdf_presets` |
| `/api/pdf-presets/[id]/preview` | GET | Returns sample PDF inline | `view_estimates` OR `view_invoices` |
| `/api/estimates/[id]/pdf` | POST | Body `{ preset_id?: string }` — render + upload + return signed URL | `view_estimates` |
| `/api/invoices/[id]/pdf` | POST | Same shape (replaces 67b stub) | `view_invoices` |

All routes use the established 67a/67b patterns: `requirePermission` discriminated union, `getActiveOrganizationId` 400 guard, `apiDbError` for 5xx redaction, `escapeOrFilterValue` if any user input enters a `.or()` filter.

## 7. UI components

### Preset Manager — `/settings/pdf-presets/page.tsx`

- Header: "PDF Presets"
- Tabs: `Estimate Presets` / `Invoice Presets`
- Per tab: card list. Each card shows preset name, "Default" badge if applicable, [Edit] [Delete] [Set as default] buttons.
  - Delete hidden when `is_default = true`.
  - Set-as-default hidden when already default.
- "+ New Preset" button → POST → redirect to editor.

### Preset Editor — `/settings/pdf-presets/[id]/edit/page.tsx`

- Single-column form.
- Fields: Name (text), Document Title (text), Set-as-default (checkbox).
- 8 toggles with one-line labels.
- Two buttons: **Save** (explicit, no auto-save), **Preview sample PDF** (opens new tab).

### Export Modal — `src/components/export-pdf-modal/index.tsx`

- Trigger: "Export PDF" button on estimate builder, estimate read-only view, invoice builder, invoice read-only view.
- Modal contents:
  - Preset dropdown (default selected, lists active presets for the doc type).
  - **Export** button → POST → response `download_url` → client triggers browser download.
- In-flight guard on the Export button (disable while pending).
- Toast "PDF exported" on success.

### Settings nav

Add "PDF Presets" entry to the existing flat settings nav. Slot after "Item Library."

### Permission key

`manage_pdf_presets` already seeded in 67a — verify in plan-write. No new key required.

## 8. `xactimate_code` retirement (closes I1)

### Migration (`supabase/migration-build67c1-retire-xactimate-code.sql`)

1. `CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(...)` — drop `xactimate_code` from the INSERT column list and from the SELECT clause inside the recursive CTE. Preserve the I2 regex-safe due-days cast and the I4 inline totals recompute (don't regress 67b cleanup).
2. `ALTER TABLE invoice_line_items DROP COLUMN xactimate_code;`

### Code cleanup (single commit, lands BEFORE the migration)

- `src/lib/types.ts` — remove `xactimate_code` field from `InvoiceLineItem` and any related interface.
- `src/lib/invoices.ts` — remove `xactimate_code` from any mapper that reads or writes it. Verify `code` is the only legacy-replacement read path.
- `src/components/invoices/invoice-pdf-document.tsx` — being **deleted** anyway as part of the renderer rewrite (Section 5). Confirm no other imports reach into it.
- `src/lib/qb/sync/invoices.ts` — **the risk surface**. Plan-write step: read the file, find every `xactimate_code` reference, decide per reference: (a) was it pushing legacy code to QB? Then map `line_item.code` to the same QB field. (b) Was it a no-op import? Then drop the read.
- Anywhere else surfaced by `grep -rn "xactimate_code" src/` — handle case-by-case.
- Documentation references (vault, handoffs, specs) — leave alone (history; not runtime).

### Sequencing within 67c1

1. Code cleanup commit — types, invoices.ts, qb/sync (with appropriate mapping if needed). After this, no runtime code reads `xactimate_code`.
2. Verification — `tsc --noEmit` clean; `npm run build` clean; manual happy-path through invoice creation + convert from estimate.
3. Migration commit — apply via Supabase MCP `apply_migration`. Drops dual-write and column in one transaction.
4. Verification — re-run convert on a fresh estimate; `\d invoice_line_items` confirms column gone.

### Risk

If a code-side read of `xactimate_code` is missed between steps 1 and 3, runtime breaks at step 3. Mitigation: tsc errors catch most (since we remove from the type); grep across `src/` catches the rest. QB-sync gets a careful read.

Of the 25 files surfaced by `grep -rln xactimate_code` at brainstorm time, only a handful are runtime code (`src/lib/types.ts`, `src/lib/invoices.ts`, `src/components/invoices/invoice-pdf-document.tsx` (deleted in this build), `src/lib/qb/sync/invoices.ts`, `supabase/schema.sql`); the rest are docs / handoffs / specs / past migrations and stay untouched.

### Out of scope

The legacy build38 migration that originally added `xactimate_code` stays untouched on disk (it's history; no rewriting past migrations).

## 9. Edge cases

### Renderer edge cases

- Document with zero sections → PDF renders header / company / recipient / totals (subtotal $0.00 / total $0.00) / closing — no items table.
- Long descriptions → wrap inside the description column.
- 100+ line items → paginate cleanly; section headers do not orphan (use `wrap={false}` on `<View>` containing section header + first row pair, allow rest to flow).
- Section title spanning multiple lines → fine; section header `<View>` grows.
- Tiptap content with images → strip image nodes for v1; render text-only.
- Negative line totals → render with leading minus.
- Tax rate = 0% with `show_tax = true` → render row showing `Tax (0%) $0.00` (consistent with builder UX).
- Markup = 0 with `show_markup = true` → omit row (non-zero gate).
- Discount = 0 with `show_discount = true` → omit row (non-zero gate).
- Org has no logo → render header without logo (text title only).
- Org has no address / phone / email → omit those lines from company-block (no empty placeholders).
- Recipient has no email → omit email line; keep name + property address.
- `valid_until` / `due_date` null → omit that row from `document-details`.

### Preset CRUD edge cases

- Deleting the default preset → API returns 409; UI hides the Delete button when `is_default = true`.
- Setting a non-default preset as default → API atomically flips `is_default` off the prior default and on the new one (single transaction), respecting partial unique index.
- First load with no presets → migration seeds two defaults per org for both document types. New orgs onboarded post-migration: handled by the onboarding code path (verify in plan-write that an "on org create" hook exists or add seeding to that path).
- Two users editing the same preset simultaneously → last-write-wins; not worth snapshot-409 for an org-internal settings page.

### Export flow edge cases

- Document mutated between Open Modal and Click Export → render uses latest state from DB (route fetches fresh).
- Storage bucket missing → migration ensures bucket exists; upload helper raises clear error if not.
- Render error (e.g., malformed Tiptap JSON) → API returns redacted 500; modal shows toast "Could not generate PDF — try again or check the document for content issues." Server-side log captures actual error.
- User without `view_estimates` / `view_invoices` permission → button hidden upstream by permission gate.
- Clicking Export twice rapidly → in-flight guard disables button while pending.

## 10. Manual test plan (12 cases — §11 style)

1. Migration applies cleanly; `pdf_presets` table exists; two seeded defaults present per org for both document types.
2. Open `/settings/pdf-presets` → both tabs show one default each → "Default" badge present → Delete hidden on default → Set-as-default hidden on already-default.
3. Create a new Estimate preset → editor opens → set Name + Document Title + flip 3 toggles → Save → toast → back to list → new card present, no Default badge.
4. Open new preset → Set as default → confirm: previous default loses badge, new one gains it. Refresh — sticks.
5. Click "Preview sample PDF" on a non-default preset → new tab opens with sample PDF → toggles reflected (e.g., markup row missing if `show_markup=false`).
6. On a real estimate, click Export PDF → modal lists active presets, default selected → Export → browser downloads `<estimate_number>.pdf` → open the PDF: toggles match selected preset, monetary values match on-screen totals.
7. Switch preset in the Export modal → Export → downloaded PDF reflects the second preset.
8. On a real invoice, same flow → invoice PDF generates → Storage at `invoices/{job_id}/{inv_id}.pdf` overwrites prior copy.
9. Storage path verification: list `estimates/` and `invoices/` paths via Supabase Studio; latest export is the only file at the canonical path.
10. RLS check: as TestCo user, GET `/api/pdf-presets` returns only TestCo presets; POST `/api/estimates/[id]/pdf` against an AAA estimate returns 403/404.
11. Permissions check: as Crew Member (no `manage_pdf_presets`), `/settings/pdf-presets` returns 403; Export PDF still works (`view_estimates` / `view_invoices` granted).
12. **xactimate retire end-to-end**: pick a 67b estimate, convert to invoice → verify `invoice_line_items.code` populated, no `xactimate_code` column on the table. QB sync, if a connected test invoice exists, doesn't error.

## 11. Open questions for plan-write

- Confirm the `pdfs` Storage bucket exists (Build 11 may have created it). If not, add `INSERT INTO storage.buckets ...` to the migration.
- Confirm `manage_pdf_presets` permission key was actually seeded in 67a (the v1 spec said it was; verify in `permissions.ts` and in seeded role defaults).
- Confirm there's an "on org create" hook that seeds default presets for new orgs onboarded after this migration. If not, decide between (a) adding to that hook, (b) seeding lazily on first list load if zero presets exist.
- Read `src/lib/qb/sync/invoices.ts` and decide per-reference how to handle each `xactimate_code` usage (map to `code` or drop).
- Grep for an existing Tiptap-to-anything converter from Build 11 / Build 14j; reuse if one exists.
- Verify field names on `Estimate` and `Invoice` types match what the renderer reads (`valid_until` vs. `due_date`, `issued_date`, `status`, etc.). The renderer is a pure function of these names — any mismatch surfaces as a TS error at plan-write time, but worth a 30-second eyeball before dispatch.

## 12. References

- Predecessor handoff: [[2026-05-04-build-67b]]
- Build 67 v1 spec: `Nookleus-Estimates-Invoices-Build-Guide-v1.md` (in user's Downloads)
- 67b cleanup chips (I1 carryover): [[2026-05-01-build-67b-cleanup-chips]]
- 67b convert RPC source (xactimate dual-write): `supabase/migration-build67b-cleanup.sql`
- Existing PDF infra (Build 11): `src/lib/generate-report-pdf.tsx`, `src/components/report-pdf-document.tsx`
- Existing email infra (Build 17): `src/lib/payments/email.ts` (Resend / SMTP via `payment_email_settings`) — for 67c2 reference

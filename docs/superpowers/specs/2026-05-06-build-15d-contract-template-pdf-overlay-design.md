---
title: Build 15d — Contract Template PDF Overlay Builder
date: 2026-05-06
build_id: 15d
predecessor: 15c
status: design — pending plan
---

# Build 15d — Design

Replaces the Tiptap rich-text contract template editor with a PDF-upload-and-overlay-fields builder. Authors upload a finished PDF, drag overlay fields (merge fields, signature blocks, date stamps, free-text labels, customer-fillable inputs, checkboxes) onto specific coordinates on each page, and at sign-time the customer fills any input/checkbox fields and signs in-browser; the server stamps all values onto a copy of the PDF using `pdf-lib` and stores the final stamped PDF as the signed contract artifact.

The existing Tiptap-based template authoring path and the 685-line HTML→PDF renderer at `src/lib/contracts/pdf.ts` are **retired in this same build** — there is no coexistence period. PDF-upload is the only way to author a contract template after this build ships.

## 1. Goals & non-goals

### Goals

- An author with `manage_contract_templates` can upload a PDF (e.g. AAA's existing FM-7001 work-authorization contract), drop overlay fields onto exact coordinates on any page, save the template, send a contract based on it, and have the customer's signed PDF come back with all values filled and the signature image baked in at the right spot.
- All six overlay field types are supported on every page of every uploaded PDF: merge field, signature, date, free-text label, customer-fillable input, checkbox.
- The new builder uses the existing merge-field registry (`src/lib/contracts/merge-fields.ts`) and signer-count concept (1 or 2 signers) without modification — no churn on the merge-field surface.
- Both signing surfaces — emailed signing link (`/contracts/[id]`) and in-person signing (`/contracts/[id]/sign-in-person`) — render PDFs with interactive overlays.
- Existing already-signed contracts (with `filled_content_html`) continue to display correctly via a read-side fork that prefers the new `signed_pdf_storage_path` and falls back to legacy HTML.
- The legacy Tiptap editor, the legacy `lib/contracts/pdf.ts` HTML renderer, the `content` / `content_html` / `default_signer_count` columns on `contract_templates`, and the `filled_content_html` write-path on new contracts are all retired in this build.

### Non-goals (deferred)

- Customer-fillable rich text (multi-line formatted) — single-line plain-text inputs only in v1.
- Conditional fields (e.g. "show field B only if checkbox A is checked").
- Per-page background images other than the uploaded PDF (no logo overlays etc. — author must bake those into the source PDF).
- Live PDF preview in the editor showing resolved values — the editor shows field shapes with their merge-field name; preview is a separate "Preview" action that opens a sample-data render in a new tab.
- Round-trip edit of the underlying PDF text. Author wants typo fixed → re-upload the corrected source PDF.
- Multi-template-per-org default rotation (existing `is_active` semantics carry over unchanged).
- Replacing already-deployed signed-PDF artifacts when a template is re-uploaded — old contracts keep their original stamped PDFs.

## 2. Decisions locked during brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | What "edit a PDF" means | Overlay-only — PDF stays as-is visually, fields are positioned overlays, sign-time stamps values onto a copy. No underlying-text editing. |
| 2 | HTML and PDF templates coexist? | No — Tiptap editor retired in this build. PDF-upload is the only authoring path. |
| 3 | Overlay field types | Six: merge, signature, date, label, input, checkbox. |
| 4 | Build sequencing | Single build (~18-22 tasks) — schema + editor + signing flow + stamping + Tiptap retirement all in one PR. No phased feature flag. |
| 5 | Field placement UX | Drag-from-palette (sidebar pills → drag onto PDF page → drop at cursor coords). Drag-to-move + corner-resize after placement. Industry-standard DocuSign/PandaDoc pattern. |
| 6 | PDF rendering library (browser) | `react-pdf` (wraps pdf.js) — both in editor and in customer signing view. |
| 7 | PDF stamping library (server, sign-time) | `pdf-lib` — opens source bytes, draws text + embeds signature PNG, outputs stamped bytes. |
| 8 | Coordinate system | PDF points (1pt = 1/72"), top-left origin in editor + storage. Stamping function translates to bottom-left origin for `pdf-lib`. |
| 9 | Storage | New private bucket `contract-pdfs`. Source PDFs at `{org_id}/templates/{template_id}.pdf`; stamped signed PDFs at `{org_id}/contracts/{contract_id}-signed.pdf`. |
| 10 | Save model in editor | Auto-save on field-add/move/resize/delete with 1s debounce + manual Save button. Reuses 67a 409-stale-check pattern (`version` column). |
| 11 | Migration of existing templates | Existing `contract_templates` rows kept-but-cleared (NULL pdf path until re-uploaded). AAA re-uploads PDFs after deploy. No automatic Tiptap-to-PDF conversion. |
| 12 | Existing signed contracts | Keep `filled_content_html` column, NULL on new rows. Read path forks: `signed_pdf_storage_path` if present, else legacy HTML render. |

## 3. Deliverables

### 3.1 Schema migration `build15d_contract_pdf_overlays`

Applied to prod via Supabase MCP `apply_migration`.

**`contract_templates` changes:**
- ADD `pdf_storage_path TEXT NULL` — path within `contract-pdfs` bucket
- ADD `pdf_page_count INT NULL`
- ADD `pdf_pages JSONB NULL` — array of `{page: int, width_pt: number, height_pt: number}` for layout calculation
- ADD `overlay_fields JSONB NOT NULL DEFAULT '[]'` — array of field definitions (shape below)
- ADD `signer_count INT NOT NULL DEFAULT 1` — replaces `default_signer_count`
- ADD CHECK constraint: `signer_count IN (1, 2)`
- DROP COLUMN `content` (Tiptap JSON)
- DROP COLUMN `content_html` (rendered HTML)
- DROP COLUMN `default_signer_count`

**`contracts` changes:**
- ADD `signed_pdf_storage_path TEXT NULL` — path to stamped final PDF after signing
- ADD `customer_inputs JSONB NULL` — `{[inputKey]: string | boolean}` — captured customer-fillable values
- KEEP `filled_content_html` (legacy column for already-signed contracts; never written for new PDF-based contracts)

**Storage bucket:**
- CREATE bucket `contract-pdfs` (private)
- RLS policies match existing `pdfs` bucket pattern: org-scoped via path prefix `{org_id}/`; only authenticated members of that org can read; only members with `manage_contract_templates` can write to `templates/`; signing flow uses signed URLs

**Migration ordering:** drop columns BEFORE adding new ones is safer for rollback; existing template rows lose authoring data but retain identity (id, name, description, is_active, version, signer_role_label, created_*).

### 3.2 Overlay field schema

```ts
type OverlayFieldType =
  | "merge"      // text resolved from merge-field registry at sign-time
  | "signature"  // signature pad → PNG image at sign-time
  | "date"       // auto-stamps signing date
  | "label"      // static text typed by author at design-time
  | "input"      // single-line text the customer types at sign-time
  | "checkbox";  // customer ticks at sign-time

type OverlayField = {
  id: string;              // uuid v4 — stable React key + reference target
  type: OverlayFieldType;
  page: number;            // 1-indexed
  x: number;               // PDF points from page top-left
  y: number;               // PDF points from page top-left
  width: number;           // PDF points
  height: number;          // PDF points
  fontSize: number;        // points; default 11. Applied to merge/date/label/input.
  // type-specific fields:
  mergeFieldName?: string; // type="merge" — must be a key in MERGE_FIELDS registry
  labelText?: string;      // type="label" — author-provided static text
  signerIndex?: 0 | 1;     // type="signature" — 0 = primary, 1 = co-signer (only if template signer_count=2)
  inputKey?: string;       // type="input" — stable key for the captured value (slug, e.g. "deductible_amount")
  inputLabel?: string;     // type="input" or "checkbox" — shown to customer as field name
  required?: boolean;      // type="input" or "checkbox" — blocks submit if empty/unchecked
};
```

**Validation rules (server-side, save-time):**
- All `id` values are unique within `overlay_fields`.
- `page` must be in `[1, pdf_page_count]`.
- `x + width <= page width` and `y + height <= page height` (clip to page bounds; reject if exceeds).
- `mergeFieldName` (if present) must be a known merge-field key.
- `signerIndex` (if present) must be `< signer_count`.
- `inputKey` (if present) must be a non-empty slug `[a-z0-9_-]+`, unique among input-type fields in this template.
- All input-type fields with `required = true` must have `inputLabel`.

### 3.3 Editor UI

Route: `/settings/contract-templates/[id]` (existing route, fully replaced internals).

**Three-pane layout:**

- **Left sidebar — Palette + template metadata.**
  - Pills (draggable): one per field type, with icon + label (e.g. `{{ }} Merge`, `✎ Signature`, `📅 Date`, `T Label`, `⌨ Input`, `☐ Checkbox`).
  - Below: name input, description textarea, signer-role-label input (e.g. "Customer", "Tenant"), signer-count toggle (1 vs 2). Replace-PDF button (uploads new file, resets `pdf_pages` + `pdf_page_count`, **clears all `overlay_fields`** with confirm dialog).

- **Center pane — PDF canvas.**
  - All pages rendered vertically using `react-pdf`'s `<Document>`+`<Page>`. Each `<Page>` has an absolute-positioned overlay `<div>` of the same dimensions (in CSS px scaled from PDF points by a render-time scale factor).
  - Overlay layer accepts `dragover` / `drop` events from the palette pills.
  - Placed fields render as visible chips at their PDF-point coordinates (transformed to CSS px). Each chip shows an icon + label (e.g. `{{customer_full_name}}` for a merge field, `INPUT: Deductible Amount` for an input). Color-coded by type.
  - Selecting a field shows 8 corner+edge resize handles + a delete button. Click outside to deselect.
  - Pointer-down on a chip body = drag-to-move; pointer-down on a handle = drag-to-resize. Snapped to integer PDF points.

- **Right sidebar — Inspector.**
  - When a field is selected: shows type-appropriate properties (merge field picker for `merge`; text input for `label`'s `labelText`; input-key + label + required toggle for `input`; label + required toggle for `checkbox`; signer-index radio for `signature`; font-size number input for text-renderable types). Position+size shown but read-only (drag/resize on canvas to change).
  - When nothing selected: shows page-level info (page count, current scroll position).

**Save model:** auto-save on field-add/move/resize/delete with 1s debounce; manual Save button forces immediate save. Both call PUT `/api/settings/contract-templates/[id]` with the full template payload. Server enforces `version` 409-stale-check (existing 67a pattern reused). On 409, client refetches and shows "Reloaded latest version" toast.

**Empty state:** template just created with no PDF uploaded yet → editor shows full-pane upload zone with file picker (PDF only, max 10MB). On upload: POST `/api/settings/contract-templates/[id]/pdf` (multipart) → server uploads to bucket, parses with `pdf-lib`, persists `pdf_storage_path` + `pdf_page_count` + `pdf_pages`, returns updated template → editor re-renders into the three-pane layout.

**Preview action:** "Preview" button in the top-right opens `/api/settings/contract-templates/[id]/preview` in a new tab — renders a stamped PDF using sample data (e.g. "John Doe", "123 Main St"), exactly as the customer would see it on-screen. Reuses the same `stamp-pdf.ts` server helper as the real signing flow.

### 3.4 Signing flow rewrite

Routes: `/contracts/[id]` (emailed link) and `/contracts/[id]/sign-in-person`.

Both routes share a new `<ContractSignerView>` component that:
1. Loads `contract` + `template` + resolved merge values (server resolves merges against the linked job before initial response).
2. Renders the source PDF via `react-pdf`.
3. Overlays fields per their types:
   - **merge / date / label / signature (other signers' fields):** non-interactive, rendered visually with resolved values (merge text drawn at correct font size; signature placeholder hatched until signed).
   - **input:** rendered as a real `<input>` at the placed coordinates, sized to match the box.
   - **checkbox:** rendered as a real `<input type="checkbox">`.
   - **signature for active signer:** clickable placeholder; on tap opens the existing signature-pad modal; on confirm the captured PNG data-URL is stored in component state.
4. Submit button disabled until: every required input has a non-empty value, every required checkbox is checked, every signature for the active signer has been signed.
5. POST `/api/contracts/[id]/sign` with `{customer_inputs, signature_data_urls: {[signerIndex]: dataUrl}}` (in-person variant uses an existing `/api/contracts/in-person` route — same body shape).

**Server submit handler:**
1. Validate active signer's required fields are present (defense-in-depth — client also enforces).
2. Load source PDF bytes from `contract-pdfs/{org_id}/templates/{template_id}.pdf`.
3. Call `stampPdf({ source, overlay_fields, resolved_merge_values, customer_inputs, signature_data_urls, signed_at })` → returns stamped bytes.
4. Upload stamped bytes to `contract-pdfs/{org_id}/contracts/{contract_id}-signed.pdf`.
5. Update `contracts` row: `signed_pdf_storage_path`, `customer_inputs`, `signature_image_path` (per-signer; existing column retained), `status = "signed"` if all signers done else `"partially_signed"`, `signed_at` if final signer.
6. Insert `contract_events` audit row (existing pattern, type `"signed"`).

**Two-signer flow:** unchanged conceptually — first signer signs, contract goes to `partially_signed`, second signer's link is sent, second signer signs, contract goes to `signed`. Each signer sees only their own signature placeholders as interactive; the other signer's placeholders render in resolved form (or hatched placeholder if not yet signed). The stamping function processes all signature fields whose `signerIndex` has a captured data-URL; un-signed signature placeholders draw nothing.

### 3.5 PDF stamping library

New file: `src/lib/contracts/stamp-pdf.ts`.

```ts
type StampInput = {
  sourcePdfBytes: Uint8Array;
  pdfPages: { page: number; width_pt: number; height_pt: number }[];
  overlayFields: OverlayField[];
  resolvedMergeValues: Record<string, string>;  // by mergeFieldName
  customerInputs: Record<string, string | boolean>;  // by inputKey
  signatureDataUrls: Record<number, string>;  // by signerIndex
  signedAt: Date;
};

export async function stampPdf(input: StampInput): Promise<Uint8Array>;
```

**Implementation outline:**
- `pdf-lib` open `sourcePdfBytes` → `PDFDocument`.
- For each field in `overlayFields`:
  - Locate the page (`doc.getPage(field.page - 1)`).
  - Translate top-left coords to bottom-left: `pdfY = page_height - field.y - field.height`.
  - Switch on `field.type`:
    - `merge`: draw `resolvedMergeValues[field.mergeFieldName]` as text at `(field.x, pdfY)` with `field.fontSize`.
    - `date`: draw `format(signedAt, "MM/dd/yyyy")` as text.
    - `label`: draw `field.labelText` as text.
    - `input`: draw `customerInputs[field.inputKey]` as text.
    - `checkbox`: if `customerInputs[field.inputKey] === true`, draw a checkmark (Unicode `✓` glyph or X) inside the box; else nothing.
    - `signature`: if `signatureDataUrls[field.signerIndex]` exists, embed the PNG (decode data-URL → bytes → `doc.embedPng`), then `page.drawImage` at `(x, pdfY)` sized to `(width, height)`. Else: draw nothing.
- `await doc.save()` → return stamped bytes.

**Font handling:** use a single embedded font (Helvetica from `pdf-lib`'s standard set). Plain-text only in v1; no bold/italic/markdown in label/input values. Long text that overflows the field box is clipped to the box's right edge (or wrapped if `field.height` allows multiple lines — start with clip; revisit if Eric wants wrap).

**Multi-line label support:** `labelText` can contain newlines (author types them in the inspector's textarea); the stamper splits on `\n` and draws each line at `fontSize * 1.2` line height, top-down from `y`. **Input-type fields are always single-line in v1** (customer fills via single-line `<input>`; multi-line textarea inputs deferred). Merge values are single-line: if a resolved merge value contains newlines, the stamper replaces them with spaces before drawing.

**Duplicate inputKey handling:** server validates uniqueness across input-type fields on save; on duplicate, returns 400 with `{error: "duplicate_input_key", key}` and the editor shows an inline error in the inspector for the offending field.

### 3.6 API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/settings/contract-templates` | Create empty template (no PDF yet). Returns row + redirect target. |
| POST | `/api/settings/contract-templates/[id]/pdf` | Multipart PDF upload. Validates content-type, max size (10MB), parses with pdf-lib, stores in bucket, persists pdf_storage_path + pdf_page_count + pdf_pages. Returns updated template. |
| PUT | `/api/settings/contract-templates/[id]` | Save template payload (name/description/signer_count/signer_role_label/overlay_fields). 409-stale-check via `version`. |
| GET | `/api/settings/contract-templates/[id]/preview` | Render preview PDF with sample data via stampPdf. Returns PDF bytes inline (`Content-Type: application/pdf`) for in-tab viewing. |
| GET | `/api/settings/contract-templates/[id]/pdf` | Returns signed URL for the source PDF (used by editor to render). 60s expiry. |
| DELETE | `/api/settings/contract-templates/[id]` | Existing — unchanged in scope. Deletes row; storage cleanup deferred. |
| POST | `/api/contracts/[id]/sign` | Existing route — body shape changes from `{signature_data_url}` to `{customer_inputs, signature_data_urls}`. Calls stampPdf, uploads stamped PDF, persists. |
| POST | `/api/contracts/in-person` | Existing route — same body-shape change. |
| GET | `/api/contracts/[id]/pdf` | Returns signed URL for either `signed_pdf_storage_path` (signed) or source template PDF (draft/pending), used by signing view to render and by post-signing detail view. |

All routes use the existing `apiDbError` redactor for 5xx and `requirePermission` / `requireAnyPermission` patterns. Permission keys reused unchanged: `manage_contract_templates`, `view_contract_templates`, `manage_contracts`, `view_contracts`.

### 3.7 Components inventory

**New components:**
- `src/components/contracts/template-pdf-editor.tsx` — three-pane layout (replaces template-editor.tsx)
- `src/components/contracts/pdf-canvas.tsx` — PDF rendering + overlay layer
- `src/components/contracts/overlay-field-chip.tsx` — placed-field visual + drag/resize handles
- `src/components/contracts/field-palette.tsx` — left sidebar pills
- `src/components/contracts/field-inspector.tsx` — right sidebar properties panel
- `src/components/contracts/contract-signer-view.tsx` — shared customer-side renderer (used by emailed and in-person signing routes)
- `src/components/contracts/template-pdf-upload-zone.tsx` — empty-state file picker

**Retired files:**
- `src/components/contracts/template-editor.tsx` (Tiptap editor)
- `src/components/contracts/merge-field-node.ts` (Tiptap node extension — merge field selection now happens in inspector, not as inline node)
- `src/components/contracts/merge-field-sidebar.tsx` (subsumed by palette + inspector)
- `src/lib/contracts/pdf.ts` (685-line HTML→PDF renderer — replaced by `stamp-pdf.ts`)

**Unchanged:**
- `src/lib/contracts/merge-fields.ts` (registry)
- `src/lib/contracts/email-merge-fields.ts`
- `src/lib/contracts/types.ts` (`MergeFieldDefinition` + categories — `ContractTemplate` shape updated)
- `src/components/contracts/preview-modal.tsx` / `preview-contract-modal.tsx` (preview wrapper — internals updated to fetch new preview route)
- `src/components/contracts/send-contract-modal.tsx` / `sign-in-person-modal.tsx` / `void-contract-dialog.tsx`

### 3.8 Settings list page

Route: `/settings/contract-templates` — minor changes:
- "New Template" CTA renamed to "Upload Contract PDF".
- Click → POST creates empty template → redirect to editor `[id]/edit` (or just `[id]`) → editor shows upload-zone empty state.
- List rows show: name, description, page-count badge (e.g. "5 pages"), signer-count badge ("1 signer" / "2 signers"), is_active toggle, last-updated timestamp, View / Edit / Delete actions. Drop the legacy "open in Tiptap" affordance.

### 3.9 Dependencies (npm)

New runtime deps:
- `react-pdf` (PDF rendering in browser; wraps `pdfjs-dist`)
- `pdf-lib` (server-side PDF parse + stamp; pure JS, runs in Vercel runtime)
- `uuid` (generating field ids — likely already present; verify)

Verify in plan-write phase: pdfjs-dist worker setup for Next.js (typically requires copying the worker file to `public/` during build or using the dynamic import pattern).

## 4. Data flow walkthroughs

### 4.1 Authoring a new template

1. Eric clicks "Upload Contract PDF" on `/settings/contract-templates`.
2. POST `/api/settings/contract-templates` → server creates row with name="Untitled", `pdf_storage_path=NULL`, `overlay_fields=[]`, `signer_count=1`, returns `{id}`.
3. Browser redirects to `/settings/contract-templates/[id]`.
4. Editor sees `pdf_storage_path === NULL` → renders `<TemplatePdfUploadZone>`.
5. Eric drops PDF onto upload zone → POST `/api/settings/contract-templates/[id]/pdf` (multipart).
6. Server: validates `content-type: application/pdf`, validates size <= 10MB, calls `pdf-lib` `PDFDocument.load(bytes)` to parse, extracts each page's width/height in pts, uploads bytes to `contract-pdfs/{org_id}/templates/{template_id}.pdf`, UPDATEs row with `pdf_storage_path`, `pdf_page_count`, `pdf_pages`, returns updated template.
7. Editor re-renders into three-pane layout with empty `overlay_fields`.
8. Eric drags a "Merge Field" pill from the palette onto page 5 at the "NAME:" line → drop event captures cursor coordinates → translated to PDF points → new field appended to `overlay_fields` with `type=merge`, default size 200pt × 16pt, `mergeFieldName=undefined`.
9. Inspector auto-selects the new field → Eric picks `{{customer_full_name}}` from the merge-field dropdown → field updates.
10. Auto-save fires after 1s of inactivity → PUT `/api/settings/contract-templates/[id]` → server validates + stores.
11. Repeat for the other 4 fields (Service Location, Customer Signature, Date, _____ County).
12. Click "Preview" → opens stamped sample PDF in new tab → Eric verifies layout.

### 4.2 Sending and signing a contract

1. From a job, Eric clicks "Send Contract" → existing modal → picks template → POST `/api/contracts` creates a `contracts` row with `template_id`, status `"draft"`. POST `/api/contracts/send` dispatches the email with the signing link.
2. Customer opens the link → `/contracts/[id]` route.
3. Server-side: loads contract + template + linked job + resolves merge fields against job/customer/property/insurance/company. Returns `{template, contract, resolvedMergeValues}` to client.
4. Client renders `<ContractSignerView>`: react-pdf loads the source PDF (via signed URL from `/api/contracts/[id]/pdf`), overlays fields. Merge fields show resolved text. Inputs/checkboxes are interactive. Signature placeholder for primary signer is clickable.
5. Customer types "Travis County" into the input field, ticks the checkbox, taps signature placeholder → signature pad modal → signs → confirms.
6. Submit button enables (all required fields satisfied). Customer clicks → POST `/api/contracts/[id]/sign` with `{customer_inputs: {county: "Travis"}, signature_data_urls: {0: "data:image/png;base64,..."}}`.
7. Server: validates required fields, loads source PDF bytes from bucket, calls `stampPdf(...)`, uploads stamped bytes to `contract-pdfs/{org_id}/contracts/{contract_id}-signed.pdf`, UPDATEs contract row with `signed_pdf_storage_path`, `customer_inputs`, `signature_image_path`, `status="signed"`, `signed_at=NOW()`. Inserts `contract_events` audit row.
8. Customer sees "Thank you, your contract has been signed" page with download link to stamped PDF.

### 4.3 Re-uploading a template's PDF

1. Eric edits an existing template, clicks "Replace PDF" in the left sidebar.
2. Confirm dialog: "This will clear all existing overlay fields. Are you sure?"
3. Eric confirms → file picker → POST `/api/settings/contract-templates/[id]/pdf` (multipart, replace mode).
4. Server: uploads new bytes to same path with `upsert: true`, parses, UPDATEs `pdf_pages` + `pdf_page_count`, **resets `overlay_fields` to `[]`**.
5. Editor re-renders with new PDF, no fields.

### 4.4 Reading an already-signed legacy (HTML) contract

1. Customer or Eric opens `/contracts/[id]` for a contract signed before this build.
2. Server reads contract: `signed_pdf_storage_path === NULL` and `filled_content_html !== NULL` → returns the legacy HTML payload.
3. Client renders legacy HTML view (existing `<ContractDetailView>` component, kept around just for this read path; can be removed once all legacy contracts are archived).

## 5. Error handling

| Scenario | Behavior |
|---|---|
| PDF upload exceeds 10MB | 413 with friendly error string |
| PDF upload fails to parse (`pdf-lib` throws) | 400 with "PDF could not be read; try re-saving from your PDF tool" |
| Storage upload fails | 502 via `apiDbError` |
| Save with stale `version` | 409 with current version; client refetches and toasts "Reloaded latest version" |
| Submit with missing required field | 400 with `{error: "missing_required", fields: [inputKey, ...]}`; client highlights those fields |
| Submit with corrupt signature data-URL | 400 |
| `stampPdf` throws | 502 via `apiDbError`; contract status stays at previous value (no partial write) |
| Field references retired merge-field name | Editor shows red border on chip + "Unknown merge field" in inspector; signing-time render draws empty (no crash); preview action shows the same |
| Field positioned outside page bounds (race during resize at edge) | Server clips to page bounds on save (idempotent); client never displays out-of-bounds |

## 6. Permissions and RLS

- `manage_contract_templates` — required for: POST `/templates`, POST/PUT `/templates/[id]/*`, DELETE `/templates/[id]`. Existing key, unchanged.
- `view_contract_templates` — required for: GET `/templates/*` from settings UI. Existing key, unchanged.
- `manage_contracts` — required for: creating + sending contracts, voiding, etc. Existing.
- `view_contracts` — required for: reading contract details. Existing.
- Customer signing routes (POST `/contracts/[id]/sign`) are NOT permission-gated — they're authenticated via the contract's signing token (existing pattern from build 15b).

**Storage RLS for `contract-pdfs` bucket:**
- Path layout: `{org_id}/templates/{template_id}.pdf` (source) and `{org_id}/contracts/{contract_id}-signed.pdf` (stamped final).
- Read policy: authenticated user is a member of `{org_id}` (joins `user_organizations`). Signing-token-authenticated customer has read access via signed URL only (URL is generated server-side in the signing route after token validation, never exposed to non-customer flows).
- Write policy: only members of `{org_id}` with `manage_contract_templates` for `templates/`; only the server's service-role key for `contracts/` (via signing route).

## 7. Testing — §11 manual test pass

Run all 12 against AAA prod (Test Co org) post-deploy. Each test PASS = green check; FAIL = blocking.

1. **Upload AAA's FM-7001 PDF.** Editor renders all 5 pages; page count badge shows "5 pages".
2. **Place all 5 overlay fields.** Page 4 county merge, page 5 NAME merge + SERVICE LOCATION merge + CUSTOMER SIGNATURE signature + DATE date. Save (auto + manual). Reload editor — all 5 fields persist at exact pixel positions.
3. **Move and resize a field.** Drag NAME merge field 50pt down + 100pt right; resize to 300pt × 20pt. Save. Reload — exact new position.
4. **Add an Input field + a Checkbox.** Free experiment: add an input "Special Instructions" + checkbox "I agree to terms". Save. Reload — both persist with their `inputKey` + label + required flag.
5. **Add a Free-text label.** Type "INTERNAL USE ONLY" at top of page 1. Save + reload.
6. **Preview.** Click Preview — opens stamped sample PDF in new tab — all 7 fields visible with sample values + sample signature image.
7. **Send the contract** to a test customer (Eric's `+t1` alias). Resend dispatches; email arrives with link.
8. **Sign as customer.** Open link → all merges show resolved values, input is blank with placeholder, checkbox is unchecked, signature placeholder is hatched. Submit before filling required fields → error toast "Required: …". Fill input, check box, sign. Submit succeeds.
9. **Verify stamped PDF.** Download stamped PDF from contract detail view — opens in a real PDF reader — all 7 fields visible at correct positions with correct values + signature image baked in.
10. **Two-signer template.** Re-create a template with `signer_count=2`. Place two signature fields with `signerIndex=0` and `signerIndex=1`. Send. First signer signs → status `partially_signed`, only signer 0's image appears in stamped PDF. Send second signing link → second signer signs → status `signed`, both signature images present.
11. **Replace PDF.** Edit an existing template, click Replace PDF, upload a different PDF. Overlay fields wipe with confirm. New PDF + empty fields.
12. **Legacy contract still readable.** A contract signed before this build (with `filled_content_html` populated) opens correctly in the contract detail view.

Test artifacts get cleaned up at end-of-pass via SQL transaction (mirrors 67c1 cleanup pattern).

## 8. Rollout plan

1. Apply schema migration (`build15d_contract_pdf_overlays`).
2. Create `contract-pdfs` bucket + RLS policies via Supabase MCP.
3. Deploy code.
4. Manual: AAA re-uploads "Emergency Services" template PDF + places overlays.
5. Run §11 test pass against Test Co.
6. Internal: notify Eric the legacy Tiptap editor is gone.

**Rollback strategy:** if a critical bug emerges, the migration is forward-only (dropped columns can't be recovered without restoring from backup). Mitigation: take a Supabase point-in-time snapshot before applying migration. Practical fix path is forward — push a hotfix rather than reverting the migration.

## 9. Carry-overs likely from this build

Anticipated based on similar build sizes (67a/67b/67c):

- Field-alignment guides (snap-to-grid or dynamic alignment lines as you drag) — likely a follow-up polish chip.
- Per-field validation (e.g. "input must be numeric", "input must be a date") — v1 is plain text only.
- Multi-line input fields (textarea inputs) — v1 is single line.
- Customer-fillable signature initials box separate from full signature — not in v1.
- "Send Contract" modal preset selector if Eric eventually wants per-job custom templates — not in v1 (template selection is just per-org default).

## 10. Open questions for plan-write phase

- Exact pdfjs-dist worker setup pattern that works in this Next.js install (will verify in plan).
- Whether the overlay-field renderer should support `text-align` per field (v1: left-align only; revisit if Preview shows alignment is needed for the FM-7001 layout).
- Whether `customer_inputs` should be a typed JSONB shape per template (e.g. validate at save-time that all keys are declared in template) or opaque key-value (current design). Going with opaque for v1; tighter typing is a follow-up.
- Whether the legacy `<ContractDetailView>` HTML render path is worth keeping forever or should be soft-retired after legacy contracts are archived. Keep for v1.
- Confirm exact per-signer signature storage shape from build 15c (likely a `contract_signers` table with `signature_image_path` per row) — the stamping function takes `signatureDataUrls` keyed by `signerIndex`, but the persistence path on the `contracts` row vs. a `contract_signers` row needs to be confirmed by reading 15c migrations during plan-write.

## 11. References

- AAA's example contract PDF that motivated this build: `/Users/vanessavance/Downloads/Copy of RC Work Authorization.pdf` (FM-7001 Emergency Services Contract & Work Authorization, 5 pages).
- Existing contract-template authoring: `src/components/contracts/template-editor.tsx` (retired in this build).
- Existing HTML→PDF renderer: `src/lib/contracts/pdf.ts` (685 lines, retired in this build).
- Merge field registry: `src/lib/contracts/merge-fields.ts` (reused unchanged).
- Existing signing flow: `src/app/contracts/[id]/page.tsx` and `src/app/contracts/[id]/sign-in-person/page.tsx` (rewritten internals).
- Predecessor builds: 15a (templates), 15b (remote signing), 15c (in-person + multi-signer + reminders).
- Adjacent prior art: 67c1 PDF rendering (`@react-pdf/renderer` for estimates/invoices) — distinct stack (`@react-pdf/renderer` builds PDFs from React; `pdf-lib` modifies existing PDFs). Both ship in this codebase post-67c1.

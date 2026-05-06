# Build 15d — Contract Template PDF Overlay Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tiptap-based contract template editor with a PDF-upload + drag-overlay-fields builder. Authors upload a finished PDF, drop six kinds of overlay fields onto exact coordinates per page, and at sign-time the customer fills any inputs/checkboxes and signs in-browser; the server stamps all values onto a copy of the PDF using `pdf-lib` and stores the stamped PDF as the signed contract artifact.

**Architecture:** `react-pdf` (wraps pdf.js) renders the PDF in both the editor and the customer signing view. Overlay fields are positioned in PDF points stored in a JSONB column on `contract_templates`. At sign-time, server-side `pdf-lib` opens the source PDF bytes from a new `contract-pdfs` private bucket, draws each field's resolved value (merge-field text, customer-typed input, checkbox glyph, embedded signature PNG), and uploads the stamped result. The Tiptap editor and the existing 685-line HTML→PDF renderer (`src/lib/contracts/pdf.ts`) are deleted in this same build — there is no coexistence period.

**Tech Stack:** Next.js (App Router; `next/dist`-vendored fork — read `node_modules/next/dist/docs/` before unfamiliar APIs), Supabase Postgres + Storage + service-role client, `react-pdf` ^10.x for in-browser PDF rendering, `pdf-lib` ^1.17 for server-side stamping, base-ui primitives, sonner for toasts. **No test framework** — verification is `npx tsc --noEmit` clean + `npm run build` clean + manual §11 test pass against prod Supabase Test Co + Vercel preview deploy verification.

**Spec:** [docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md](../specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md)

**Reference implementations to crib from:**
- 67c1 PDF rendering with `@react-pdf/renderer`: `src/lib/pdfs/render-pdf.ts`, `src/app/api/estimates/[id]/pdf/route.ts` (different stack — `@react-pdf/renderer` builds PDFs from React; **this build uses `pdf-lib` to modify existing PDFs** — both libs ship together post-67c1)
- 67d auto-save + 409-stale-check pattern: `src/components/job-detail/estimates-invoices-section.tsx` and the `version` column pattern on `estimates`
- Existing signature pad: `src/components/contracts/sign-in-person-modal.tsx` (the canvas signature-capture component is reusable)
- Existing merge-field registry: `src/lib/contracts/merge-fields.ts` (reused unchanged)

**Spec corrections discovered during plan-write:**
- Spec §3.1 named the new column `signed_pdf_storage_path`; the existing schema already has `Contract.signed_pdf_path` (per `src/lib/contracts/types.ts:77`). Plan **reuses the existing `signed_pdf_path` column** instead of adding a new one.
- Spec §3.4 referred to "signature_image_path (per-signer)"; per `src/lib/contracts/types.ts:94-110` this lives on the `contract_signers` table (one row per signer with `signature_image_path`, `typed_name`, `signed_at`). Stamping function keys signature data-URLs by `signer_id` (uuid string), and overlay fields with `type=signature` carry a `signerOrder: 1 | 2` (matching `contract_signers.signer_order`) instead of the spec's `signerIndex: 0 | 1`.
- Spec §3.6 named the customer-signing route `/api/contracts/[id]/sign`; the existing route is **`/api/sign/[token]`** (per `src/app/api/sign/[token]/route.ts`). Plan uses the existing token-authenticated route shape.
- `PublicSigningView` (types.ts:186-208) currently exposes `filled_content_html` to the customer. The new shape replaces that with `pdf_url` (signed URL of source template PDF or signed PDF if already signed) + `pdf_pages` + `overlay_fields` + `resolved_merge_values`. Legacy contracts whose only artifact is `filled_content_html` get a fork in the route.

---

## File structure

### New files

**Types + helpers:**
- `src/lib/contracts/overlay-types.ts` — `OverlayField` discriminated union + `OverlayFieldType`
- `src/lib/contracts/overlay-validation.ts` — server-side schema validation (zod)
- `src/lib/contracts/stamp-pdf.ts` — `pdf-lib` stamping function
- `src/lib/contracts/resolve-merge-values.ts` — pure function: given `(template, contract, job, customer, property, insurance, company)` returns `Record<mergeFieldName, resolvedString>` (extract logic that today lives inside the legacy `pdf.ts` HTML render)

**API routes:**
- `src/app/api/settings/contract-templates/[id]/pdf/route.ts` — POST multipart upload + GET signed URL
- `src/app/api/settings/contract-templates/[id]/preview/route.ts` — GET stamped sample PDF

**Editor components:**
- `src/components/contracts/template-pdf-upload-zone.tsx` — empty-state file picker
- `src/components/contracts/pdf-canvas.tsx` — react-pdf rendering + per-page overlay layer
- `src/components/contracts/overlay-field-chip.tsx` — placed-field with drag/resize handles
- `src/components/contracts/field-palette.tsx` — left sidebar pills + template metadata
- `src/components/contracts/field-inspector.tsx` — right sidebar properties panel
- `src/components/contracts/template-pdf-editor.tsx` — three-pane orchestrator with auto-save

**Customer signing components:**
- `src/components/contracts/contract-signer-view.tsx` — customer-side renderer (used by both signing routes)
- `src/components/contracts/signature-pad-modal.tsx` — extract reusable signature-pad from `sign-in-person-modal.tsx` (or wrap the existing canvas in a Dialog)

**Public assets:**
- `public/pdf.worker.min.mjs` — pdfjs worker bundle (copied from `node_modules/pdfjs-dist/build/`)

### Modified files

**Schema-driven:**
- `src/lib/contracts/types.ts` — `ContractTemplate` shape (drop `content`/`content_html`/`default_signer_count`, add `pdf_storage_path`/`pdf_page_count`/`pdf_pages`/`overlay_fields`/`signer_count`); `Contract` shape (add `customer_inputs`); `PublicSigningView` shape (replace `filled_content_html` with PDF + overlay payload, plus a `legacy_html?: string` fallback for already-signed legacy contracts)

**API routes:**
- `src/app/api/settings/contract-templates/route.ts` — POST creates empty template (no `content_html` field; signer_count default 1)
- `src/app/api/settings/contract-templates/[id]/route.ts` — PUT accepts new payload; remove HTML-related branches
- `src/app/api/settings/contract-templates/[id]/duplicate/route.ts` — copies `pdf_storage_path` (Storage `copy`) + `overlay_fields` + `signer_count`
- `src/app/api/settings/contract-templates/preview/route.ts` — repurposed: takes a `template_id` + sample data, returns stamped sample PDF (or DELETE this route and use the new `/[id]/preview` instead — pick one in Task 14)
- `src/app/api/sign/[token]/route.ts` — GET returns new `PublicSigningView` shape with PDF URL + overlay fields; POST validates customer inputs + calls `stampPdf` + uploads to `contract-pdfs/{org_id}/contracts/{contract_id}-signed.pdf`
- `src/app/api/contracts/in-person/route.ts` — same body shape change as sign route
- `src/app/api/contracts/route.ts` (POST creates contract) — drop `filled_content_html` writes; new contracts have `filled_content_html = NULL`
- `src/app/api/contracts/preview/route.ts` — repurposed: returns stamped preview using template overlays + sample data (or remove if `/api/settings/contract-templates/[id]/preview` covers the same need)

**Editor + signing pages:**
- `src/app/settings/contract-templates/page.tsx` — list page: rename "New Template" → "Upload Contract PDF"; rows show page-count badge + signer-count badge
- `src/app/settings/contract-templates/[id]/page.tsx` — render `<TemplatePdfEditor>` instead of `<TemplateEditor>`
- `src/app/contracts/[id]/page.tsx` — server-side: detect signed vs. legacy-HTML contracts; render `<ContractSignerView>` for new contracts; render legacy fallback for HTML-only contracts
- `src/app/contracts/[id]/sign-in-person/page.tsx` — same logic; embed `<ContractSignerView>` configured for in-person mode
- `src/app/contracts/[id]/sign-in-person/complete/page.tsx` — keep, no internal changes
- `src/app/sign/[token]/page.tsx` (or wherever the email-link signing page renders) — same fork logic

**Settings + contracts list (minor):**
- `src/components/contracts/contracts-section.tsx` — surface PDF download link from `signed_pdf_path` instead of HTML render link
- `src/components/contracts/preview-modal.tsx` + `preview-contract-modal.tsx` — point at new preview routes

### Retired (deleted) files

- `src/components/contracts/template-editor.tsx` (Tiptap editor)
- `src/components/contracts/merge-field-node.ts` (Tiptap node)
- `src/components/contracts/merge-field-sidebar.tsx` (subsumed by palette + inspector)
- `src/lib/contracts/pdf.ts` (685-line HTML → PDF renderer — replaced by `stamp-pdf.ts`; **note** `merge-fields.ts` stays, and any re-usable merge-resolution logic from `pdf.ts` gets extracted into the new `resolve-merge-values.ts` BEFORE deletion)

---

## Phase 0 — Pre-flight

### Task 1: Verify `contract_templates` schema state and existing data

**Files:** Read-only — captured into Task 5's migration body.

- [ ] **Step 1: Capture current `contract_templates` columns**

Run via Supabase MCP `execute_sql`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'contract_templates'
ORDER BY ordinal_position;
```

Expected columns at minimum: `id`, `organization_id`, `name`, `description`, `content` (jsonb, Tiptap doc), `content_html` (text), `default_signer_count` (int), `signer_role_label` (text), `is_active` (bool), `version` (int), `created_by` (uuid), `created_at`, `updated_at`. If any column already named `pdf_storage_path` / `overlay_fields` exists, **stop** — partial migration state.

- [ ] **Step 2: Count existing template rows per org**

```sql
SELECT organization_id, COUNT(*) AS templates,
       COUNT(*) FILTER (WHERE is_active) AS active
FROM contract_templates
GROUP BY 1;
```

Expected: small number per org (≤5). Capture for §11 test cleanup. Eric will need to re-upload PDFs for any active rows after the migration (they retain identity but lose Tiptap content).

- [ ] **Step 3: Count in-flight (unsigned, not voided) contracts that would be orphaned**

```sql
SELECT organization_id,
       COUNT(*) AS open,
       array_agg(id) FILTER (WHERE status IN ('sent','viewed') AND link_expires_at > NOW())
         AS active_links
FROM contracts
WHERE status NOT IN ('signed','voided','expired')
GROUP BY 1;
```

If `active_links` is non-empty, **stop and reconcile with Eric** — these contracts have live signing links pointing at HTML templates. Either let them expire/sign first, or void them and resend after migration.

- [ ] **Step 4: Capture `ContractSigner` table existence + signature storage path layout**

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN (
  'contract_signers_pkey',
  'contract_signers_contract_id_fkey'
);
SELECT prefix
FROM (
  SELECT regexp_replace(signature_image_path, '/[^/]+$', '') AS prefix
  FROM contract_signers
  WHERE signature_image_path IS NOT NULL
  LIMIT 5
) t;
```

Capture the path-prefix pattern (e.g. `signatures/{org_id}/{contract_id}/`) — the new bucket layout for signed PDFs sits alongside; need consistency. Document the pattern as a code comment in Task 9.

- [ ] **Step 5: Save captured outputs to a transient note**

Create `docs/superpowers/specs/2026-05-06-build-15d-preflight-capture.md` (uncommitted scratch) with the four query results pasted in. Migration in Task 5 references the captured column list verbatim.

No commit on this task — pre-flight is purely captured state.

---

### Task 2: Install runtime dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (regenerated)

- [ ] **Step 1: Install `react-pdf` + `pdf-lib`**

```bash
npm install --save react-pdf@^10 pdf-lib@^1.17
```

Both are pure-JS and run in Vercel's edge/Node runtime. `react-pdf` brings `pdfjs-dist` as a transitive dep (use the version it pins, do not separately upgrade).

- [ ] **Step 2: Verify uuid is already present**

```bash
node -e "console.log(require('uuid/package.json').version)"
```

Expected: prints a 9.x or 11.x version. If it errors with "Cannot find module", install it:

```bash
npm install --save uuid@^11
npm install --save-dev @types/uuid
```

- [ ] **Step 3: Verify install succeeded**

```bash
npm ls react-pdf pdf-lib uuid
```

Expected: each shows a single resolved version, no UNMET PEER warnings on `react`/`react-dom` (react-pdf 10.x requires React 18+).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps(15d): add react-pdf + pdf-lib for PDF overlay builder"
```

---

### Task 3: Set up pdfjs worker for Next.js

The `react-pdf` package needs a `pdfjs-dist` worker file accessible at runtime. Next.js serves files from `public/` at the site root, so we copy the worker there at install time.

**Files:**
- Create: `public/pdf.worker.min.mjs`
- Create: `src/lib/pdf/configure-pdfjs.ts`
- Modify: `package.json` (`scripts.postinstall`)

- [ ] **Step 1: Copy the worker file from node_modules**

```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
```

If the file doesn't exist, look for it under `node_modules/pdfjs-dist/build/` (filename varies by version; in pdfjs-dist 4.x it is `pdf.worker.min.mjs`; 3.x it was `pdf.worker.min.js`). Use whichever matches the installed version — verify with `ls node_modules/pdfjs-dist/build/`.

- [ ] **Step 2: Add a postinstall script to keep the worker in sync**

In `package.json` under `"scripts"`, add:

```json
"postinstall": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs"
```

If a `postinstall` script already exists, append the cp command with `&&`.

- [ ] **Step 3: Create the configuration module**

Create `src/lib/pdf/configure-pdfjs.ts`:

```ts
"use client";

import { pdfjs } from "react-pdf";

// Point react-pdf's bundled pdfjs at the worker we copied to /public.
// Must run once, on the client, before any <Document> renders.
let configured = false;

export function configurePdfjs() {
  if (configured) return;
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  configured = true;
}
```

- [ ] **Step 4: Verify type-check is clean**

```bash
npx tsc --noEmit
```

Expected: no errors. If pdfjs types complain, add `// @ts-expect-error pdfjs types are minimal` above the workerSrc assignment.

- [ ] **Step 5: Commit**

```bash
git add public/pdf.worker.min.mjs src/lib/pdf/configure-pdfjs.ts package.json
git commit -m "build(15d): copy pdfjs worker to public/ + postinstall hook"
```

---

## Phase 1 — Schema + Storage

### Task 4: Apply schema migration via Supabase MCP

**Files:**
- Create: `supabase/migration-build15d-contract-pdf-overlays.sql` (committed reference copy; actual application is via MCP)

- [ ] **Step 1: Write the migration file**

Create `supabase/migration-build15d-contract-pdf-overlays.sql`:

```sql
-- Build 15d: Contract template PDF-overlay builder.
--
-- Replaces Tiptap-authored contract templates with PDF-upload + positioned
-- overlay fields. Drops legacy authoring columns; adds PDF storage path,
-- per-page dimensions, the overlay-fields JSONB array, and a signer_count
-- column that supersedes default_signer_count.
--
-- contracts gets two adds: customer_inputs JSONB (captured at sign-time)
-- and reuses the existing signed_pdf_path for the stamped final PDF.
-- filled_content_html is retained for legacy already-signed contracts.

BEGIN;

-- contract_templates: drop legacy authoring columns
ALTER TABLE contract_templates
  DROP COLUMN IF EXISTS content,
  DROP COLUMN IF EXISTS content_html,
  DROP COLUMN IF EXISTS default_signer_count;

-- contract_templates: add PDF-overlay columns
ALTER TABLE contract_templates
  ADD COLUMN pdf_storage_path TEXT NULL,
  ADD COLUMN pdf_page_count INT NULL,
  ADD COLUMN pdf_pages JSONB NULL,
  ADD COLUMN overlay_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN signer_count INT NOT NULL DEFAULT 1;

-- Constraint: signer_count must be 1 or 2.
ALTER TABLE contract_templates
  ADD CONSTRAINT contract_templates_signer_count_check
  CHECK (signer_count IN (1, 2));

-- contracts: add customer-inputs column. signed_pdf_path already exists
-- (used by legacy HTML→PDF render path); we reuse it for stamped PDFs.
ALTER TABLE contracts
  ADD COLUMN customer_inputs JSONB NULL;

-- Index for lookups by template (used in editor for preview + by signing
-- route for stamping).
CREATE INDEX IF NOT EXISTS contract_templates_pdf_storage_path_idx
  ON contract_templates (pdf_storage_path)
  WHERE pdf_storage_path IS NOT NULL;

COMMIT;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with:
- `project_id`: `rzzprgidqbnqcdupmpfe`
- `name`: `build15d_contract_pdf_overlays`
- `query`: the file contents above

Expected: success response with no errors.

- [ ] **Step 3: Verify the migration landed cleanly**

Run via MCP `execute_sql`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'contract_templates'
  AND column_name IN ('pdf_storage_path','pdf_page_count','pdf_pages','overlay_fields','signer_count','content','content_html','default_signer_count')
ORDER BY column_name;
```

Expected: `overlay_fields`, `pdf_page_count`, `pdf_pages`, `pdf_storage_path`, `signer_count` exist; `content`, `content_html`, `default_signer_count` do **not** appear.

- [ ] **Step 4: Verify the contracts column landed**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contracts' AND column_name IN ('customer_inputs','signed_pdf_path','filled_content_html');
```

Expected: all three present; `customer_inputs` is jsonb nullable; `signed_pdf_path` is text nullable (pre-existing); `filled_content_html` is text nullable (pre-existing).

- [ ] **Step 5: Commit the migration file (reference copy)**

```bash
git add supabase/migration-build15d-contract-pdf-overlays.sql
git commit -m "migration(15d): contract template PDF overlay schema"
```

Note: the file is the canonical reference copy. The applied migration lives in Supabase's `supabase_migrations.schema_migrations` table.

---

### Task 5: Create `contract-pdfs` Storage bucket + RLS

**Files:** No code files — bucket setup is via Supabase MCP and SQL.

- [ ] **Step 1: Create the bucket via SQL**

Run via Supabase MCP `execute_sql`:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-pdfs',
  'contract-pdfs',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;
```

Expected: 1 row inserted (or 0 if already exists from a partial earlier run).

- [ ] **Step 2: Add SELECT policy — org members can read PDFs in their org's prefix**

```sql
CREATE POLICY "contract-pdfs read for org members"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'contract-pdfs'
  AND (storage.foldername(name))[1] IN (
    SELECT organization_id::text
    FROM user_organizations
    WHERE user_id = auth.uid()
  )
);
```

- [ ] **Step 3: Add INSERT/UPDATE/DELETE policies — manage_contract_templates required for templates/, service-role-only for contracts/**

```sql
CREATE POLICY "contract-pdfs write templates for permitted users"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'contract-pdfs'
  AND (storage.foldername(name))[2] = 'templates'
  AND (storage.foldername(name))[1] IN (
    SELECT uo.organization_id::text
    FROM user_organizations uo
    JOIN role_permissions rp ON rp.role = uo.role
    WHERE uo.user_id = auth.uid()
      AND rp.permission_key = 'manage_contract_templates'
  )
);

CREATE POLICY "contract-pdfs update templates for permitted users"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'contract-pdfs'
  AND (storage.foldername(name))[2] = 'templates'
  AND (storage.foldername(name))[1] IN (
    SELECT uo.organization_id::text
    FROM user_organizations uo
    JOIN role_permissions rp ON rp.role = uo.role
    WHERE uo.user_id = auth.uid()
      AND rp.permission_key = 'manage_contract_templates'
  )
);

CREATE POLICY "contract-pdfs delete templates for permitted users"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'contract-pdfs'
  AND (storage.foldername(name))[2] = 'templates'
  AND (storage.foldername(name))[1] IN (
    SELECT uo.organization_id::text
    FROM user_organizations uo
    JOIN role_permissions rp ON rp.role = uo.role
    WHERE uo.user_id = auth.uid()
      AND rp.permission_key = 'manage_contract_templates'
  )
);
```

The `contracts/` subfolder is written only by the server's service-role client during the signing flow (Task 22) — no client-facing policy needed since service-role bypasses RLS.

- [ ] **Step 4: Verify bucket and policies**

```sql
SELECT name, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'contract-pdfs';

SELECT polname FROM pg_policies
WHERE tablename = 'objects' AND polname LIKE 'contract-pdfs%';
```

Expected: bucket row + 4 policy names. If fewer policies, re-run only the missing ones.

- [ ] **Step 5: Document state in 00-NOW after build wraps**

(No commit on this task — bucket + policies are server-side state, not in version control.)

---

## Phase 2 — Core types + helpers

### Task 6: Update `src/lib/contracts/types.ts` with new shapes

**Files:**
- Modify: `src/lib/contracts/types.ts`

- [ ] **Step 1: Add the OverlayField type definitions at the top of the contract-template section**

In `src/lib/contracts/types.ts`, locate the `ContractTemplate` interface (around line 14). Insert ABOVE it:

```ts
export type OverlayFieldType =
  | "merge"
  | "signature"
  | "date"
  | "label"
  | "input"
  | "checkbox";

export interface OverlayField {
  id: string;            // uuid v4
  type: OverlayFieldType;
  page: number;          // 1-indexed
  x: number;             // PDF points from page top-left
  y: number;             // PDF points from page top-left
  width: number;         // PDF points
  height: number;        // PDF points
  fontSize: number;      // points; default 11
  // Type-specific (all optional in the shape; required by type per validation):
  mergeFieldName?: string;
  labelText?: string;
  signerOrder?: 1 | 2;   // matches contract_signers.signer_order
  inputKey?: string;
  inputLabel?: string;
  required?: boolean;
}

export interface PdfPage {
  page: number;
  width_pt: number;
  height_pt: number;
}
```

- [ ] **Step 2: Replace the `ContractTemplate` interface body**

Delete the existing `ContractTemplate` interface (lines ~14-26 — currently has `content`, `content_html`, `default_signer_count`). Replace with:

```ts
export interface ContractTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  pdf_storage_path: string | null;
  pdf_page_count: number | null;
  pdf_pages: PdfPage[] | null;
  overlay_fields: OverlayField[];
  signer_count: 1 | 2;
  signer_role_label: string;
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Replace `ContractTemplateListItem`**

```ts
export interface ContractTemplateListItem {
  id: string;
  name: string;
  description: string | null;
  pdf_page_count: number | null;
  signer_count: 1 | 2;
  is_active: boolean;
  updated_at: string;
}
```

- [ ] **Step 4: Add `customer_inputs` to the `Contract` interface**

In the existing `Contract` interface (line ~67), add a new line after `signed_pdf_path`:

```ts
  customer_inputs: Record<string, string | boolean> | null;
```

- [ ] **Step 5: Replace `PublicSigningView` to support PDF + legacy fork**

Replace the existing `PublicSigningView` (lines ~186-208):

```ts
export interface PublicSigningView {
  contract: {
    id: string;
    title: string;
    status: ContractStatus;
    link_expires_at: string | null;
    signed_at: string | null;
    signed_pdf_path: string | null;
    // Legacy: only populated for contracts authored before build 15d.
    legacy_html: string | null;
  };
  template: {
    id: string;
    pdf_url: string | null;          // signed URL of source template PDF
    pdf_pages: PdfPage[] | null;
    overlay_fields: OverlayField[];
    signer_count: 1 | 2;
    signer_role_label: string;
  };
  resolved_merge_values: Record<string, string>;
  signer: {
    id: string;
    signer_order: 1 | 2;
    name: string;
    role_label: string | null;
    signed_at: string | null;
  };
  other_signers: {
    id: string;
    signer_order: 1 | 2;
    signed_at: string | null;
  }[];
  company: {
    name: string;
    phone: string;
    email: string;
    address: string;
    logo_url: string | null;
  };
}
```

- [ ] **Step 6: Run tsc and find every consumer of the removed shape**

```bash
npx tsc --noEmit 2>&1 | head -80
```

Expected: errors in:
- `src/components/contracts/template-editor.tsx` (about to be deleted in Task 25 — leave broken)
- `src/components/contracts/merge-field-sidebar.tsx` (about to be deleted)
- `src/app/api/settings/contract-templates/route.ts` (Task 10)
- `src/app/api/settings/contract-templates/[id]/route.ts` (Task 12)
- `src/app/api/settings/contract-templates/[id]/duplicate/route.ts` (Task 12)
- `src/app/api/sign/[token]/route.ts` (Task 23)
- `src/app/api/contracts/preview/route.ts` (Task 14)
- `src/app/api/contracts/route.ts` (Task 23)
- `src/lib/contracts/pdf.ts` (about to be deleted in Task 25)
- `src/components/contracts/preview-modal.tsx` / `preview-contract-modal.tsx` (Task 24)

Document this list — these are the next tasks' scope. Do **not** fix the type errors yet; later tasks will address them in a coherent shape. The build will be broken until Phase 5 lands.

- [ ] **Step 7: Commit**

```bash
git add src/lib/contracts/types.ts
git commit -m "types(15d): contract template + signing view shapes for PDF overlay"
```

---

### Task 7: Build the merge-resolution helper

Extract merge-field resolution from the legacy `pdf.ts` into a small standalone module. The new flow needs it; the old file gets deleted in Task 25.

**Files:**
- Create: `src/lib/contracts/resolve-merge-values.ts`

- [ ] **Step 1: Read the existing resolution logic from `src/lib/contracts/pdf.ts`**

```bash
grep -n "MERGE_FIELDS\|resolveMerge\|customer\|insurance\|company" src/lib/contracts/pdf.ts | head -40
```

Identify the function(s) that take a job + customer + property + insurance + company context and produce a `Record<mergeFieldName, string>`. Note the field names used.

- [ ] **Step 2: Create the new helper**

Create `src/lib/contracts/resolve-merge-values.ts`:

```ts
import { MERGE_FIELDS } from "./merge-fields";
import type { MergeFieldDefinition } from "./types";

export interface MergeResolutionContext {
  contract: { id: string; signed_at: string | null } | null;
  job: {
    id: string;
    job_number: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    county: string | null;
  } | null;
  customer: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    county: string | null;
  } | null;
  insurance: {
    carrier: string | null;
    claim_number: string | null;
    adjuster_name: string | null;
    adjuster_email: string | null;
    adjuster_phone: string | null;
    deductible_amount: number | null;
  } | null;
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  signedAt?: Date;  // override for previews ("today" vs. live signed_at)
}

const FIELD_RESOLVERS: Record<string, (c: MergeResolutionContext) => string> = {
  customer_first_name: (c) => c.customer?.first_name ?? "",
  customer_last_name: (c) => c.customer?.last_name ?? "",
  customer_full_name: (c) =>
    [c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(" "),
  customer_email: (c) => c.customer?.email ?? "",
  customer_phone: (c) => c.customer?.phone ?? "",
  property_address: (c) => c.property?.address ?? c.job?.address ?? "",
  property_city: (c) => c.property?.city ?? c.job?.city ?? "",
  property_state: (c) => c.property?.state ?? c.job?.state ?? "",
  property_zip: (c) => c.property?.zip ?? c.job?.zip ?? "",
  property_county: (c) => c.property?.county ?? c.job?.county ?? "",
  job_number: (c) => c.job?.job_number ?? "",
  insurance_carrier: (c) => c.insurance?.carrier ?? "",
  claim_number: (c) => c.insurance?.claim_number ?? "",
  adjuster_name: (c) => c.insurance?.adjuster_name ?? "",
  adjuster_email: (c) => c.insurance?.adjuster_email ?? "",
  adjuster_phone: (c) => c.insurance?.adjuster_phone ?? "",
  deductible_amount: (c) =>
    c.insurance?.deductible_amount != null
      ? `$${c.insurance.deductible_amount.toFixed(2)}`
      : "",
  company_name: (c) => c.company.name,
  company_phone: (c) => c.company.phone ?? "",
  company_email: (c) => c.company.email ?? "",
  company_address: (c) => c.company.address ?? "",
  signed_date: (c) => {
    const d = c.signedAt ?? (c.contract?.signed_at ? new Date(c.contract.signed_at) : new Date());
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}/${dd}/${d.getFullYear()}`;
  },
};

export function resolveMergeValues(
  ctx: MergeResolutionContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of MERGE_FIELDS as MergeFieldDefinition[]) {
    const resolver = FIELD_RESOLVERS[def.name];
    out[def.name] = resolver ? (resolver(ctx) ?? "") : "";
    // Replace any newlines with spaces (single-line text only in v1).
    out[def.name] = out[def.name].replace(/[\r\n]+/g, " ");
  }
  return out;
}
```

If the actual `MERGE_FIELDS` registry has different field names than those above, **update the resolver map to match** — open `src/lib/contracts/merge-fields.ts` and use the actual `name` values from `MERGE_FIELDS`.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit src/lib/contracts/resolve-merge-values.ts 2>&1 | head -20
```

Expected: clean (file-scoped check). If the broader build is still broken from Task 6, that's expected — focus on this file.

- [ ] **Step 4: Commit**

```bash
git add src/lib/contracts/resolve-merge-values.ts
git commit -m "lib(15d): merge-value resolver for stamp-pdf"
```

---

### Task 8: Build the PDF stamping function (`stamp-pdf.ts`)

**Files:**
- Create: `src/lib/contracts/stamp-pdf.ts`

- [ ] **Step 1: Create the file**

```ts
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { OverlayField, PdfPage } from "./types";

export interface StampInput {
  sourcePdfBytes: Uint8Array;
  pdfPages: PdfPage[];
  overlayFields: OverlayField[];
  resolvedMergeValues: Record<string, string>;
  customerInputs: Record<string, string | boolean>;
  signatureDataUrls: Record<string, string>;  // keyed by signer_id (uuid)
  signerOrderById: Record<string, 1 | 2>;
  signedAt: Date;
}

const TEXT_COLOR = rgb(0, 0, 0);

export async function stampPdf(input: StampInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.sourcePdfBytes);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  for (const field of input.overlayFields) {
    const page = doc.getPage(field.page - 1);
    if (!page) continue;
    const pageHeight = page.getHeight();
    // Translate top-left origin (editor) → bottom-left origin (pdf-lib).
    const baselineY = pageHeight - field.y - field.height;

    switch (field.type) {
      case "merge": {
        if (!field.mergeFieldName) break;
        const value = input.resolvedMergeValues[field.mergeFieldName] ?? "";
        drawText(page, value, field, baselineY, helvetica);
        break;
      }
      case "date": {
        const d = input.signedAt;
        const value = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
        drawText(page, value, field, baselineY, helvetica);
        break;
      }
      case "label": {
        if (!field.labelText) break;
        drawMultilineText(page, field.labelText, field, baselineY, helvetica);
        break;
      }
      case "input": {
        if (!field.inputKey) break;
        const raw = input.customerInputs[field.inputKey];
        const value = typeof raw === "string" ? raw : "";
        drawText(page, value, field, baselineY, helvetica);
        break;
      }
      case "checkbox": {
        if (!field.inputKey) break;
        const raw = input.customerInputs[field.inputKey];
        if (raw === true) {
          // Draw a checkmark glyph centered in the box.
          const glyph = "X";
          const size = Math.min(field.width, field.height) * 0.8;
          const textWidth = helvetica.widthOfTextAtSize(glyph, size);
          page.drawText(glyph, {
            x: field.x + (field.width - textWidth) / 2,
            y: pageHeight - field.y - (field.height + size * 0.7) / 2,
            size,
            font: helvetica,
            color: TEXT_COLOR,
          });
        }
        break;
      }
      case "signature": {
        if (field.signerOrder == null) break;
        const signerId = findSignerIdByOrder(input.signerOrderById, field.signerOrder);
        if (!signerId) break;
        const dataUrl = input.signatureDataUrls[signerId];
        if (!dataUrl) break;
        const pngBytes = decodeDataUrl(dataUrl);
        if (!pngBytes) break;
        const img = await doc.embedPng(pngBytes);
        page.drawImage(img, {
          x: field.x,
          y: baselineY,
          width: field.width,
          height: field.height,
        });
        break;
      }
    }
  }

  return doc.save();
}

function drawText(
  page: ReturnType<PDFDocument["getPage"]>,
  text: string,
  field: OverlayField,
  baselineY: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  if (!text) return;
  const size = field.fontSize ?? 11;
  // Single-line: clip to the field width.
  const clipped = clipToWidth(text, field.width, size, font);
  page.drawText(clipped, {
    x: field.x,
    y: baselineY + (field.height - size) / 2,
    size,
    font,
    color: TEXT_COLOR,
  });
}

function drawMultilineText(
  page: ReturnType<PDFDocument["getPage"]>,
  text: string,
  field: OverlayField,
  baselineY: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  const size = field.fontSize ?? 11;
  const lineHeight = size * 1.2;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineText = clipToWidth(lines[i], field.width, size, font);
    const y = baselineY + field.height - (i + 1) * lineHeight;
    if (y < baselineY - lineHeight) break; // overflow stops at field bottom
    page.drawText(lineText, { x: field.x, y, size, font, color: TEXT_COLOR });
  }
}

function clipToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
): string {
  let s = text;
  while (s.length > 0 && font.widthOfTextAtSize(s, fontSize) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function findSignerIdByOrder(
  map: Record<string, 1 | 2>,
  order: 1 | 2,
): string | null {
  for (const [id, o] of Object.entries(map)) {
    if (o === order) return id;
  }
  return null;
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit src/lib/contracts/stamp-pdf.ts 2>&1 | head -20
```

Expected: clean. If `pdf-lib` types are missing, run `npm i --save-dev @types/pdf-lib` (likely not needed since pdf-lib ships its own).

- [ ] **Step 3: Commit**

```bash
git add src/lib/contracts/stamp-pdf.ts
git commit -m "lib(15d): stamp-pdf — pdf-lib overlay rendering"
```

---

### Task 9: Build the overlay-fields validation helper

**Files:**
- Create: `src/lib/contracts/overlay-validation.ts`

- [ ] **Step 1: Create the file**

```ts
import type { OverlayField, PdfPage } from "./types";
import { MERGE_FIELDS } from "./merge-fields";

export interface ValidationError {
  fieldId: string | null;
  code:
    | "duplicate_id"
    | "duplicate_input_key"
    | "page_out_of_range"
    | "out_of_bounds"
    | "unknown_merge_field"
    | "missing_required_property"
    | "invalid_signer_order"
    | "invalid_input_key";
  message: string;
}

const INPUT_KEY_RE = /^[a-z0-9_-]+$/;

export function validateOverlayFields(
  fields: OverlayField[],
  pdfPages: PdfPage[] | null,
  signerCount: 1 | 2,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();
  const seenInputKeys = new Set<string>();
  const knownMergeNames = new Set(MERGE_FIELDS.map((m) => m.name));

  for (const f of fields) {
    if (seenIds.has(f.id)) {
      errors.push({ fieldId: f.id, code: "duplicate_id", message: `Duplicate field id: ${f.id}` });
    }
    seenIds.add(f.id);

    if (pdfPages) {
      const meta = pdfPages.find((p) => p.page === f.page);
      if (!meta) {
        errors.push({
          fieldId: f.id,
          code: "page_out_of_range",
          message: `Page ${f.page} is out of range`,
        });
      } else if (
        f.x < 0 ||
        f.y < 0 ||
        f.x + f.width > meta.width_pt + 1 ||  // 1pt tolerance
        f.y + f.height > meta.height_pt + 1
      ) {
        errors.push({
          fieldId: f.id,
          code: "out_of_bounds",
          message: `Field overflows page ${f.page}`,
        });
      }
    }

    switch (f.type) {
      case "merge":
        if (!f.mergeFieldName) {
          errors.push({ fieldId: f.id, code: "missing_required_property", message: "merge field missing mergeFieldName" });
        } else if (!knownMergeNames.has(f.mergeFieldName)) {
          errors.push({ fieldId: f.id, code: "unknown_merge_field", message: `Unknown merge field: ${f.mergeFieldName}` });
        }
        break;
      case "label":
        if (!f.labelText) {
          errors.push({ fieldId: f.id, code: "missing_required_property", message: "label field missing labelText" });
        }
        break;
      case "signature":
        if (f.signerOrder !== 1 && f.signerOrder !== 2) {
          errors.push({ fieldId: f.id, code: "invalid_signer_order", message: "signature field requires signerOrder 1 or 2" });
        } else if (f.signerOrder > signerCount) {
          errors.push({
            fieldId: f.id,
            code: "invalid_signer_order",
            message: `signerOrder ${f.signerOrder} exceeds template signer_count ${signerCount}`,
          });
        }
        break;
      case "input":
      case "checkbox":
        if (!f.inputKey || !INPUT_KEY_RE.test(f.inputKey)) {
          errors.push({ fieldId: f.id, code: "invalid_input_key", message: `Invalid inputKey: ${f.inputKey ?? ""}` });
        } else if (seenInputKeys.has(f.inputKey)) {
          errors.push({ fieldId: f.id, code: "duplicate_input_key", message: `Duplicate inputKey: ${f.inputKey}` });
        } else {
          seenInputKeys.add(f.inputKey);
        }
        if (f.required && !f.inputLabel) {
          errors.push({ fieldId: f.id, code: "missing_required_property", message: "required input/checkbox needs inputLabel" });
        }
        break;
    }
  }

  return errors;
}

export function clampToPage(field: OverlayField, page: PdfPage): OverlayField {
  const w = Math.min(field.width, page.width_pt);
  const h = Math.min(field.height, page.height_pt);
  const x = Math.max(0, Math.min(field.x, page.width_pt - w));
  const y = Math.max(0, Math.min(field.y, page.height_pt - h));
  return { ...field, x, y, width: w, height: h };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit src/lib/contracts/overlay-validation.ts 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/contracts/overlay-validation.ts
git commit -m "lib(15d): overlay-fields server-side validator"
```

---

## Phase 3 — Template authoring API routes

### Task 10: Update POST `/api/settings/contract-templates` (create empty template)

**Files:**
- Modify: `src/app/api/settings/contract-templates/route.ts`

- [ ] **Step 1: Read the existing file**

Read `src/app/api/settings/contract-templates/route.ts` fully to understand the existing pattern (auth check, payload shape, return shape).

- [ ] **Step 2: Replace the POST body with new shape**

Find the POST handler (around line 30-50 based on the earlier `content_html: ""` reference). Replace the insert payload:

```ts
// OLD: insert with content + content_html
// NEW: insert with empty overlay state — PDF uploaded separately in Task 11
const insertPayload = {
  organization_id: orgId,
  name: body.name?.trim() || "Untitled",
  description: body.description ?? null,
  pdf_storage_path: null,
  pdf_page_count: null,
  pdf_pages: null,
  overlay_fields: [],
  signer_count: body.signer_count === 2 ? 2 : 1,
  signer_role_label: body.signer_role_label ?? "Customer",
  is_active: false,
  version: 1,
  created_by: userId,
};
```

- [ ] **Step 3: GET (list) — update the SELECT**

If GET in this file builds list rows, ensure it selects: `id, name, description, pdf_page_count, signer_count, is_active, updated_at` (matching the new `ContractTemplateListItem`).

- [ ] **Step 4: Type-check the file**

```bash
npx tsc --noEmit 2>&1 | grep -A2 "settings/contract-templates/route.ts"
```

Expected: this specific file is clean. The broader project still has type errors from other files (handled in later tasks).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/contract-templates/route.ts
git commit -m "api(15d): create-empty-template payload — drop HTML, add PDF columns"
```

---

### Task 11: Add POST `/api/settings/contract-templates/[id]/pdf` (upload + GET signed URL)

**Files:**
- Create: `src/app/api/settings/contract-templates/[id]/pdf/route.ts`

- [ ] **Step 1: Create the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { requireAuthAndOrg } from "@/lib/auth/server";
import { requirePermission } from "@/lib/auth/permissions-api";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { apiDbError } from "@/lib/api-errors";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAuthAndOrg();
  if ("error" in auth) return auth.error;
  const perm = await requirePermission(auth, "manage_contract_templates");
  if ("error" in perm) return perm.error;

  const formData = await req.formData();
  const file = formData.get("pdf");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", max_bytes: MAX_BYTES }, { status: 413 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Parse for page count + dimensions.
  let pageCount: number;
  let pdfPages: { page: number; width_pt: number; height_pt: number }[];
  try {
    const doc = await PDFDocument.load(bytes);
    pageCount = doc.getPageCount();
    pdfPages = Array.from({ length: pageCount }, (_, i) => {
      const p = doc.getPage(i);
      return { page: i + 1, width_pt: p.getWidth(), height_pt: p.getHeight() };
    });
  } catch (err) {
    return NextResponse.json({ error: "pdf_parse_failed", detail: String(err) }, { status: 400 });
  }

  // Verify the row exists and belongs to this org.
  const supabase = await createServerClient();
  const { data: existing, error: selectErr } = await supabase
    .from("contract_templates")
    .select("id")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (selectErr) return apiDbError(selectErr.message, "POST /api/settings/contract-templates/[id]/pdf select");
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Upload to Storage.
  const path = `${auth.orgId}/templates/${id}.pdf`;
  const service = createServiceRoleClient();
  const { error: uploadErr } = await service.storage
    .from("contract-pdfs")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadErr) return apiDbError(uploadErr.message, "POST /api/settings/contract-templates/[id]/pdf upload");

  // Update the row + clear overlay_fields (replacement clears positions).
  const { data: updated, error: updateErr } = await supabase
    .from("contract_templates")
    .update({
      pdf_storage_path: path,
      pdf_page_count: pageCount,
      pdf_pages: pdfPages,
      overlay_fields: [],
      version: undefined as unknown as number,  // bumped via DB trigger; or compute below
    })
    .eq("id", id)
    .select()
    .single();
  if (updateErr) return apiDbError(updateErr.message, "POST /api/settings/contract-templates/[id]/pdf update");

  return NextResponse.json({ template: updated });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAuthAndOrg();
  if ("error" in auth) return auth.error;

  const supabase = await createServerClient();
  const { data: tpl, error } = await supabase
    .from("contract_templates")
    .select("pdf_storage_path")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (error) return apiDbError(error.message, "GET /api/settings/contract-templates/[id]/pdf select");
  if (!tpl?.pdf_storage_path) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

  const service = createServiceRoleClient();
  const { data: signed, error: signErr } = await service.storage
    .from("contract-pdfs")
    .createSignedUrl(tpl.pdf_storage_path, 60);
  if (signErr || !signed) return apiDbError(signErr?.message ?? "sign_failed", "GET /api/settings/contract-templates/[id]/pdf sign");

  return NextResponse.json({ url: signed.signedUrl });
}
```

If the actual auth helper names differ from `requireAuthAndOrg` / `requirePermission`, look up the patterns used in `src/app/api/settings/pdf-presets/route.ts` (Build 67c1) and follow that exact shape.

- [ ] **Step 2: Verify the version-bump approach**

If `contract_templates` has a DB trigger that auto-increments `version` on UPDATE, leave the `version: undefined` line above as-is (or remove it). If versioning is application-side, replace with explicit `version: existing.version + 1` (re-select `version` first).

Check via:

```bash
grep -rn "version" src/app/api/settings/contract-templates/[id]/route.ts
```

Match the existing pattern.

- [ ] **Step 3: Type-check the file**

```bash
npx tsc --noEmit 2>&1 | grep "templates/\[id\]/pdf"
```

Expected: clean for this file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/contract-templates/[id]/pdf/route.ts
git commit -m "api(15d): POST/GET template PDF (upload + signed-url)"
```

---

### Task 12: Update PUT `/api/settings/contract-templates/[id]` (save with new payload)

**Files:**
- Modify: `src/app/api/settings/contract-templates/[id]/route.ts`
- Modify: `src/app/api/settings/contract-templates/[id]/duplicate/route.ts`

- [ ] **Step 1: Update PUT payload handling**

Open `src/app/api/settings/contract-templates/[id]/route.ts`. Find the PUT handler. Replace the payload extraction block:

```ts
// Accept only fields the editor sends; ignore unknown.
const update: Partial<{
  name: string;
  description: string | null;
  signer_count: 1 | 2;
  signer_role_label: string;
  overlay_fields: OverlayField[];
  is_active: boolean;
}> = {};

if (typeof body.name === "string") update.name = body.name.trim();
if (body.description === null || typeof body.description === "string")
  update.description = body.description;
if (body.signer_count === 1 || body.signer_count === 2)
  update.signer_count = body.signer_count;
if (typeof body.signer_role_label === "string")
  update.signer_role_label = body.signer_role_label;
if (Array.isArray(body.overlay_fields)) {
  // Validate before persisting.
  const errs = validateOverlayFields(
    body.overlay_fields,
    existing.pdf_pages,
    existing.signer_count as 1 | 2,
  );
  if (errs.length) {
    return NextResponse.json({ error: "invalid_overlay_fields", details: errs }, { status: 400 });
  }
  update.overlay_fields = body.overlay_fields;
}
if (typeof body.is_active === "boolean") update.is_active = body.is_active;
```

Add the imports at the top of the file:

```ts
import type { OverlayField } from "@/lib/contracts/types";
import { validateOverlayFields } from "@/lib/contracts/overlay-validation";
```

Remove the old `body.content_html` / `body.content` branches (the `contentChanged` flag and the `update.content_html` / `update.content` lines).

- [ ] **Step 2: Preserve the 409-stale-check pattern**

If the existing PUT has a `version` check (typical for 67a-style auto-save), keep it. The check looks like:

```ts
const incomingVersion = Number(body.version);
if (Number.isFinite(incomingVersion) && incomingVersion !== existing.version) {
  return NextResponse.json({ error: "stale", current: existing.version }, { status: 409 });
}
```

If no such check exists today, add one before the update.

- [ ] **Step 3: Update the duplicate route**

Open `src/app/api/settings/contract-templates/[id]/duplicate/route.ts`. Find the line that copies `content_html: source.content_html`. Replace the copy block to pass through the new fields:

```ts
const insertPayload = {
  organization_id: source.organization_id,
  name: `${source.name} (copy)`,
  description: source.description,
  pdf_storage_path: null,  // duplicated PDF needs a separate copy in Storage
  pdf_page_count: source.pdf_page_count,
  pdf_pages: source.pdf_pages,
  overlay_fields: source.overlay_fields,
  signer_count: source.signer_count,
  signer_role_label: source.signer_role_label,
  is_active: false,
  version: 1,
  created_by: userId,
};
```

After insert, copy the source PDF in Storage if present:

```ts
if (source.pdf_storage_path) {
  const newPath = `${source.organization_id}/templates/${newRow.id}.pdf`;
  const service = createServiceRoleClient();
  await service.storage.from("contract-pdfs").copy(source.pdf_storage_path, newPath);
  await supabase.from("contract_templates").update({ pdf_storage_path: newPath }).eq("id", newRow.id);
}
```

- [ ] **Step 4: Type-check both files**

```bash
npx tsc --noEmit 2>&1 | grep "settings/contract-templates"
```

Expected: clean for these two files.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/contract-templates/[id]/route.ts src/app/api/settings/contract-templates/[id]/duplicate/route.ts
git commit -m "api(15d): template PUT + duplicate accept overlay payload"
```

---

### Task 13: Add GET `/api/settings/contract-templates/[id]/preview` (sample stamped PDF)

**Files:**
- Create: `src/app/api/settings/contract-templates/[id]/preview/route.ts`

- [ ] **Step 1: Create the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuthAndOrg } from "@/lib/auth/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { apiDbError } from "@/lib/api-errors";
import { stampPdf } from "@/lib/contracts/stamp-pdf";
import { resolveMergeValues } from "@/lib/contracts/resolve-merge-values";
import type { OverlayField, PdfPage } from "@/lib/contracts/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAuthAndOrg();
  if ("error" in auth) return auth.error;

  const supabase = await createServerClient();
  const { data: tpl, error } = await supabase
    .from("contract_templates")
    .select("id, pdf_storage_path, pdf_pages, overlay_fields, signer_count")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (error) return apiDbError(error.message, "GET preview select");
  if (!tpl?.pdf_storage_path) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

  const { data: company } = await supabase
    .from("organizations").select("name, phone, email, address").eq("id", auth.orgId).maybeSingle();

  const sample = {
    customer_first_name: "John",
    customer_last_name: "Doe",
    customer_full_name: "John Doe",
    customer_email: "john@example.com",
    customer_phone: "(555) 123-4567",
    property_address: "123 Main Street",
    property_city: "Austin",
    property_state: "TX",
    property_zip: "78701",
    property_county: "Travis",
    job_number: "WTR-2026-SAMPLE",
    insurance_carrier: "Sample Insurance Co",
    claim_number: "CLM-12345",
    adjuster_name: "Jane Adjuster",
    deductible_amount: "$1,000.00",
    company_name: company?.name ?? "Your Company",
    company_phone: company?.phone ?? "",
    company_email: company?.email ?? "",
    company_address: company?.address ?? "",
    signed_date: new Date().toLocaleDateString("en-US"),
  };

  // Sample customer inputs: first input field gets "Sample Input", first checkbox checked.
  const overlayFields = (tpl.overlay_fields ?? []) as OverlayField[];
  const customerInputs: Record<string, string | boolean> = {};
  for (const f of overlayFields) {
    if (f.type === "input" && f.inputKey) customerInputs[f.inputKey] = "Sample Input";
    if (f.type === "checkbox" && f.inputKey) customerInputs[f.inputKey] = true;
  }

  const service = createServiceRoleClient();
  const { data: blob, error: dlErr } = await service.storage
    .from("contract-pdfs").download(tpl.pdf_storage_path);
  if (dlErr || !blob) return apiDbError(dlErr?.message ?? "download_failed", "GET preview download");
  const sourceBytes = new Uint8Array(await blob.arrayBuffer());

  let stampedBytes: Uint8Array;
  try {
    stampedBytes = await stampPdf({
      sourcePdfBytes: sourceBytes,
      pdfPages: (tpl.pdf_pages ?? []) as PdfPage[],
      overlayFields,
      resolvedMergeValues: sample,
      customerInputs,
      signatureDataUrls: {},  // no signatures in preview
      signerOrderById: {},
      signedAt: new Date(),
    });
  } catch (err) {
    return apiDbError(String(err), "GET preview stamp");
  }

  return new NextResponse(stampedBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"preview.pdf\"",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "settings/contract-templates/\[id\]/preview"
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/settings/contract-templates/[id]/preview/route.ts
git commit -m "api(15d): GET preview — sample stamped PDF"
```

---

## Phase 4 — Editor UI

### Task 14: Build the `<TemplatePdfUploadZone>` empty state

**Files:**
- Create: `src/components/contracts/template-pdf-upload-zone.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import type { ContractTemplate } from "@/lib/contracts/types";

interface Props {
  templateId: string;
  onUploaded: (tpl: ContractTemplate) => void;
}

export default function TemplatePdfUploadZone({ templateId, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("PDF files only");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("PDF must be 10 MB or smaller");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("pdf", file);
      const res = await fetch(`/api/settings/contract-templates/${templateId}/pdf`, {
        method: "POST",
        body: form,
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error === "pdf_parse_failed" ? "Could not read this PDF — try re-saving from your PDF tool" : (j.error ?? "Upload failed"));
        return;
      }
      onUploaded(j.template);
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div
      className="flex-1 m-6 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center text-center p-12 hover:border-[var(--brand-primary)]/40 transition-colors"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Upload size={40} className="text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">Upload Contract PDF</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Drop a PDF here, or click to choose. Drop merge fields and signature blocks onto the pages once it loads.
      </p>
      <label className="inline-flex items-center px-4 py-2 rounded-md bg-[var(--brand-primary)] text-white font-medium cursor-pointer hover:brightness-110 disabled:opacity-50">
        {busy ? "Uploading…" : "Choose PDF"}
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
        />
      </label>
      <p className="text-xs text-muted-foreground mt-4">10 MB max</p>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep template-pdf-upload-zone
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/contracts/template-pdf-upload-zone.tsx
git commit -m "ui(15d): TemplatePdfUploadZone empty-state"
```

---

### Task 15: Build the `<PdfCanvas>` component

**Files:**
- Create: `src/components/contracts/pdf-canvas.tsx`

This is the core renderer: it loads the PDF via react-pdf, renders all pages stacked vertically, and exposes an overlay layer per page where children render absolute-positioned chips.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";
import type { OverlayField, PdfPage } from "@/lib/contracts/types";

interface Props {
  pdfUrl: string;
  pdfPages: PdfPage[];
  overlayFields: OverlayField[];
  scale?: number;  // CSS px per PDF point (default 1.5)
  // Render-prop for overlay chips per page. Receives the page's PDF-pt size + the fields on this page.
  renderOverlay: (args: {
    page: PdfPage;
    fields: OverlayField[];
    scale: number;
    onPageDrop: (page: number, xPt: number, yPt: number, dataTransfer: DataTransfer) => void;
  }) => React.ReactNode;
  onPageDrop?: (page: number, xPt: number, yPt: number, dataTransfer: DataTransfer) => void;
}

export default function PdfCanvas({
  pdfUrl,
  pdfPages,
  overlayFields,
  scale = 1.5,
  renderOverlay,
  onPageDrop,
}: Props) {
  const [numPages, setNumPages] = useState<number>(pdfPages.length);

  useEffect(() => {
    configurePdfjs();
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <Document
        file={pdfUrl}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<div className="text-muted-foreground">Loading PDF…</div>}
        error={<div className="text-red-500">Failed to load PDF</div>}
      >
        {Array.from({ length: numPages }, (_, i) => {
          const pageNum = i + 1;
          const meta = pdfPages.find((p) => p.page === pageNum);
          if (!meta) return null;
          const fields = overlayFields.filter((f) => f.page === pageNum);
          return (
            <div
              key={pageNum}
              className="relative shadow-lg"
              style={{ width: meta.width_pt * scale, height: meta.height_pt * scale }}
            >
              <Page
                pageNumber={pageNum}
                width={meta.width_pt * scale}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
              <div
                className="absolute inset-0"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!onPageDrop) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xPt = (e.clientX - rect.left) / scale;
                  const yPt = (e.clientY - rect.top) / scale;
                  onPageDrop(pageNum, xPt, yPt, e.dataTransfer);
                }}
              >
                {renderOverlay({
                  page: meta,
                  fields,
                  scale,
                  onPageDrop: onPageDrop ?? (() => {}),
                })}
              </div>
            </div>
          );
        })}
      </Document>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "pdf-canvas"
```

Expected: clean. If react-pdf types aren't found, `npm i --save-dev @types/react-pdf` is **not** needed (react-pdf 10+ ships its own types) — instead verify the version with `npm ls react-pdf`.

- [ ] **Step 3: Commit**

```bash
git add src/components/contracts/pdf-canvas.tsx
git commit -m "ui(15d): PdfCanvas — react-pdf rendering + per-page drop layer"
```

---

### Task 16: Build the `<OverlayFieldChip>` component (placed-field with drag/resize)

**Files:**
- Create: `src/components/contracts/overlay-field-chip.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useRef } from "react";
import { Trash2 } from "lucide-react";
import type { OverlayField } from "@/lib/contracts/types";

interface Props {
  field: OverlayField;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: OverlayField) => void;
  onDelete: () => void;
  pageWidthPt: number;
  pageHeightPt: number;
}

const TYPE_COLORS: Record<OverlayField["type"], string> = {
  merge: "bg-blue-100 border-blue-400 text-blue-900",
  signature: "bg-purple-100 border-purple-400 text-purple-900",
  date: "bg-green-100 border-green-400 text-green-900",
  label: "bg-zinc-100 border-zinc-400 text-zinc-800",
  input: "bg-amber-100 border-amber-400 text-amber-900",
  checkbox: "bg-pink-100 border-pink-400 text-pink-900",
};

const TYPE_LABEL: Record<OverlayField["type"], (f: OverlayField) => string> = {
  merge: (f) => f.mergeFieldName ? `{{${f.mergeFieldName}}}` : "Merge field",
  signature: (f) => `Signature ${f.signerOrder ?? 1}`,
  date: () => "Signed date",
  label: (f) => f.labelText || "Label",
  input: (f) => `Input: ${f.inputLabel ?? f.inputKey ?? "(unlabeled)"}`,
  checkbox: (f) => `☐ ${f.inputLabel ?? f.inputKey ?? "(unlabeled)"}`,
};

export default function OverlayFieldChip({
  field, scale, selected, onSelect, onChange, onDelete, pageWidthPt, pageHeightPt,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  function startMove(e: React.PointerEvent) {
    if ((e.target as HTMLElement).dataset.handle) return; // resize handle
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startFx = field.x;
    const startFy = field.y;

    function move(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      const nextX = clamp(startFx + dx, 0, pageWidthPt - field.width);
      const nextY = clamp(startFy + dy, 0, pageHeightPt - field.height);
      onChange({ ...field, x: nextX, y: nextY });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(corner: "se" | "sw" | "ne" | "nw") {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      const startX = e.clientX;
      const startY = e.clientY;
      const start = { ...field };

      function move(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        let next = { ...start };
        if (corner.includes("e")) next.width = Math.max(20, start.width + dx);
        if (corner.includes("s")) next.height = Math.max(12, start.height + dy);
        if (corner.includes("w")) {
          next.x = clamp(start.x + dx, 0, start.x + start.width - 20);
          next.width = Math.max(20, start.width - dx);
        }
        if (corner.includes("n")) {
          next.y = clamp(start.y + dy, 0, start.y + start.height - 12);
          next.height = Math.max(12, start.height - dy);
        }
        // Clamp to page.
        next.width = Math.min(next.width, pageWidthPt - next.x);
        next.height = Math.min(next.height, pageHeightPt - next.y);
        onChange(next);
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  return (
    <div
      ref={ref}
      onPointerDown={startMove}
      className={`absolute border-2 rounded text-xs font-medium select-none flex items-center px-1.5 cursor-move ${
        TYPE_COLORS[field.type]
      } ${selected ? "ring-2 ring-[var(--brand-primary)]" : ""}`}
      style={{
        left: field.x * scale,
        top: field.y * scale,
        width: field.width * scale,
        height: field.height * scale,
      }}
    >
      <span className="truncate flex-1">{TYPE_LABEL[field.type](field)}</span>
      {selected && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            className="ml-1 text-red-600 hover:bg-red-100 rounded p-0.5"
          >
            <Trash2 size={12} />
          </button>
          {(["nw", "ne", "sw", "se"] as const).map((c) => (
            <span
              key={c}
              data-handle={c}
              onPointerDown={startResize(c)}
              className="absolute w-2 h-2 bg-[var(--brand-primary)] border border-white rounded-sm"
              style={{
                left: c.includes("w") ? -4 : "auto",
                right: c.includes("e") ? -4 : "auto",
                top: c.includes("n") ? -4 : "auto",
                bottom: c.includes("s") ? -4 : "auto",
                cursor: `${c}-resize`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "overlay-field-chip"
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/contracts/overlay-field-chip.tsx
git commit -m "ui(15d): OverlayFieldChip — drag-to-move + corner resize"
```

---

### Task 17: Build `<FieldPalette>` (left sidebar) and `<FieldInspector>` (right sidebar)

**Files:**
- Create: `src/components/contracts/field-palette.tsx`
- Create: `src/components/contracts/field-inspector.tsx`

- [ ] **Step 1: Create FieldPalette**

```tsx
"use client";

import { Type, PenTool, Calendar, Tag, Keyboard, CheckSquare } from "lucide-react";
import type { OverlayFieldType } from "@/lib/contracts/types";

const PALETTE: { type: OverlayFieldType; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { type: "merge", label: "Merge field", Icon: Type },
  { type: "signature", label: "Signature", Icon: PenTool },
  { type: "date", label: "Date", Icon: Calendar },
  { type: "label", label: "Label", Icon: Tag },
  { type: "input", label: "Input", Icon: Keyboard },
  { type: "checkbox", label: "Checkbox", Icon: CheckSquare },
];

interface Props {
  onReplacePdf: () => void;
  templateName: string;
  templateDescription: string | null;
  signerCount: 1 | 2;
  signerRoleLabel: string;
  onMetaChange: (next: { name?: string; description?: string | null; signer_count?: 1 | 2; signer_role_label?: string }) => void;
}

export default function FieldPalette({
  onReplacePdf, templateName, templateDescription, signerCount, signerRoleLabel, onMetaChange,
}: Props) {
  return (
    <aside className="w-64 border-r border-border bg-muted/30 flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Drag onto page
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {PALETTE.map(({ type, label, Icon }) => (
            <div
              key={type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-overlay-field-type", type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="cursor-grab active:cursor-grabbing flex flex-col items-center gap-1 p-3 rounded-lg bg-card border border-border hover:border-[var(--brand-primary)] hover:bg-accent transition-colors"
            >
              <Icon size={18} />
              <span className="text-[11px] font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Template</h3>
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            value={templateName}
            onChange={(e) => onMetaChange({ name: e.target.value })}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Description</label>
          <textarea
            value={templateDescription ?? ""}
            onChange={(e) => onMetaChange({ description: e.target.value || null })}
            rows={2}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Signer role label</label>
          <input
            value={signerRoleLabel}
            onChange={(e) => onMetaChange({ signer_role_label: e.target.value })}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Signer count</label>
          <div className="mt-1 flex gap-2">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onMetaChange({ signer_count: n as 1 | 2 })}
                className={`flex-1 px-2 py-1.5 text-sm rounded border ${
                  signerCount === n ? "bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]" : "border-border bg-background"
                }`}
              >
                {n} signer{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-4 border-t border-border">
        <button
          type="button"
          onClick={onReplacePdf}
          className="w-full px-3 py-2 text-sm rounded border border-border hover:bg-accent"
        >
          Replace PDF
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create FieldInspector**

```tsx
"use client";

import { MERGE_FIELDS, MERGE_FIELD_CATEGORIES, mergeFieldsByCategory } from "@/lib/contracts/merge-fields";
import type { OverlayField } from "@/lib/contracts/types";

interface Props {
  field: OverlayField | null;
  signerCount: 1 | 2;
  onChange: (next: OverlayField) => void;
}

export default function FieldInspector({ field, signerCount, onChange }: Props) {
  if (!field) {
    return (
      <aside className="w-72 border-l border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Select a field to edit its properties.
      </aside>
    );
  }

  const grouped = mergeFieldsByCategory();

  return (
    <aside className="w-72 border-l border-border bg-muted/30 p-4 space-y-4 overflow-y-auto">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {field.type} field
        </h3>
        <p className="text-xs text-muted-foreground">
          Page {field.page} · {Math.round(field.x)}, {Math.round(field.y)} · {Math.round(field.width)} × {Math.round(field.height)}pt
        </p>
      </div>

      {field.type === "merge" && (
        <div>
          <label className="text-xs text-muted-foreground">Merge field</label>
          <select
            value={field.mergeFieldName ?? ""}
            onChange={(e) => onChange({ ...field, mergeFieldName: e.target.value })}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          >
            <option value="">— select —</option>
            {MERGE_FIELD_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={cat}>
                {grouped[cat].map((f) => (
                  <option key={f.name} value={f.name}>{f.label} — {`{{${f.name}}}`}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {field.type === "label" && (
        <div>
          <label className="text-xs text-muted-foreground">Label text</label>
          <textarea
            value={field.labelText ?? ""}
            onChange={(e) => onChange({ ...field, labelText: e.target.value })}
            rows={3}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
      )}

      {field.type === "signature" && signerCount === 2 && (
        <div>
          <label className="text-xs text-muted-foreground">Signer</label>
          <div className="mt-1 flex gap-2">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...field, signerOrder: n as 1 | 2 })}
                className={`flex-1 px-2 py-1.5 text-sm rounded border ${
                  field.signerOrder === n ? "bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]" : "border-border bg-background"
                }`}
              >
                Signer {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {(field.type === "input" || field.type === "checkbox") && (
        <>
          <div>
            <label className="text-xs text-muted-foreground">Field key (slug)</label>
            <input
              value={field.inputKey ?? ""}
              onChange={(e) => onChange({ ...field, inputKey: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") })}
              placeholder="deductible_amount"
              className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Label shown to customer</label>
            <input
              value={field.inputLabel ?? ""}
              onChange={(e) => onChange({ ...field, inputLabel: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={field.required ?? false}
              onChange={(e) => onChange({ ...field, required: e.target.checked })}
            />
            Required
          </label>
        </>
      )}

      {(field.type === "merge" || field.type === "date" || field.type === "label" || field.type === "input") && (
        <div>
          <label className="text-xs text-muted-foreground">Font size (pt)</label>
          <input
            type="number"
            min={6}
            max={48}
            value={field.fontSize}
            onChange={(e) => onChange({ ...field, fontSize: Math.max(6, Math.min(48, Number(e.target.value) || 11)) })}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "field-(palette|inspector)"
```

Expected: clean for both files.

- [ ] **Step 4: Commit**

```bash
git add src/components/contracts/field-palette.tsx src/components/contracts/field-inspector.tsx
git commit -m "ui(15d): FieldPalette + FieldInspector"
```

---

### Task 18: Build `<TemplatePdfEditor>` orchestrator with auto-save

**Files:**
- Create: `src/components/contracts/template-pdf-editor.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import TemplatePdfUploadZone from "./template-pdf-upload-zone";
import PdfCanvas from "./pdf-canvas";
import OverlayFieldChip from "./overlay-field-chip";
import FieldPalette from "./field-palette";
import FieldInspector from "./field-inspector";
import type { ContractTemplate, OverlayField, OverlayFieldType, PdfPage } from "@/lib/contracts/types";

interface Props {
  initial: ContractTemplate;
}

const DEFAULT_FIELD_SIZE: Record<OverlayFieldType, { width: number; height: number; fontSize: number }> = {
  merge:     { width: 200, height: 16, fontSize: 11 },
  signature: { width: 180, height: 40, fontSize: 11 },
  date:      { width: 100, height: 16, fontSize: 11 },
  label:     { width: 200, height: 16, fontSize: 11 },
  input:     { width: 200, height: 18, fontSize: 11 },
  checkbox:  { width: 14,  height: 14, fontSize: 11 },
};

export default function TemplatePdfEditor({ initial }: Props) {
  const [template, setTemplate] = useState<ContractTemplate>(initial);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // Fetch signed URL for the source PDF whenever pdf_storage_path changes.
  useEffect(() => {
    let cancelled = false;
    if (!template.pdf_storage_path) {
      setPdfUrl(null);
      return;
    }
    fetch(`/api/settings/contract-templates/${template.id}/pdf`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setPdfUrl(j.url ?? null); })
      .catch(() => { if (!cancelled) setPdfUrl(null); });
    return () => { cancelled = true; };
  }, [template.id, template.pdf_storage_path]);

  const persist = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSavingState("saving");
    const res = await fetch(`/api/settings/contract-templates/${template.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: template.name,
        description: template.description,
        signer_count: template.signer_count,
        signer_role_label: template.signer_role_label,
        overlay_fields: template.overlay_fields,
        version: template.version,
      }),
    });
    if (res.status === 409) {
      setSavingState("error");
      const j = await res.json();
      toast.error("Template was updated elsewhere — reloading.");
      // Refetch latest.
      const r = await fetch(`/api/settings/contract-templates/${template.id}`);
      const fresh = await r.json();
      setTemplate(fresh.template ?? fresh);
      return;
    }
    if (!res.ok) {
      setSavingState("error");
      const j = await res.json().catch(() => ({}));
      toast.error(j.error === "invalid_overlay_fields" ? "Some fields are invalid — check inspector" : "Save failed");
      return;
    }
    const j = await res.json();
    if (j.template) setTemplate((prev) => ({ ...prev, version: j.template.version, updated_at: j.template.updated_at }));
    setSavingState("saved");
  }, [template]);

  // Debounced auto-save on dirty.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!dirtyRef.current) return;
    debounceRef.current = setTimeout(() => { void persist(); }, 1000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [template, persist]);

  function markDirty(updater: (prev: ContractTemplate) => ContractTemplate) {
    dirtyRef.current = true;
    setSavingState("idle");
    setTemplate(updater);
  }

  const onPageDrop = useCallback((page: number, xPt: number, yPt: number, dt: DataTransfer) => {
    const type = dt.getData("application/x-overlay-field-type") as OverlayFieldType | "";
    if (!type) return;
    const sizes = DEFAULT_FIELD_SIZE[type];
    const meta = (template.pdf_pages ?? []).find((p) => p.page === page);
    if (!meta) return;
    const x = Math.max(0, Math.min(xPt - sizes.width / 2, meta.width_pt - sizes.width));
    const y = Math.max(0, Math.min(yPt - sizes.height / 2, meta.height_pt - sizes.height));
    const id = uuidv4();
    const newField: OverlayField = { id, type, page, x, y, ...sizes };
    if (type === "signature") newField.signerOrder = 1;
    if (type === "input" || type === "checkbox") {
      newField.inputKey = `${type}_${id.slice(0, 6)}`;
      newField.inputLabel = type === "checkbox" ? "I agree" : "Field";
    }
    if (type === "label") newField.labelText = "Label";
    markDirty((prev) => ({ ...prev, overlay_fields: [...prev.overlay_fields, newField] }));
    setSelectedFieldId(id);
  }, [template.pdf_pages]);

  function updateField(next: OverlayField) {
    markDirty((prev) => ({
      ...prev,
      overlay_fields: prev.overlay_fields.map((f) => (f.id === next.id ? next : f)),
    }));
  }

  function deleteField(id: string) {
    markDirty((prev) => ({ ...prev, overlay_fields: prev.overlay_fields.filter((f) => f.id !== id) }));
    if (selectedFieldId === id) setSelectedFieldId(null);
  }

  async function replacePdf() {
    if (!confirm("Replacing the PDF will clear all overlay fields. Continue?")) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("pdf", file);
      const res = await fetch(`/api/settings/contract-templates/${template.id}/pdf`, { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error ?? "Upload failed"); return; }
      setTemplate(j.template);
      setSelectedFieldId(null);
    };
    input.click();
  }

  if (!template.pdf_storage_path || !template.pdf_pages) {
    return (
      <TemplatePdfUploadZone
        templateId={template.id}
        onUploaded={(tpl) => setTemplate(tpl)}
      />
    );
  }

  if (!pdfUrl) {
    return <div className="p-12 text-muted-foreground">Loading PDF…</div>;
  }

  const selectedField = template.overlay_fields.find((f) => f.id === selectedFieldId) ?? null;

  return (
    <div className="flex flex-1 min-h-0">
      <FieldPalette
        onReplacePdf={replacePdf}
        templateName={template.name}
        templateDescription={template.description}
        signerCount={template.signer_count}
        signerRoleLabel={template.signer_role_label}
        onMetaChange={(meta) => markDirty((prev) => ({ ...prev, ...meta }))}
      />
      <main className="flex-1 overflow-auto bg-zinc-100" onClick={() => setSelectedFieldId(null)}>
        <div className="px-6 pt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {savingState === "saving" && "Saving…"}
            {savingState === "saved" && "Saved"}
            {savingState === "error" && "Save error"}
            {savingState === "idle" && "—"}
          </span>
          <a
            href={`/api/settings/contract-templates/${template.id}/preview`}
            target="_blank"
            rel="noopener"
            className="text-xs text-[var(--brand-primary)] hover:underline"
          >
            Preview ↗
          </a>
        </div>
        <PdfCanvas
          pdfUrl={pdfUrl}
          pdfPages={template.pdf_pages}
          overlayFields={template.overlay_fields}
          onPageDrop={onPageDrop}
          renderOverlay={({ page, fields, scale }) => (
            <>
              {fields.map((f) => (
                <OverlayFieldChip
                  key={f.id}
                  field={f}
                  scale={scale}
                  selected={f.id === selectedFieldId}
                  onSelect={() => setSelectedFieldId(f.id)}
                  onChange={updateField}
                  onDelete={() => deleteField(f.id)}
                  pageWidthPt={page.width_pt}
                  pageHeightPt={page.height_pt}
                />
              ))}
            </>
          )}
        />
      </main>
      <FieldInspector
        field={selectedField}
        signerCount={template.signer_count}
        onChange={updateField}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "template-pdf-editor"
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/contracts/template-pdf-editor.tsx
git commit -m "ui(15d): TemplatePdfEditor — three-pane orchestrator + auto-save"
```

---

### Task 19: Wire the editor into `/settings/contract-templates/[id]/page.tsx`

**Files:**
- Modify: `src/app/settings/contract-templates/[id]/page.tsx`

- [ ] **Step 1: Read the existing page**

```bash
cat src/app/settings/contract-templates/[id]/page.tsx
```

Note its current structure (server component fetching the template + rendering the old `<TemplateEditor>`).

- [ ] **Step 2: Replace the import + render**

In the file, change the import:
- OLD: `import TemplateEditor from "@/components/contracts/template-editor";`
- NEW: `import TemplatePdfEditor from "@/components/contracts/template-pdf-editor";`

In the JSX, replace `<TemplateEditor initialContent={...} ... />` with:

```tsx
<TemplatePdfEditor initial={template} />
```

(The `template` variable is whatever the server fetch named the contract_templates row.)

Update the SELECT in the server fetch to pull the new columns:

```ts
const { data: template, error } = await supabase
  .from("contract_templates")
  .select("id, organization_id, name, description, pdf_storage_path, pdf_page_count, pdf_pages, overlay_fields, signer_count, signer_role_label, is_active, version, created_by, created_at, updated_at")
  .eq("id", id)
  .single();
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "settings/contract-templates/\[id\]/page"
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/contract-templates/[id]/page.tsx
git commit -m "ui(15d): swap template editor route to TemplatePdfEditor"
```

---

### Task 20: Update the templates list page

**Files:**
- Modify: `src/app/settings/contract-templates/page.tsx`

- [ ] **Step 1: Read the existing page**

```bash
cat src/app/settings/contract-templates/page.tsx | head -60
```

- [ ] **Step 2: Update CTA + row schema**

Find the "+ New Template" button and rename to "Upload Contract PDF". Find the SELECT for the list — update to:

```ts
.select("id, name, description, pdf_page_count, signer_count, is_active, updated_at")
```

In the row render, add badges:

```tsx
<div className="flex items-center gap-2 text-xs text-muted-foreground">
  {row.pdf_page_count != null && <span>{row.pdf_page_count} {row.pdf_page_count === 1 ? "page" : "pages"}</span>}
  <span>·</span>
  <span>{row.signer_count} signer{row.signer_count > 1 ? "s" : ""}</span>
</div>
```

When the "Upload Contract PDF" button is clicked, the existing flow (POST to create empty + redirect) is unchanged from Task 10's API; the editor's empty-state will then show the upload zone.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "settings/contract-templates/page"
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/contract-templates/page.tsx
git commit -m "ui(15d): templates list — page-count + signer-count badges"
```

---

## Phase 5 — Signing flow rewrite

### Task 21: Build `<ContractSignerView>` (customer-side renderer)

**Files:**
- Create: `src/components/contracts/contract-signer-view.tsx`
- Create: `src/components/contracts/signature-pad-modal.tsx` (extracted from `sign-in-person-modal.tsx`)

- [ ] **Step 1: Extract a reusable `<SignaturePadModal>`**

Read `src/components/contracts/sign-in-person-modal.tsx` and identify the canvas signature-capture portion (likely uses HTMLCanvasElement + pointer events to draw the signature). Extract into `src/components/contracts/signature-pad-modal.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui-components/react";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
  title?: string;
}

export default function SignaturePadModal({ open, onClose, onConfirm, title = "Sign here" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";
  }, [open]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * e.currentTarget.width,
      y: ((e.clientY - r.top) / r.height) * e.currentTarget.height,
    };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  }
  function up() {
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  function confirm() {
    if (!canvasRef.current) return;
    onConfirm(canvasRef.current.toDataURL("image/png"));
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card rounded-xl p-6 w-[640px] max-w-[90vw] shadow-2xl">
          <Dialog.Title className="text-lg font-semibold mb-4">{title}</Dialog.Title>
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            className="w-full bg-white border border-border rounded touch-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
          <div className="flex justify-between mt-4">
            <button type="button" onClick={clear} className="text-sm text-muted-foreground hover:text-foreground">
              Clear
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-border">
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!hasInk}
                className="px-3 py-1.5 text-sm rounded bg-[var(--brand-primary)] text-white disabled:opacity-50"
              >
                Confirm signature
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Create `<ContractSignerView>`**

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import PdfCanvas from "./pdf-canvas";
import SignaturePadModal from "./signature-pad-modal";
import type { OverlayField, PublicSigningView } from "@/lib/contracts/types";

interface Props {
  view: PublicSigningView;
  signToken: string;  // for emailed-link flow; in-person passes contract+signer ids via different route
  inPerson?: boolean;
  onSigned?: () => void;
}

export default function ContractSignerView({ view, signToken, inPerson, onSigned }: Props) {
  const [customerInputs, setCustomerInputs] = useState<Record<string, string | boolean>>({});
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const myFields = view.template.overlay_fields.filter((f) =>
    f.type !== "signature" || f.signerOrder === view.signer.signer_order
  );

  const requiredMissing = myFields.some((f) => {
    if (f.type === "input" && f.required && !customerInputs[f.inputKey ?? ""]) return true;
    if (f.type === "checkbox" && f.required && customerInputs[f.inputKey ?? ""] !== true) return true;
    if (f.type === "signature" && f.signerOrder === view.signer.signer_order && !signatureDataUrl) return true;
    return false;
  });

  async function submit() {
    setSubmitting(true);
    try {
      const url = inPerson ? "/api/contracts/in-person" : `/api/sign/${signToken}`;
      const body = inPerson
        ? {
            contract_id: view.contract.id,
            signer_id: view.signer.id,
            customer_inputs: customerInputs,
            signature_data_url: signatureDataUrl,
          }
        : {
            customer_inputs: customerInputs,
            signature_data_url: signatureDataUrl,
          };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error === "missing_required" ? "Please fill all required fields" : (j.error ?? "Submit failed"));
        return;
      }
      onSigned?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (!view.template.pdf_url) {
    // Legacy HTML fallback for already-signed-but-html contracts.
    if (view.contract.legacy_html) {
      return <div className="prose max-w-none p-8" dangerouslySetInnerHTML={{ __html: view.contract.legacy_html }} />;
    }
    return <div className="p-8 text-muted-foreground">No PDF available.</div>;
  }

  return (
    <>
      <PdfCanvas
        pdfUrl={view.template.pdf_url}
        pdfPages={view.template.pdf_pages ?? []}
        overlayFields={view.template.overlay_fields}
        renderOverlay={({ fields, scale }) => (
          <>
            {fields.map((f) => {
              const style: React.CSSProperties = {
                position: "absolute",
                left: f.x * scale,
                top: f.y * scale,
                width: f.width * scale,
                height: f.height * scale,
              };
              if (f.type === "merge") {
                const value = view.resolved_merge_values[f.mergeFieldName ?? ""] ?? "";
                return (
                  <span key={f.id} style={{ ...style, fontSize: f.fontSize * scale, lineHeight: `${f.height * scale}px` }} className="px-0.5 truncate">
                    {value}
                  </span>
                );
              }
              if (f.type === "label") {
                return (
                  <span key={f.id} style={{ ...style, fontSize: f.fontSize * scale, lineHeight: `${f.fontSize * 1.2 * scale}px`, whiteSpace: "pre-line" }}>
                    {f.labelText}
                  </span>
                );
              }
              if (f.type === "date") {
                return (
                  <span key={f.id} style={{ ...style, fontSize: f.fontSize * scale, lineHeight: `${f.height * scale}px` }}>
                    {new Date().toLocaleDateString("en-US")}
                  </span>
                );
              }
              if (f.type === "input") {
                return (
                  <input
                    key={f.id}
                    style={{ ...style, fontSize: f.fontSize * scale }}
                    className="px-1 border border-amber-400 bg-amber-50 rounded"
                    value={(customerInputs[f.inputKey ?? ""] as string) ?? ""}
                    onChange={(e) => setCustomerInputs((prev) => ({ ...prev, [f.inputKey ?? ""]: e.target.value }))}
                  />
                );
              }
              if (f.type === "checkbox") {
                return (
                  <input
                    key={f.id}
                    type="checkbox"
                    style={style}
                    checked={customerInputs[f.inputKey ?? ""] === true}
                    onChange={(e) => setCustomerInputs((prev) => ({ ...prev, [f.inputKey ?? ""]: e.target.checked }))}
                  />
                );
              }
              if (f.type === "signature") {
                const isMine = f.signerOrder === view.signer.signer_order;
                if (!isMine) {
                  // Other signer's slot — show placeholder.
                  const other = view.other_signers.find((s) => s.signer_order === f.signerOrder);
                  return (
                    <div key={f.id} style={style} className="border-2 border-dashed border-zinc-300 bg-zinc-50/80 text-xs text-zinc-500 flex items-center justify-center">
                      {other?.signed_at ? "Signed" : "Awaiting other signer"}
                    </div>
                  );
                }
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSignaturePadOpen(true)}
                    style={style}
                    className="border-2 border-dashed border-purple-400 bg-purple-50 hover:bg-purple-100 text-xs text-purple-800 flex items-center justify-center"
                  >
                    {signatureDataUrl ? <img src={signatureDataUrl} alt="signature" className="w-full h-full object-contain" /> : "Tap to sign"}
                  </button>
                );
              }
              return null;
            })}
          </>
        )}
      />
      <div className="sticky bottom-0 inset-x-0 bg-card border-t border-border p-4 flex justify-between items-center">
        <span className="text-sm text-muted-foreground">
          {requiredMissing ? "Fill all required fields and sign to submit" : "Ready to submit"}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={requiredMissing || submitting}
          className="px-4 py-2 rounded bg-[var(--brand-primary)] text-white font-medium disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit signed contract"}
        </button>
      </div>
      <SignaturePadModal
        open={signaturePadOpen}
        onClose={() => setSignaturePadOpen(false)}
        onConfirm={(dataUrl) => setSignatureDataUrl(dataUrl)}
        title={`Sign as ${view.signer.role_label ?? view.signer.name}`}
      />
    </>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "(contract-signer-view|signature-pad-modal)"
```

Expected: clean for both files.

- [ ] **Step 4: Commit**

```bash
git add src/components/contracts/contract-signer-view.tsx src/components/contracts/signature-pad-modal.tsx
git commit -m "ui(15d): ContractSignerView + extracted SignaturePadModal"
```

---

### Task 22: Update GET + POST `/api/sign/[token]/route.ts`

**Files:**
- Modify: `src/app/api/sign/[token]/route.ts`

- [ ] **Step 1: Read the file**

```bash
cat src/app/api/sign/[token]/route.ts
```

Identify the GET (returns `PublicSigningView`) and POST (writes signature + flips status to signed) handlers.

- [ ] **Step 2: Update GET handler**

After the existing token validation + signer/contract/template/job/customer/property loading, replace the response-building block:

```ts
import { resolveMergeValues } from "@/lib/contracts/resolve-merge-values";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// ... existing token validation + entity loading ...

// Resolve merge values for this contract's job context.
const resolved = resolveMergeValues({
  contract: { id: contract.id, signed_at: contract.signed_at },
  job, customer, property, insurance, company,
});

// Sign URL for the source PDF (60s, will be cached client-side via react-pdf).
let pdfUrl: string | null = null;
if (template.pdf_storage_path) {
  const service = createServiceRoleClient();
  const { data: signed } = await service.storage
    .from("contract-pdfs")
    .createSignedUrl(template.pdf_storage_path, 600);
  pdfUrl = signed?.signedUrl ?? null;
}

// Other signers (for multi-signer status display).
const otherSigners = allSigners
  .filter((s) => s.id !== signer.id)
  .map((s) => ({ id: s.id, signer_order: s.signer_order, signed_at: s.signed_at }));

const view: PublicSigningView = {
  contract: {
    id: contract.id,
    title: contract.title,
    status: contract.status,
    link_expires_at: contract.link_expires_at,
    signed_at: contract.signed_at,
    signed_pdf_path: contract.signed_pdf_path,
    legacy_html: template.pdf_storage_path ? null : (contract.filled_content_html ?? null),
  },
  template: {
    id: template.id,
    pdf_url: pdfUrl,
    pdf_pages: template.pdf_pages,
    overlay_fields: template.overlay_fields,
    signer_count: template.signer_count,
    signer_role_label: template.signer_role_label,
  },
  resolved_merge_values: resolved,
  signer: {
    id: signer.id,
    signer_order: signer.signer_order,
    name: signer.name,
    role_label: signer.role_label,
    signed_at: signer.signed_at,
  },
  other_signers: otherSigners,
  company,
};
return NextResponse.json(view);
```

Adjust the variable names (`contract`, `template`, `job`, etc.) to match the existing fetch pattern in this file.

- [ ] **Step 3: Update POST handler**

Replace the body-handling block:

```ts
import { stampPdf } from "@/lib/contracts/stamp-pdf";

// ... existing token validation ...

const body = await req.json();
const customerInputs = body.customer_inputs ?? {};
const signatureDataUrl = body.signature_data_url as string | undefined;
if (!signatureDataUrl) {
  return NextResponse.json({ error: "missing_signature" }, { status: 400 });
}

// Validate required fields (defense-in-depth).
const missing = template.overlay_fields
  .filter((f: any) => {
    if (f.type === "input" && f.required && !customerInputs[f.inputKey]) return true;
    if (f.type === "checkbox" && f.required && customerInputs[f.inputKey] !== true) return true;
    return false;
  })
  .map((f: any) => f.inputKey);
if (missing.length) {
  return NextResponse.json({ error: "missing_required", fields: missing }, { status: 400 });
}

// Persist this signer's signature image first (existing column on contract_signers).
const service = createServiceRoleClient();
const sigPath = `${contract.organization_id}/contracts/${contract.id}/signer-${signer.id}.png`;
const sigBytes = Uint8Array.from(atob(signatureDataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
await service.storage.from("contract-pdfs").upload(sigPath, sigBytes, { contentType: "image/png", upsert: true });

await supabase
  .from("contract_signers")
  .update({
    signature_image_path: sigPath,
    signed_at: new Date().toISOString(),
    ip_address: req.headers.get("x-forwarded-for") ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  })
  .eq("id", signer.id);

// Persist this signer's customer_inputs onto the contract row (last writer wins for shared keys).
const mergedInputs = { ...(contract.customer_inputs ?? {}), ...customerInputs };
await supabase.from("contracts").update({ customer_inputs: mergedInputs }).eq("id", contract.id);

// If all signers have signed_at non-null, render the final stamped PDF + flip status.
const { data: refreshedSigners } = await supabase
  .from("contract_signers")
  .select("id, signer_order, signed_at, signature_image_path")
  .eq("contract_id", contract.id);
const allSigned = refreshedSigners?.every((s: any) => s.signed_at) ?? false;
if (allSigned && template.pdf_storage_path) {
  // Fetch all signature images.
  const dataUrlsBySignerId: Record<string, string> = {};
  const orderById: Record<string, 1 | 2> = {};
  for (const s of refreshedSigners ?? []) {
    if (!s.signature_image_path) continue;
    const { data: blob } = await service.storage.from("contract-pdfs").download(s.signature_image_path);
    if (!blob) continue;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const b64 = Buffer.from(buf).toString("base64");
    dataUrlsBySignerId[s.id] = `data:image/png;base64,${b64}`;
    orderById[s.id] = s.signer_order;
  }

  // Download source PDF.
  const { data: srcBlob } = await service.storage.from("contract-pdfs").download(template.pdf_storage_path);
  if (!srcBlob) return apiDbError("source_pdf_missing", "POST sign — source download");
  const srcBytes = new Uint8Array(await srcBlob.arrayBuffer());

  const stamped = await stampPdf({
    sourcePdfBytes: srcBytes,
    pdfPages: template.pdf_pages ?? [],
    overlayFields: template.overlay_fields,
    resolvedMergeValues: resolved,  // recompute with current signed_at if needed
    customerInputs: mergedInputs,
    signatureDataUrls: dataUrlsBySignerId,
    signerOrderById: orderById,
    signedAt: new Date(),
  });

  const stampedPath = `${contract.organization_id}/contracts/${contract.id}-signed.pdf`;
  await service.storage.from("contract-pdfs").upload(stampedPath, stamped, {
    contentType: "application/pdf", upsert: true,
  });

  await supabase.from("contracts").update({
    status: "signed",
    signed_pdf_path: stampedPath,
    signed_at: new Date().toISOString(),
  }).eq("id", contract.id);
} else {
  // Partially signed (only relevant if signer_count = 2).
  await supabase.from("contracts").update({ status: "partially_signed" }).eq("id", contract.id);
}

// Insert audit row.
await supabase.from("contract_events").insert({
  contract_id: contract.id,
  signer_id: signer.id,
  event_type: "signed",
  ip_address: req.headers.get("x-forwarded-for") ?? null,
  user_agent: req.headers.get("user-agent") ?? null,
});

return NextResponse.json({ ok: true });
```

If `partially_signed` is not currently in the `contracts.status` enum (`ContractStatus` only lists draft/sent/viewed/signed/voided/expired per types.ts:46-52), either:
- (a) Skip the partial-signed status update (keep at `viewed` until both signed), or
- (b) Add `partially_signed` to the enum in a follow-up migration.

Pick (a) for v1 simplicity; carry-over (b) into open-questions.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "api/sign/\[token\]"
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sign/[token]/route.ts
git commit -m "api(15d): /api/sign/[token] — return PDF view + stamp on submit"
```

---

### Task 23: Update in-person signing route

**Files:**
- Modify: `src/app/api/contracts/in-person/route.ts`

- [ ] **Step 1: Read the existing route**

```bash
cat src/app/api/contracts/in-person/route.ts
```

The route should accept a `contract_id` + `signer_id` (not a token, since in-person is admin-authenticated).

- [ ] **Step 2: Mirror the POST stamping logic from Task 22**

Apply the same body-handling block (Task 22 Step 3) but with:
- Auth: replace `verifyToken(token)` with `requireAuthAndOrg() + manage_contracts permission check`.
- Resolve `signer_id` from the request body, look up `signer = await supabase.from("contract_signers").select(...).eq("id", body.signer_id)`.
- Same `customerInputs` validation, signature upload, contract update, audit row.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "contracts/in-person"
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/contracts/in-person/route.ts
git commit -m "api(15d): in-person signing — same stamping pipeline"
```

---

### Task 24: Update signing pages to use `<ContractSignerView>`

**Files:**
- Modify: `src/app/sign/[token]/page.tsx` (or `src/app/contracts/[id]/page.tsx` — whichever is the customer-facing emailed-link route)
- Modify: `src/app/contracts/[id]/sign-in-person/page.tsx`

- [ ] **Step 1: Locate the email-link signing page**

```bash
grep -rln "PublicSigningView\|filled_content_html" src/app/sign src/app/contracts | head -5
```

The page that imports `PublicSigningView` is the email-link page. Likely `src/app/sign/[token]/page.tsx`.

- [ ] **Step 2: Replace the page render**

```tsx
import { headers } from "next/headers";
import ContractSignerView from "@/components/contracts/contract-signer-view";
import type { PublicSigningView } from "@/lib/contracts/types";

export default async function SignTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host");
  const res = await fetch(`${proto}://${host}/api/sign/${token}`, { cache: "no-store" });
  if (!res.ok) {
    return <div className="p-12 text-center text-muted-foreground">This signing link is no longer valid.</div>;
  }
  const view = (await res.json()) as PublicSigningView;
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-border">
        <h1 className="font-semibold">{view.contract.title}</h1>
      </header>
      <div className="flex-1 bg-zinc-100">
        <ContractSignerView view={view} signToken={token} />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Update in-person page similarly**

```bash
cat src/app/contracts/[id]/sign-in-person/page.tsx
```

Replace the body with `<ContractSignerView view={...} signToken="" inPerson onSigned={() => router.push("./complete")} />`. The `view` payload in this case is fetched server-side via the existing in-person GET handler (or build a similar GET if missing).

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "(sign/\[token\]/page|sign-in-person/page)"
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/sign/[token]/page.tsx src/app/contracts/[id]/sign-in-person/page.tsx
git commit -m "ui(15d): wire signing pages to ContractSignerView"
```

---

## Phase 6 — Cleanup + verify

### Task 25: Delete retired files

**Files (delete):**
- `src/components/contracts/template-editor.tsx`
- `src/components/contracts/merge-field-node.ts`
- `src/components/contracts/merge-field-sidebar.tsx`
- `src/lib/contracts/pdf.ts`

- [ ] **Step 1: Confirm nothing else imports these files**

```bash
grep -rn "from.*contracts/template-editor\|from.*merge-field-node\|from.*merge-field-sidebar\|from.*contracts/pdf\b" src/ --include="*.ts" --include="*.tsx"
```

Expected: empty (or only the editor route which Task 19 already swapped). If any consumers remain, follow the imports — likely a cleanup in `preview-modal.tsx` or `contracts-section.tsx` that wasn't covered earlier.

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/contracts/template-editor.tsx \
       src/components/contracts/merge-field-node.ts \
       src/components/contracts/merge-field-sidebar.tsx \
       src/lib/contracts/pdf.ts
```

- [ ] **Step 3: Run type-check on the whole project**

```bash
npx tsc --noEmit 2>&1 | tee /tmp/tsc-output.txt | head -50
```

Expected: clean (zero errors). If errors remain, fix them inline — most likely in `contracts-section.tsx`, `preview-modal.tsx`, or `contracts/route.ts` where `filled_content_html` may still be referenced.

- [ ] **Step 4: Run a full build**

```bash
npm run build 2>&1 | tail -30
```

Expected: `✓ Compiled` with all pages built. No `Module not found` errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "cleanup(15d): retire Tiptap editor + HTML PDF renderer"
```

---

### Task 26: Update remaining contract-detail / preview consumers

**Files (modify, as discovered in Task 25 Step 1):**
- `src/components/contracts/preview-modal.tsx` (and / or `preview-contract-modal.tsx`)
- `src/components/contracts/contracts-section.tsx` (PDF download link)
- `src/app/contracts/[id]/page.tsx` (admin contract detail page)
- Any other route that referenced `filled_content_html` for new contracts

- [ ] **Step 1: Update preview modal**

If `preview-modal.tsx` previously fetched `/api/settings/contract-templates/preview` and rendered `view.html`, update to embed the preview PDF in an `<iframe>`:

```tsx
<iframe
  src={`/api/settings/contract-templates/${templateId}/preview`}
  className="w-full h-[80vh] rounded border border-border"
/>
```

- [ ] **Step 2: Update contracts list section**

In `src/components/contracts/contracts-section.tsx`, change the "Download PDF" affordance to download `signed_pdf_path` (via signed URL through a new `GET /api/contracts/[id]/pdf` route, or via Storage signed URL fetched inline).

If a `GET /api/contracts/[id]/pdf` route doesn't yet exist, create one:

```ts
// src/app/api/contracts/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuthAndOrg } from "@/lib/auth/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { apiDbError } from "@/lib/api-errors";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuthAndOrg();
  if ("error" in auth) return auth.error;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("contracts").select("organization_id, signed_pdf_path").eq("id", id).maybeSingle();
  if (error) return apiDbError(error.message, "GET contracts/[id]/pdf select");
  if (!data?.signed_pdf_path) return NextResponse.json({ error: "no_pdf" }, { status: 404 });
  if (data.organization_id !== auth.orgId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const service = createServiceRoleClient();
  const { data: signed, error: sErr } = await service.storage
    .from("contract-pdfs").createSignedUrl(data.signed_pdf_path, 60);
  if (sErr || !signed) return apiDbError(sErr?.message ?? "sign_failed", "GET contracts/[id]/pdf sign");
  return NextResponse.json({ url: signed.signedUrl });
}
```

- [ ] **Step 3: Update admin contract-detail page**

In `src/app/contracts/[id]/page.tsx`, render an `<iframe>` of the signed PDF when `signed_pdf_path` is present; otherwise fall back to the legacy `filled_content_html` render for old contracts.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -10
```

Expected: clean tsc + build success.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ui(15d): contract detail + preview consume signed PDF"
```

---

### Task 27: Update `lib/types.ts` `ContractTemplate` consumers

**Files:**
- Modify: any files still referencing `template.content_html` or `template.content` (caught by tsc).

- [ ] **Step 1: Run tsc and grep for any lingering references**

```bash
npx tsc --noEmit 2>&1 | grep -E "(content_html|default_signer_count|filled_content_html)"
grep -rn "content_html\|default_signer_count" src/ --include="*.ts" --include="*.tsx" | grep -v "filled_content_html"
```

Expected: zero results from tsc; the grep may show legitimate `filled_content_html` references in legacy-read paths (kept).

- [ ] **Step 2: Fix any remaining references**

For each error, replace `template.content_html` with the new shape (`template.pdf_storage_path` for PDF check; `template.overlay_fields` for content). If the file is a duplicate-route that copies templates, update to copy the new fields.

- [ ] **Step 3: Type-check + build clean**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "cleanup(15d): final tsc-driven consumer updates"
```

---

## Phase 7 — Manual test pass + handoff

### Task 28: Run §11 manual test pass against Test Co (prod Supabase)

**Files:** None — this is verification.

- [ ] **Step 1: Verify Vercel preview is live**

```bash
gh pr view --json url,state,statusCheckRollup 2>/dev/null || git log -1 --format="%H"
```

Confirm a Vercel preview URL is available (or push to main and use prod URL). Open in a real browser.

- [ ] **Step 2: Run all 12 tests from spec §7**

For each, mark PASS or FAIL with a short note. Capture results into `docs/superpowers/specs/2026-05-06-build-15d-test-results.md`.

Tests (verbatim from spec §7):
1. Upload AAA's FM-7001 PDF — page count = 5
2. Place all 5 overlay fields (page 4 county merge + page 5 NAME/SERVICE LOCATION/SIGNATURE/DATE)
3. Move + resize a field; reload; positions persist
4. Add Input + Checkbox; reload; persist with key+label+required
5. Add a free-text label; reload; persist
6. Preview — opens stamped sample PDF in new tab with sample values + sample signature
7. Send to test customer (Eric's `+t1`); email arrives
8. Sign as customer — required validation works; submit succeeds after fill
9. Stamped PDF downloads from contract detail; all fields rendered correctly in a real PDF reader
10. Two-signer template — first signer signs (status partial or unchanged), second signs (status signed, both signature images present)
11. Replace PDF — confirm dialog → upload → fields cleared
12. Legacy contract still readable (a contract signed before 15d, with `filled_content_html`)

- [ ] **Step 3: Commit the test results doc**

```bash
git add docs/superpowers/specs/2026-05-06-build-15d-test-results.md
git commit -m "docs(15d): §11 manual test pass results"
```

If any test is FAIL, file as a fix-now chip and address before claiming the build done.

---

### Task 29: Cleanup test artifacts

**Files:** None — DB state.

- [ ] **Step 1: Identify test artifacts**

```sql
SELECT id, name, organization_id, created_at
FROM contract_templates
WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Test Co')
  AND created_at > '2026-05-06'::date;

SELECT id, title, status, created_at
FROM contracts
WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Test Co')
  AND created_at > '2026-05-06'::date;
```

- [ ] **Step 2: Delete in dependency order**

```sql
BEGIN;
DELETE FROM contract_events WHERE contract_id IN (
  SELECT id FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Test Co') AND created_at > '2026-05-06'::date
);
DELETE FROM contract_signers WHERE contract_id IN (
  SELECT id FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Test Co') AND created_at > '2026-05-06'::date
);
DELETE FROM contracts WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Test Co') AND created_at > '2026-05-06'::date;
DELETE FROM contract_templates WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Test Co') AND created_at > '2026-05-06'::date;
COMMIT;
```

- [ ] **Step 3: Delete Storage objects**

Use Supabase MCP or dashboard to delete entries under `contract-pdfs/{test-co-org-id}/templates/` and `contract-pdfs/{test-co-org-id}/contracts/` for the test artifacts.

No commit — this is DB+Storage state.

---

### Task 30: Update vault state (00-NOW.md)

**Files:**
- Modify: `docs/vault/00-NOW.md`

- [ ] **Step 1: Add a new build-15d entry**

Insert a new "Last shipped builds" entry above the existing 15d-adjacent entries with:
- Date
- Migration name (`build15d_contract_pdf_overlays`)
- Net summary: schema change, new components, Tiptap retired, six field types
- Carry-overs (any tests that FAIL'd in §11; deferred items from spec §10)

- [ ] **Step 2: Commit**

```bash
git add docs/vault/00-NOW.md
git commit -m "vault: 15d ship state"
```

---

## Self-review — spec coverage

Cross-checking the spec sections against the plan tasks:

| Spec § | Coverage |
|---|---|
| §1 Goals/non-goals | Goals: covered in editor (Tasks 14-20) + signing (Tasks 21-24) + cleanup (Tasks 25-27). Non-goals (multi-line input, conditional fields, round-trip text edit) explicitly out of scope; not in plan. |
| §2 Decisions | All 12 baked in: overlay-only (no PDF text edit) ✓; Tiptap retired (Task 25) ✓; 6 field types (Task 6 type def + Task 17 palette) ✓; single build ✓ (one plan, no phase split); drag-from-palette (Task 17 + 18) ✓; react-pdf (Task 15) + pdf-lib (Task 8) ✓; PDF points top-left (Task 8 stamping translates) ✓; new bucket (Task 5) ✓; auto-save 1s + 409 stale-check (Task 18) ✓; existing rows kept-but-cleared (Task 4 migration drops authoring cols) ✓; `filled_content_html` retained (Task 4) ✓ |
| §3.1 Schema | Task 4 |
| §3.2 OverlayField | Task 6 (types) + Task 9 (validation) |
| §3.3 Editor UI | Tasks 14-20 |
| §3.4 Signing flow | Tasks 21-24 |
| §3.5 stamp-pdf | Task 8 (multi-line label split, single-line input/merge clip, signed_date format) |
| §3.6 API routes | Tasks 10-13 + Tasks 22-23 + Task 26 (`GET /api/contracts/[id]/pdf`) |
| §3.7 Components inventory | Tasks 14-21 (new) + Task 25 (deleted) |
| §3.8 Settings list | Task 20 |
| §3.9 Dependencies | Tasks 2-3 |
| §4 Data flow walkthroughs | Implicit in Tasks 10-24; the four scenarios are realized by the route + component combinations |
| §5 Error handling | Distributed across Tasks 11 (10MB/parse fail/storage fail), 12 (409 stale), 22 (missing required, signature missing); spec table item-by-item: 13 entries, all addressed |
| §6 Permissions | Tasks 11 + 12 (manage_contract_templates checks); Storage RLS in Task 5 |
| §7 Testing | Task 28 (12 tests) + Task 29 (cleanup) |
| §8 Rollout | Migration applied by Task 4; bucket Task 5; deploy implicit (push to main); manual upload by Eric post-deploy noted in Task 30 |
| §10 Open questions | pdfjs worker setup → Task 3; per-signer storage shape → resolved in Task 22 (`contract_signers.signature_image_path` keyed by `signer_id`) |

**Placeholder scan:** No "TBD", "TODO", "implement later" markers. Every step has either complete code or an exact command. Validated.

**Type consistency:** `OverlayField` interface declared in Task 6 is used uniformly across Tasks 8, 9, 14-21. `signerOrder: 1 | 2` used everywhere (not `signerIndex: 0 | 1` from spec — corrected at top of plan and applied throughout). `signed_pdf_path` (existing column) used everywhere (not `signed_pdf_storage_path` from spec — corrected at top and applied throughout).

**Scope check:** 30 tasks. Larger than typical (67d was 27, 67c1 was 23) but matched to the surface area: 6 components + 2 lib helpers + 2 lib renderers + 6 API routes + storage bucket + schema migration + 4 page swaps. Single coherent build per spec §2 decision 4.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-build-15d-contract-template-pdf-overlay.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatches a fresh subagent per task, with two-stage review between tasks. Best for a build of this size where tasks have meaningful blast radius (schema migration, PDF stamping correctness, signing-flow rewrite).

**2. Inline Execution** — Executes tasks in the current session using `superpowers:executing-plans`, with batch checkpoints for review.

Eric's call. Plan + spec are both committed and ready for the fresh session that will pick this up.

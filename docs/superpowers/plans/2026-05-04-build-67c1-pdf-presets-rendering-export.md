# Build 67c1 — PDF Presets, Rendering, Export, xactimate retire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-org PDF preset system, shared `@react-pdf/renderer` rendering, an Export PDF flow on estimates and invoices, and retire the legacy `xactimate_code` column (closes I1 from 67b).

**Architecture:** New `pdf_presets` table with 8 toggle columns + `is_default` per `(org, document_type)`. Server-side renderer in `src/lib/pdf-renderer/` (pure function of `(document, sections, lineItems, preset, company, recipient)`) replaces the existing 67b `invoice-pdf-document.tsx` scaffold and adds estimate support. POST routes load → render via `renderToBuffer` → upload to a new `pdfs` bucket at `${orgId}/${jobNumber}/${docNumber}.pdf` (overwrite each export) → return a 5-minute signed URL. Client modal triggers download via `<a download>`.

**Tech Stack:** Next.js 14+ App Router, Supabase (Postgres + Storage), TypeScript, Tailwind + shadcn/ui, `@react-pdf/renderer` 4.3.3 (already installed). No test framework — verification is `tsc --noEmit` + manual preview + Supabase MCP DB checks.

**Spec:** [`docs/superpowers/specs/2026-05-04-build-67c1-design.md`](../specs/2026-05-04-build-67c1-design.md)

---

## File structure (locked)

### Created
```
src/lib/pdf-renderer/
  styles.ts                              # shared @react-pdf StyleSheet
  types.ts                               # RenderInput discriminated union
  html-to-pdf.tsx                        # HTML string → @react-pdf nodes converter
  render.ts                              # renderToBuffer wrappers (server)
  components/
    page-header.tsx
    company-block.tsx
    recipient-block.tsx
    document-details.tsx
    statement-block.tsx
    sections-table.tsx
    totals-block.tsx
    page-footer.tsx
  estimate-pdf.tsx                       # <Document> for estimates
  invoice-pdf.tsx                        # <Document> for invoices
src/lib/pdf-presets.ts                   # CRUD helpers (DB-facing)
src/lib/sample-pdf-data.ts               # hardcoded sample for preset preview
src/app/api/pdf-presets/route.ts         # GET list, POST create
src/app/api/pdf-presets/[id]/route.ts    # GET, PUT, DELETE
src/app/api/pdf-presets/[id]/preview/route.ts  # GET inline preview PDF
src/app/api/estimates/[id]/pdf/route.ts  # POST → signed URL
src/app/settings/pdf-presets/page.tsx
src/app/settings/pdf-presets/[id]/edit/page.tsx
src/app/settings/pdf-presets/[id]/edit/preset-edit-client.tsx
src/components/export-pdf-modal/index.tsx
supabase/migration-build67c1-pdf-presets-and-bucket.sql
supabase/migration-build67c1-retire-xactimate-code.sql
```

### Modified
```
src/lib/types.ts                         # add PdfPreset interface + DocumentType union
src/lib/storage/paths.ts                 # add estimatePdfPath, invoicePdfPath
src/lib/settings-nav.ts                  # add "PDF Presets" nav entry
src/lib/invoices.ts                      # remove xactimate_code references
src/lib/qb/sync/invoices.ts              # remap or drop xactimate_code references
src/app/api/invoices/[id]/pdf/route.ts   # rewrite as POST → signed URL
src/components/invoices/invoice-read-only-client.tsx  # update Export PDF call site
src/components/invoices/invoice-builder-client.tsx (or wrapper) # add Export PDF button (locate exact file in T19)
src/components/estimate-builder/header-bar.tsx        # add Export PDF button
src/components/estimates/estimate-read-only-client.tsx # add Export PDF button (locate in T19)
```

### Deleted
```
src/lib/invoices/generate-invoice-pdf.tsx     # superseded by src/lib/pdf-renderer/
src/components/invoices/invoice-pdf-document.tsx  # superseded
```

---

## Conventions used by every task

- **TypeScript verify:** `npx tsc --noEmit`. **Expected: 0 errors.** This is the only "test" gate the codebase has.
- **Build verify** (only on tasks that touch many files or change exported types): `npm run build`. **Expected: ✓ Compiled successfully**.
- **Commit format:** `git add <files> && git commit -m "<one-line>"`. Author trailer is added by the wrapping skill, not by this plan.
- **Permissions:** every API route uses `requirePermission` or `requireAnyPermission` from `@/lib/permissions-api`. Active org via `getActiveOrganizationId(supabase)` from `@/lib/supabase/get-active-org`. RLS does final enforcement.
- **Errors at 5xx sites:** `apiError(e, "<METHOD> <route> <op>")` at every catch. Never return raw Postgres error messages.
- **Migrations:** apply via Supabase MCP `apply_migration` tool with name matching the file's stem (e.g., `build67c1_pdf_presets_and_bucket`). Verify post-apply with `execute_sql`.

---

## Phase 1 — Foundation (T1, T2)

### Task 1: Migration — `pdf_presets` table + `pdfs` Storage bucket + path helpers + seed defaults

**Files:**
- Create: `supabase/migration-build67c1-pdf-presets-and-bucket.sql`
- Modify: `src/lib/storage/paths.ts`

- [ ] **Step 1: Verify highest migration number**

```bash
ls supabase/migration-build*.sql | tail -3
```

Expected: confirms there's no `build67c1` file yet. (Per memory, migrations are sequentially named, manual, not idempotent.)

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-build67c1-pdf-presets-and-bucket.sql
-- Build 67c1 — PDF Presets table, pdfs Storage bucket, default-preset seeding.
-- Spec: docs/superpowers/specs/2026-05-04-build-67c1-design.md

-- ============================================================================
-- 1. pdf_presets
-- ============================================================================
CREATE TABLE pdf_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('estimate','invoice')),
  document_title text NOT NULL,
  show_markup boolean NOT NULL DEFAULT true,
  show_discount boolean NOT NULL DEFAULT true,
  show_tax boolean NOT NULL DEFAULT true,
  show_opening_statement boolean NOT NULL DEFAULT true,
  show_closing_statement boolean NOT NULL DEFAULT true,
  show_category_subtotals boolean NOT NULL DEFAULT false,
  show_code_column boolean NOT NULL DEFAULT true,
  show_notes_column boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_presets_org_doctype ON pdf_presets(organization_id, document_type);
CREATE UNIQUE INDEX idx_pdf_presets_org_default
  ON pdf_presets(organization_id, document_type)
  WHERE is_default = true;

ALTER TABLE pdf_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pdf_presets
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_pdf_presets_updated_at
  BEFORE UPDATE ON pdf_presets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 2. pdfs Storage bucket (private; signed URLs only)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdfs', 'pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for the pdfs bucket: org members read/write objects under their org prefix.
-- Service role bypasses RLS; the API routes use service-role for upload to avoid
-- needing per-user grants. SELECT for signed-URL generation also runs as service.
-- Authenticated users CAN read directly via signed URL (signing carries auth).
CREATE POLICY "pdfs_org_members_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'pdfs'
    AND (storage.foldername(name))[1] = nookleus.active_organization_id()::text
  );

-- ============================================================================
-- 3. Seed two default presets (Estimate + Invoice) per existing organization.
-- ============================================================================
INSERT INTO pdf_presets (
  organization_id, name, document_type, document_title, is_default
)
SELECT id, 'Estimate (default)', 'estimate', 'Estimate', true
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM pdf_presets p
  WHERE p.organization_id = organizations.id
    AND p.document_type = 'estimate'
    AND p.is_default = true
);

INSERT INTO pdf_presets (
  organization_id, name, document_type, document_title, is_default
)
SELECT id, 'Invoice (default)', 'invoice', 'Invoice', true
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM pdf_presets p
  WHERE p.organization_id = organizations.id
    AND p.document_type = 'invoice'
    AND p.is_default = true
);
```

- [ ] **Step 3: Add path builders to `src/lib/storage/paths.ts`**

Append at the end of the file (do NOT use replace_all):

```typescript
// estimate / invoice generated PDFs — pdfs bucket, canonical path overwrites on each export.
export function estimatePdfPath(orgId: string, jobNumber: string, estimateNumber: string): string {
  return `${orgId}/${jobNumber}/${estimateNumber}.pdf`;
}
export function invoicePdfPath(orgId: string, jobNumber: string, invoiceNumber: string): string {
  return `${orgId}/${jobNumber}/${invoiceNumber}.pdf`;
}
```

- [ ] **Step 4: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Apply migration via Supabase MCP**

Use `mcp__31d06679-...__apply_migration` with `name: "build67c1_pdf_presets_and_bucket"` and the SQL body. Project: `rzzprgidqbnqcdupmpfe`.

- [ ] **Step 6: Verify migration via Supabase MCP `execute_sql`**

```sql
-- table exists
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'pdf_presets'
ORDER BY ordinal_position;

-- partial unique index exists
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pdf_presets';

-- RLS enabled
SELECT relrowsecurity FROM pg_class WHERE relname = 'pdf_presets';

-- bucket exists
SELECT id, name, public FROM storage.buckets WHERE id = 'pdfs';

-- defaults seeded for both AAA and TestCo
SELECT organization_id, document_type, name, is_default
FROM pdf_presets ORDER BY organization_id, document_type;
```

Expected: 17 columns; partial unique `idx_pdf_presets_org_default` present; `relrowsecurity = true`; bucket `pdfs` row returned; 4 rows total (2 orgs × 2 doc types), all `is_default = true`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migration-build67c1-pdf-presets-and-bucket.sql src/lib/storage/paths.ts
git commit -m "migration(67c1): pdf_presets table + pdfs bucket + path helpers + seed defaults"
```

---

### Task 2: TypeScript types — `PdfPreset`, `DocumentType`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "^export interface ItemLibraryItem" src/lib/types.ts` to find the existing 67a interfaces. Insert the new types just after the `EstimateTemplate` block.

- [ ] **Step 2: Add the types**

```typescript
// ─── PDF presets (Build 67c1) ──────────────────────────────────────────────

export type DocumentType = "estimate" | "invoice";

export interface PdfPreset {
  id: string;
  organization_id: string;
  name: string;
  document_type: DocumentType;
  document_title: string;
  show_markup: boolean;
  show_discount: boolean;
  show_tax: boolean;
  show_opening_statement: boolean;
  show_closing_statement: boolean;
  show_category_subtotals: boolean;
  show_code_column: boolean;
  show_notes_column: boolean;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Subset accepted on POST (server fills the rest).
export type PdfPresetCreatePayload = Pick<
  PdfPreset,
  | "name" | "document_type" | "document_title"
  | "show_markup" | "show_discount" | "show_tax"
  | "show_opening_statement" | "show_closing_statement"
  | "show_category_subtotals" | "show_code_column" | "show_notes_column"
  | "is_default"
>;

// All fields except `name` are optional on PUT (partial update).
export type PdfPresetUpdatePayload = Partial<Omit<PdfPreset,
  "id" | "organization_id" | "created_by" | "created_at" | "updated_at" | "document_type"
>>;
```

- [ ] **Step 3: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "types(67c1): PdfPreset + DocumentType + Create/Update payloads"
```

---

## Phase 2 — API CRUD (T3–T5)

### Task 3: Server utility `src/lib/pdf-presets.ts`

**Files:**
- Create: `src/lib/pdf-presets.ts`

- [ ] **Step 1: Write the helpers**

```typescript
// src/lib/pdf-presets.ts — DB-facing CRUD for pdf_presets.
// All callers must pass an org-scoped supabase client; RLS does final enforcement.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PdfPreset, PdfPresetCreatePayload, PdfPresetUpdatePayload, DocumentType,
} from "@/lib/types";

const TABLE = "pdf_presets";

export async function listPresets(
  supabase: SupabaseClient,
  documentType?: DocumentType,
): Promise<PdfPreset[]> {
  let q = supabase.from(TABLE).select("*").order("name", { ascending: true });
  if (documentType) q = q.eq("document_type", documentType);
  const { data, error } = await q;
  if (error) throw new Error(`list pdf_presets failed: ${error.message}`);
  return (data ?? []) as PdfPreset[];
}

export async function getPreset(supabase: SupabaseClient, id: string): Promise<PdfPreset | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle<PdfPreset>();
  if (error) throw new Error(`get pdf_preset failed: ${error.message}`);
  return data ?? null;
}

export async function getDefaultPreset(
  supabase: SupabaseClient,
  documentType: DocumentType,
): Promise<PdfPreset | null> {
  const { data, error } = await supabase
    .from(TABLE).select("*")
    .eq("document_type", documentType)
    .eq("is_default", true)
    .maybeSingle<PdfPreset>();
  if (error) throw new Error(`get default pdf_preset failed: ${error.message}`);
  return data ?? null;
}

export async function createPreset(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  payload: PdfPresetCreatePayload,
): Promise<PdfPreset> {
  // If is_default=true, atomically clear any existing default for this (org, doc_type).
  if (payload.is_default) {
    const { error: clearErr } = await supabase.from(TABLE)
      .update({ is_default: false })
      .eq("organization_id", orgId)
      .eq("document_type", payload.document_type)
      .eq("is_default", true);
    if (clearErr) throw new Error(`clear default failed: ${clearErr.message}`);
  }
  const { data, error } = await supabase.from(TABLE)
    .insert({ ...payload, organization_id: orgId, created_by: userId })
    .select("*")
    .single<PdfPreset>();
  if (error) throw new Error(`create pdf_preset failed: ${error.message}`);
  return data;
}

export async function updatePreset(
  supabase: SupabaseClient,
  id: string,
  payload: PdfPresetUpdatePayload,
): Promise<PdfPreset> {
  // If flipping is_default → true, clear the prior default for the same (org, doc_type).
  // Read the row first to know which (org, doc_type) we're operating on.
  if (payload.is_default === true) {
    const current = await getPreset(supabase, id);
    if (!current) throw new Error("preset not found");
    const { error: clearErr } = await supabase.from(TABLE)
      .update({ is_default: false })
      .eq("organization_id", current.organization_id)
      .eq("document_type", current.document_type)
      .eq("is_default", true)
      .neq("id", id);
    if (clearErr) throw new Error(`clear default failed: ${clearErr.message}`);
  }
  const { data, error } = await supabase.from(TABLE)
    .update(payload)
    .eq("id", id)
    .select("*")
    .single<PdfPreset>();
  if (error) throw new Error(`update pdf_preset failed: ${error.message}`);
  return data;
}

export async function deletePreset(supabase: SupabaseClient, id: string): Promise<void> {
  // Refuse if is_default. UI hides the button but we double-check at the DB layer.
  const current = await getPreset(supabase, id);
  if (!current) throw new Error("preset not found");
  if (current.is_default) throw new Error("cannot delete default preset");
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`delete pdf_preset failed: ${error.message}`);
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdf-presets.ts
git commit -m "lib(67c1): pdf-presets CRUD helpers (atomic default flip on create + update)"
```

---

### Task 4: Routes `/api/pdf-presets/route.ts` (GET list, POST create)

**Files:**
- Create: `src/app/api/pdf-presets/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/pdf-presets/route.ts — GET list, POST create

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission, requireAnyPermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { listPresets, createPreset } from "@/lib/pdf-presets";
import { apiError } from "@/lib/api-errors";
import type { DocumentType, PdfPresetCreatePayload } from "@/lib/types";

const VALID_DOC_TYPES: DocumentType[] = ["estimate", "invoice"];

function isValidDocType(v: unknown): v is DocumentType {
  return typeof v === "string" && VALID_DOC_TYPES.includes(v as DocumentType);
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requireAnyPermission(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const dtRaw = url.searchParams.get("document_type");
  let documentType: DocumentType | undefined;
  if (dtRaw !== null) {
    if (!isValidDocType(dtRaw)) {
      return NextResponse.json({ error: "document_type must be estimate|invoice" }, { status: 400 });
    }
    documentType = dtRaw;
  }
  try {
    const presets = await listPresets(supabase, documentType);
    return NextResponse.json({ presets });
  } catch (e) {
    return apiError(e, "GET /api/pdf-presets list");
  }
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_pdf_presets");
  if (!auth.ok) return auth.response;

  let body: Partial<PdfPresetCreatePayload>;
  try { body = (await request.json()) as Partial<PdfPresetCreatePayload>; }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }

  // Required string fields
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (typeof body.document_title !== "string" || !body.document_title.trim()) {
    return NextResponse.json({ error: "document_title required" }, { status: 400 });
  }
  if (!isValidDocType(body.document_type)) {
    return NextResponse.json({ error: "document_type must be estimate|invoice" }, { status: 400 });
  }

  const name = body.name.trim();
  if (name.length > 200) return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
  const documentTitle = body.document_title.trim();
  if (documentTitle.length > 200) return NextResponse.json({ error: "document_title too long (max 200)" }, { status: 400 });

  // Boolean fields default to spec defaults if absent.
  const payload: PdfPresetCreatePayload = {
    name,
    document_type: body.document_type,
    document_title: documentTitle,
    show_markup: body.show_markup ?? true,
    show_discount: body.show_discount ?? true,
    show_tax: body.show_tax ?? true,
    show_opening_statement: body.show_opening_statement ?? true,
    show_closing_statement: body.show_closing_statement ?? true,
    show_category_subtotals: body.show_category_subtotals ?? false,
    show_code_column: body.show_code_column ?? true,
    show_notes_column: body.show_notes_column ?? false,
    is_default: body.is_default ?? false,
  };

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  try {
    const preset = await createPreset(supabase, orgId, auth.userId, payload);
    return NextResponse.json({ preset }, { status: 201 });
  } catch (e) {
    return apiError(e, "POST /api/pdf-presets create");
  }
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pdf-presets/route.ts
git commit -m "route(67c1): /api/pdf-presets GET list + POST create with validation"
```

---

### Task 5: Routes `/api/pdf-presets/[id]/route.ts` (GET, PUT, DELETE)

**Files:**
- Create: `src/app/api/pdf-presets/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/pdf-presets/[id]/route.ts — GET, PUT (incl. is_default flip), DELETE

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission, requireAnyPermission } from "@/lib/permissions-api";
import { getPreset, updatePreset, deletePreset } from "@/lib/pdf-presets";
import { apiError } from "@/lib/api-errors";
import type { PdfPresetUpdatePayload } from "@/lib/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requireAnyPermission(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    const preset = await getPreset(supabase, id);
    if (!preset) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ preset });
  } catch (e) {
    return apiError(e, "GET /api/pdf-presets/[id]");
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_pdf_presets");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: PdfPresetUpdatePayload;
  try { body = (await request.json()) as PdfPresetUpdatePayload; }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }

  // Validate strings if present (booleans are TS-checked by the type itself).
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name must be non-empty string" }, { status: 400 });
    }
    if (body.name.length > 200) return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
    body.name = body.name.trim();
  }
  if (body.document_title !== undefined) {
    if (typeof body.document_title !== "string" || !body.document_title.trim()) {
      return NextResponse.json({ error: "document_title must be non-empty string" }, { status: 400 });
    }
    if (body.document_title.length > 200) return NextResponse.json({ error: "document_title too long (max 200)" }, { status: 400 });
    body.document_title = body.document_title.trim();
  }

  try {
    const preset = await updatePreset(supabase, id, body);
    return NextResponse.json({ preset });
  } catch (e) {
    return apiError(e, "PUT /api/pdf-presets/[id]");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_pdf_presets");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    await deletePreset(supabase, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // The "cannot delete default preset" thrown by deletePreset() is a 409.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("cannot delete default preset")) {
      return NextResponse.json({ error: "cannot delete default preset" }, { status: 409 });
    }
    return apiError(e, "DELETE /api/pdf-presets/[id]");
  }
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Manual smoke check via Supabase MCP `execute_sql`**

```sql
-- Find one preset id
SELECT id, name, is_default FROM pdf_presets WHERE document_type='estimate' LIMIT 1;
```

Hand-test by hitting the routes via the running dev server (skip if not yet running; T7's UI will exercise them).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pdf-presets/[id]/route.ts
git commit -m "route(67c1): /api/pdf-presets/[id] GET/PUT/DELETE with default-guard 409"
```

---

## Phase 3 — Settings nav + Manager page (T6, T7)

### Task 6: Add "PDF Presets" entry to settings nav

**Files:**
- Modify: `src/lib/settings-nav.ts`

- [ ] **Step 1: Insert nav entry after Estimate Templates (line 39 currently)**

Use Edit:
```
old_string: { href: "/settings/estimate-templates", label: "Estimate Templates", icon: LayoutTemplate },
new_string: { href: "/settings/estimate-templates", label: "Estimate Templates", icon: LayoutTemplate },
  { href: "/settings/pdf-presets", label: "PDF Presets", icon: FileText },
```

(The `FileText` icon is already imported at the top of the file — verify by grepping `FileText` in settings-nav.ts before adding the line. If it's already used by another entry, no new import needed.)

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-nav.ts
git commit -m "nav(67c1): add PDF Presets entry to settings nav"
```

---

### Task 7: Preset Manager page `/settings/pdf-presets`

**Files:**
- Create: `src/app/settings/pdf-presets/page.tsx`
- Create: `src/app/settings/pdf-presets/preset-list-client.tsx`

- [ ] **Step 1: Write the server page**

```typescript
// src/app/settings/pdf-presets/page.tsx
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { listPresets } from "@/lib/pdf-presets";
import { redirect } from "next/navigation";
import PresetListClient from "./preset-list-client";

export const dynamic = "force-dynamic";

export default async function PdfPresetsSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const presets = await listPresets(supabase);
  return <PresetListClient initialPresets={presets} />;
}
```

- [ ] **Step 2: Write the client list component**

```typescript
// src/app/settings/pdf-presets/preset-list-client.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PdfPreset, DocumentType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Props { initialPresets: PdfPreset[]; }

const TABS: { value: DocumentType; label: string }[] = [
  { value: "estimate", label: "Estimate Presets" },
  { value: "invoice", label: "Invoice Presets" },
];

export default function PresetListClient({ initialPresets }: Props) {
  const [presets, setPresets] = useState<PdfPreset[]>(initialPresets);
  const [tab, setTab] = useState<DocumentType>("estimate");
  const router = useRouter();
  const { toast } = useToast();

  const filtered = presets.filter((p) => p.document_type === tab);

  async function handleNew() {
    const res = await fetch("/api/pdf-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Preset",
        document_type: tab,
        document_title: tab === "estimate" ? "Estimate" : "Invoice",
      }),
    });
    if (!res.ok) {
      toast({ title: "Could not create preset", variant: "destructive" });
      return;
    }
    const { preset } = (await res.json()) as { preset: PdfPreset };
    router.push(`/settings/pdf-presets/${preset.id}/edit`);
  }

  async function handleDelete(p: PdfPreset) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    const res = await fetch(`/api/pdf-presets/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: j.error ?? "Delete failed", variant: "destructive" });
      return;
    }
    setPresets((prev) => prev.filter((x) => x.id !== p.id));
    toast({ title: "Preset deleted" });
  }

  async function handleSetDefault(p: PdfPreset) {
    const res = await fetch(`/api/pdf-presets/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    if (!res.ok) {
      toast({ title: "Could not set default", variant: "destructive" });
      return;
    }
    // Local recompute: clear is_default on others of same doc_type, set on this.
    setPresets((prev) =>
      prev.map((x) => {
        if (x.document_type !== p.document_type) return x;
        return { ...x, is_default: x.id === p.id };
      }),
    );
    toast({ title: "Default updated" });
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">PDF Presets</h1>
        <Button onClick={handleNew}>+ New Preset</Button>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 ${
              tab === t.value
                ? "border-b-2 border-primary font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No presets yet for this type.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded border p-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.is_default && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-0.5">{p.document_title}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/settings/pdf-presets/${p.id}/edit`}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
                {!p.is_default && (
                  <Button variant="outline" size="sm" onClick={() => handleSetDefault(p)}>
                    Set as default
                  </Button>
                )}
                {!p.is_default && (
                  <Button variant="outline" size="sm" onClick={() => handleDelete(p)}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Manual verify (preview)**

Start dev server if not running. Navigate to `/settings/pdf-presets`:
- Both tabs render
- Each tab shows the seeded default preset with "Default" badge
- Delete + Set-as-default buttons hidden on default preset
- "+ New Preset" creates a row and navigates to editor (which is 404 until T8)

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/pdf-presets/page.tsx src/app/settings/pdf-presets/preset-list-client.tsx
git commit -m "ui(67c1): PDF Preset Manager page (tabs + cards + create/delete/set-default)"
```

---

## Phase 4 — Editor (T8)

### Task 8: Preset Editor page `/settings/pdf-presets/[id]/edit`

**Files:**
- Create: `src/app/settings/pdf-presets/[id]/edit/page.tsx`
- Create: `src/app/settings/pdf-presets/[id]/edit/preset-edit-client.tsx`

- [ ] **Step 1: Write the server page**

```typescript
// src/app/settings/pdf-presets/[id]/edit/page.tsx
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getPreset } from "@/lib/pdf-presets";
import { notFound, redirect } from "next/navigation";
import PresetEditClient from "./preset-edit-client";

export const dynamic = "force-dynamic";

export default async function PdfPresetEditPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const preset = await getPreset(supabase, id);
  if (!preset) notFound();
  return <PresetEditClient initial={preset} />;
}
```

- [ ] **Step 2: Write the editor client**

```typescript
// src/app/settings/pdf-presets/[id]/edit/preset-edit-client.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PdfPreset } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

interface Props { initial: PdfPreset; }

const TOGGLES: { key: keyof PdfPreset; label: string; help?: string }[] = [
  { key: "show_markup", label: "Show markup row in totals" },
  { key: "show_discount", label: "Show discount row in totals" },
  { key: "show_tax", label: "Show tax row in totals" },
  { key: "show_opening_statement", label: "Show opening statement" },
  { key: "show_closing_statement", label: "Show closing statement" },
  { key: "show_category_subtotals", label: "Show per-section subtotals", help: "Adds a subtotal row at the end of each section" },
  { key: "show_code_column", label: "Show Code column" },
  { key: "show_notes_column", label: "Show Notes column", help: "Currently always empty — placeholder for future per-line-item notes" },
];

export default function PresetEditClient({ initial }: Props) {
  const [preset, setPreset] = useState<PdfPreset>(initial);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  function setField<K extends keyof PdfPreset>(key: K, value: PdfPreset[K]) {
    setPreset((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/pdf-presets/${preset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: preset.name,
        document_title: preset.document_title,
        is_default: preset.is_default,
        show_markup: preset.show_markup,
        show_discount: preset.show_discount,
        show_tax: preset.show_tax,
        show_opening_statement: preset.show_opening_statement,
        show_closing_statement: preset.show_closing_statement,
        show_category_subtotals: preset.show_category_subtotals,
        show_code_column: preset.show_code_column,
        show_notes_column: preset.show_notes_column,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: j.error ?? "Save failed", variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    router.refresh();
  }

  function handlePreview() {
    window.open(`/api/pdf-presets/${preset.id}/preview`, "_blank");
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-4">
        <Link href="/settings/pdf-presets" className="text-sm text-muted-foreground hover:underline">
          ← Back to PDF Presets
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-6">Edit Preset</h1>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Preset Name</Label>
          <Input
            id="name"
            value={preset.name}
            onChange={(e) => setField("name", e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <Label htmlFor="document_title">Document Title (large header text on PDF)</Label>
          <Input
            id="document_title"
            value={preset.document_title}
            onChange={(e) => setField("document_title", e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="is_default"
            checked={preset.is_default}
            onCheckedChange={(v) => setField("is_default", v)}
          />
          <Label htmlFor="is_default" className="cursor-pointer">
            Set as default {preset.document_type} preset
          </Label>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-medium mb-3">Display options</h2>
        <div className="space-y-3">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-start gap-3">
              <Switch
                id={t.key as string}
                checked={Boolean(preset[t.key])}
                onCheckedChange={(v) => setField(t.key, v as PdfPreset[typeof t.key])}
              />
              <div>
                <Label htmlFor={t.key as string} className="cursor-pointer">{t.label}</Label>
                {t.help && <p className="text-xs text-muted-foreground mt-0.5">{t.help}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" onClick={handlePreview}>
          Preview sample PDF
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Manual verify**

Navigate to `/settings/pdf-presets` → click Edit on default preset:
- Form populates with current values
- All 8 toggles render
- Save button persists; toast appears; refresh confirms persistence
- Preview button opens new tab to `/api/pdf-presets/[id]/preview` (will 404 until T15)

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/pdf-presets/[id]/edit/
git commit -m "ui(67c1): PDF Preset editor page (single-column form, 8 toggles, explicit Save)"
```

---

## Phase 5 — Renderer (T9–T14)

### Task 9: Renderer foundation — `styles.ts`, `types.ts`, `html-to-pdf.tsx`

**Files:**
- Create: `src/lib/pdf-renderer/styles.ts`
- Create: `src/lib/pdf-renderer/types.ts`
- Create: `src/lib/pdf-renderer/html-to-pdf.tsx`

- [ ] **Step 1: Write `styles.ts`**

```typescript
// src/lib/pdf-renderer/styles.ts — shared @react-pdf StyleSheet for estimate + invoice PDFs.

import { StyleSheet } from "@react-pdf/renderer";

export const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  // Header
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  docTitle: { fontSize: 22, fontWeight: "bold" },
  logo: { width: 80, height: 40, objectFit: "contain" },
  // Two-column rows
  twoCol: { flexDirection: "row", gap: 24, marginBottom: 16 },
  col: { flex: 1 },
  // Common typography
  h: { fontWeight: "bold", fontSize: 11, marginBottom: 4 },
  muted: { color: "#666", fontSize: 9 },
  // Document details row
  detailsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderTop: "1 solid #e5e5e5",
    borderBottom: "1 solid #e5e5e5",
  },
  detailItem: { flexDirection: "column", marginRight: 16 },
  detailLabel: { color: "#666", fontSize: 8, textTransform: "uppercase" },
  detailValue: { fontSize: 10 },
  // Sections table
  table: { marginTop: 8 },
  sectionHeader: {
    fontWeight: "bold",
    fontSize: 11,
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#f3f4f6",
  },
  subsectionHeader: {
    fontWeight: "bold",
    fontSize: 9,
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 12,
    color: "#444",
  },
  thRow: {
    flexDirection: "row",
    paddingVertical: 6,
    backgroundColor: "#f9fafb",
    borderBottom: "1 solid #e5e7eb",
  },
  tr: { flexDirection: "row", borderBottom: "1 solid #f3f4f6", paddingVertical: 6 },
  tdCode: { width: 60, paddingHorizontal: 6 },
  tdDesc: { flex: 3, paddingHorizontal: 6 },
  tdQty: { width: 50, paddingHorizontal: 6, textAlign: "right" },
  tdUnit: { width: 50, paddingHorizontal: 6, textAlign: "left" },
  tdPrice: { width: 70, paddingHorizontal: 6, textAlign: "right" },
  tdTotal: { width: 80, paddingHorizontal: 6, textAlign: "right" },
  tdNotes: { flex: 1, paddingHorizontal: 6, fontSize: 8, color: "#6b7280" },
  sectionSubtotal: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 4,
    paddingRight: 6,
    fontSize: 9,
    fontStyle: "italic",
  },
  // Totals
  totalsBlock: { marginTop: 16, alignItems: "flex-end" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingVertical: 3,
  },
  totalsRowBold: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingTop: 6,
    paddingBottom: 3,
    borderTop: "1 solid #1a1a1a",
    fontWeight: "bold",
    fontSize: 12,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#9ca3af",
  },
  // Statement (HTML rendered)
  statementBlock: { marginTop: 12, marginBottom: 12 },
});
```

- [ ] **Step 2: Write `types.ts`**

```typescript
// src/lib/pdf-renderer/types.ts — typed inputs for the renderer.

import type {
  PdfPreset, Estimate, Invoice, EstimateSection, EstimateLineItem,
  InvoiceSection, InvoiceLineItem,
} from "@/lib/types";

export interface PdfCompany {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
}

export interface PdfRecipient {
  name: string;
  email: string | null;
  phone: string | null;
  property_address: string | null;
}

// Discriminated union — orchestrators pick the right path based on .kind.
export type RenderInput =
  | {
      kind: "estimate";
      document: Estimate;
      sections: EstimateSection[];
      lineItems: EstimateLineItem[];
      preset: PdfPreset;
      company: PdfCompany;
      recipient: PdfRecipient;
      jobNumber: string;
    }
  | {
      kind: "invoice";
      document: Invoice;
      sections: InvoiceSection[];
      lineItems: InvoiceLineItem[];
      preset: PdfPreset;
      company: PdfCompany;
      recipient: PdfRecipient;
      jobNumber: string;
    };
```

- [ ] **Step 3: Write `html-to-pdf.tsx`**

```typescript
// src/lib/pdf-renderer/html-to-pdf.tsx — minimal HTML → @react-pdf converter.
// Statements (estimate/invoice opening + closing) are stored as HTML strings by
// the Tiptap editor in src/components/estimate-builder/statement-editor.tsx. We
// only support the subset the editor produces: <p>, <strong>/<b>, <em>/<i>,
// <ul>, <ol>, <li>, <br>. Image nodes are stripped (out of scope for v1).

import { Text, View } from "@react-pdf/renderer";
import { JSX } from "react";

interface Run { text: string; bold?: boolean; italic?: boolean; }

// Tokenize a fragment of HTML into plain runs. Naive parser sufficient for the
// editor's output; not a general HTML parser.
function tokenize(html: string): Run[] {
  const runs: Run[] = [];
  const re = /<\/?(strong|b|em|i)>|([^<]+)/gi;
  let bold = false;
  let italic = false;
  for (const m of html.matchAll(re)) {
    const tag = m[1];
    const text = m[2];
    if (tag) {
      const isClose = m[0].startsWith("</");
      const t = tag.toLowerCase();
      if (t === "strong" || t === "b") bold = !isClose;
      else if (t === "em" || t === "i") italic = !isClose;
    } else if (text) {
      const decoded = text
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      if (decoded.length > 0) runs.push({ text: decoded, bold, italic });
    }
  }
  return runs;
}

function renderRuns(runs: Run[], keyPrefix: string): JSX.Element[] {
  return runs.map((r, i) => {
    const style: { fontWeight?: "bold"; fontStyle?: "italic" } = {};
    if (r.bold) style.fontWeight = "bold";
    if (r.italic) style.fontStyle = "italic";
    return <Text key={`${keyPrefix}-r${i}`} style={style}>{r.text}</Text>;
  });
}

// Splits the HTML into block-level chunks (<p>, <ul>, <ol>, top-level text).
// Returns an array of <View> / <Text> nodes. Empty / whitespace-only string
// returns an empty array.
export function htmlToPdfNodes(html: string | null | undefined): JSX.Element[] {
  if (!html) return [];
  // Strip images outright.
  const cleaned = html.replace(/<img[^>]*>/gi, "");
  // Match top-level blocks. Anything not inside a block becomes a paragraph.
  const blockRe = /<(p|ul|ol)>([\s\S]*?)<\/\1>|([^<]+)/gi;
  const out: JSX.Element[] = [];
  let i = 0;
  for (const m of cleaned.matchAll(blockRe)) {
    const tag = m[1]?.toLowerCase();
    const inner = m[2];
    const stray = m[3]?.trim();
    if (tag === "p") {
      const runs = tokenize(inner);
      if (runs.length > 0) {
        out.push(<Text key={`p-${i}`} style={{ marginBottom: 4 }}>{renderRuns(runs, `p-${i}`)}</Text>);
      }
    } else if (tag === "ul" || tag === "ol") {
      const items: JSX.Element[] = [];
      let li = 0;
      const liRe = /<li>([\s\S]*?)<\/li>/gi;
      for (const liM of inner.matchAll(liRe)) {
        const runs = tokenize(liM[1]);
        const bullet = tag === "ul" ? "• " : `${li + 1}. `;
        items.push(
          <View key={`l-${i}-${li}`} style={{ flexDirection: "row", marginBottom: 2 }}>
            <Text style={{ width: 16 }}>{bullet}</Text>
            <Text style={{ flex: 1 }}>{renderRuns(runs, `l-${i}-${li}`)}</Text>
          </View>,
        );
        li += 1;
      }
      out.push(<View key={`list-${i}`}>{items}</View>);
    } else if (stray) {
      const runs = tokenize(stray);
      if (runs.length > 0) {
        out.push(<Text key={`s-${i}`} style={{ marginBottom: 4 }}>{renderRuns(runs, `s-${i}`)}</Text>);
      }
    }
    i += 1;
  }
  return out;
}
```

- [ ] **Step 4: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf-renderer/styles.ts src/lib/pdf-renderer/types.ts src/lib/pdf-renderer/html-to-pdf.tsx
git commit -m "renderer(67c1): foundation — styles, types, html-to-pdf converter"
```

---

### Task 10: Atomic components — page-header, company-block, recipient-block, document-details, page-footer

**Files:**
- Create: `src/lib/pdf-renderer/components/page-header.tsx`
- Create: `src/lib/pdf-renderer/components/company-block.tsx`
- Create: `src/lib/pdf-renderer/components/recipient-block.tsx`
- Create: `src/lib/pdf-renderer/components/document-details.tsx`
- Create: `src/lib/pdf-renderer/components/page-footer.tsx`

- [ ] **Step 1: page-header.tsx**

```typescript
import { View, Text, Image } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";

interface Props { documentTitle: string; logoUrl: string | null; }

export function PageHeader({ documentTitle, logoUrl }: Props) {
  return (
    <View style={styles.header}>
      <Text style={styles.docTitle}>{documentTitle}</Text>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
    </View>
  );
}
```

- [ ] **Step 2: company-block.tsx**

```typescript
import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { PdfCompany } from "@/lib/pdf-renderer/types";

interface Props { company: PdfCompany; }

export function CompanyBlock({ company }: Props) {
  return (
    <View style={styles.col}>
      <Text style={styles.h}>From</Text>
      {company.name ? <Text>{company.name}</Text> : null}
      {company.address ? <Text style={styles.muted}>{company.address}</Text> : null}
      {company.phone ? <Text style={styles.muted}>{company.phone}</Text> : null}
      {company.email ? <Text style={styles.muted}>{company.email}</Text> : null}
    </View>
  );
}
```

- [ ] **Step 3: recipient-block.tsx**

```typescript
import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { PdfRecipient } from "@/lib/pdf-renderer/types";

interface Props { recipient: PdfRecipient; }

export function RecipientBlock({ recipient }: Props) {
  return (
    <View style={styles.col}>
      <Text style={styles.h}>To</Text>
      <Text>{recipient.name}</Text>
      {recipient.property_address ? (
        <Text style={styles.muted}>{recipient.property_address}</Text>
      ) : null}
      {recipient.phone ? <Text style={styles.muted}>{recipient.phone}</Text> : null}
      {recipient.email ? <Text style={styles.muted}>{recipient.email}</Text> : null}
    </View>
  );
}
```

- [ ] **Step 4: document-details.tsx**

```typescript
import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { Estimate, Invoice } from "@/lib/types";

type Doc = Estimate | Invoice;

interface Props { document: Doc; kind: "estimate" | "invoice"; }

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  // Normalize an ISO YYYY-MM-DD or full timestamp into a short date.
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function DocumentDetails({ document: doc, kind }: Props) {
  const number = kind === "estimate"
    ? (doc as Estimate).estimate_number
    : (doc as Invoice).invoice_number;
  const issued = doc.issued_date;
  const dateLabel = kind === "estimate" ? "Valid Until" : "Due Date";
  const dateValue = kind === "estimate"
    ? (doc as Estimate).valid_until
    : (doc as Invoice).due_date;
  return (
    <View style={styles.detailsRow}>
      <View style={styles.detailItem}>
        <Text style={styles.detailLabel}>{kind === "estimate" ? "Estimate #" : "Invoice #"}</Text>
        <Text style={styles.detailValue}>{number}</Text>
      </View>
      <View style={styles.detailItem}>
        <Text style={styles.detailLabel}>Issued</Text>
        <Text style={styles.detailValue}>{formatDate(issued)}</Text>
      </View>
      {dateValue ? (
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{dateLabel}</Text>
          <Text style={styles.detailValue}>{formatDate(dateValue)}</Text>
        </View>
      ) : null}
      <View style={styles.detailItem}>
        <Text style={styles.detailLabel}>Status</Text>
        <Text style={styles.detailValue}>{doc.status}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 5: page-footer.tsx**

```typescript
import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";

interface Props { jobNumber: string; }

export function PageFooter({ jobNumber }: Props) {
  return (
    <View style={styles.footer} fixed>
      <Text>Job {jobNumber}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}
```

- [ ] **Step 6: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pdf-renderer/components/page-header.tsx \
        src/lib/pdf-renderer/components/company-block.tsx \
        src/lib/pdf-renderer/components/recipient-block.tsx \
        src/lib/pdf-renderer/components/document-details.tsx \
        src/lib/pdf-renderer/components/page-footer.tsx
git commit -m "renderer(67c1): atomic components — header, company, recipient, details, footer"
```

---

### Task 11: Statement block (uses html-to-pdf)

**Files:**
- Create: `src/lib/pdf-renderer/components/statement-block.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { View } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import { htmlToPdfNodes } from "@/lib/pdf-renderer/html-to-pdf";

interface Props { html: string | null | undefined; }

export function StatementBlock({ html }: Props) {
  const nodes = htmlToPdfNodes(html);
  if (nodes.length === 0) return null;
  return <View style={styles.statementBlock}>{nodes}</View>;
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdf-renderer/components/statement-block.tsx
git commit -m "renderer(67c1): statement block (HTML → @react-pdf nodes)"
```

---

### Task 12: Sections table

**Files:**
- Create: `src/lib/pdf-renderer/components/sections-table.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/lib/pdf-renderer/components/sections-table.tsx
// Renders the hierarchical sections + subsections + line items for both estimates and invoices.
// Pure function of (sections, lineItems, preset) — no DB access.

import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type {
  PdfPreset, EstimateSection, EstimateLineItem, InvoiceSection, InvoiceLineItem,
} from "@/lib/types";

type Section = EstimateSection | InvoiceSection;
type LineItem = EstimateLineItem | InvoiceLineItem;

interface Props {
  sections: Section[];
  lineItems: LineItem[];
  preset: PdfPreset;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// Build {parentId | null → children} map; sections without a parent_section_id are top-level.
function groupSections(all: Section[]): { tops: Section[]; childrenOf: Map<string, Section[]> } {
  const tops: Section[] = [];
  const childrenOf = new Map<string, Section[]>();
  for (const s of all.slice().sort((a, b) => a.sort_order - b.sort_order)) {
    if (s.parent_section_id) {
      const list = childrenOf.get(s.parent_section_id) ?? [];
      list.push(s);
      childrenOf.set(s.parent_section_id, list);
    } else {
      tops.push(s);
    }
  }
  return { tops, childrenOf };
}

function itemsForSection(items: LineItem[], sectionId: string): LineItem[] {
  return items.filter((i) => i.section_id === sectionId).slice().sort((a, b) => a.sort_order - b.sort_order);
}

function sectionSubtotal(items: LineItem[]): number {
  return items.reduce((s, i) => s + Number(i.total ?? Number(i.quantity) * Number(i.unit_price)), 0);
}

export function SectionsTable({ sections, lineItems, preset }: Props) {
  const { tops, childrenOf } = groupSections(sections);

  function renderItemRow(item: LineItem, key: string) {
    const total = Number(item.total ?? Number(item.quantity) * Number(item.unit_price));
    return (
      <View key={key} style={styles.tr} wrap={false}>
        {preset.show_code_column && <Text style={styles.tdCode}>{item.code ?? ""}</Text>}
        <Text style={styles.tdDesc}>{item.description}</Text>
        <Text style={styles.tdQty}>{Number(item.quantity)}</Text>
        <Text style={styles.tdUnit}>{item.unit ?? ""}</Text>
        <Text style={styles.tdPrice}>{fmt(Number(item.unit_price))}</Text>
        <Text style={styles.tdTotal}>{fmt(total)}</Text>
        {preset.show_notes_column && <Text style={styles.tdNotes}>{/* always empty for v1 */}</Text>}
      </View>
    );
  }

  function renderSection(section: Section, depth: number, sectionKey: string) {
    const directItems = itemsForSection(lineItems, section.id);
    const subs = (childrenOf.get(section.id) ?? []);
    const subItems = subs.flatMap((s) => itemsForSection(lineItems, s.id));
    const sectionTotal = sectionSubtotal([...directItems, ...subItems]);

    return (
      <View key={sectionKey}>
        <View style={depth === 0 ? styles.sectionHeader : styles.subsectionHeader} wrap={false}>
          <Text>{section.title}</Text>
        </View>
        {directItems.map((it, i) => renderItemRow(it, `${sectionKey}-it-${i}`))}
        {subs.map((sub, i) => renderSection(sub, depth + 1, `${sectionKey}-sub-${i}`))}
        {preset.show_category_subtotals && depth === 0 && (
          <View style={styles.sectionSubtotal} wrap={false}>
            <Text>Section subtotal: {fmt(sectionTotal)}</Text>
          </View>
        )}
      </View>
    );
  }

  if (tops.length === 0) return null;

  return (
    <View style={styles.table}>
      {/* Header row */}
      <View style={styles.thRow} wrap={false}>
        {preset.show_code_column && <Text style={styles.tdCode}>Code</Text>}
        <Text style={styles.tdDesc}>Description</Text>
        <Text style={styles.tdQty}>Qty</Text>
        <Text style={styles.tdUnit}>Unit</Text>
        <Text style={styles.tdPrice}>Unit Cost</Text>
        <Text style={styles.tdTotal}>Total</Text>
        {preset.show_notes_column && <Text style={styles.tdNotes}>Notes</Text>}
      </View>
      {tops.map((s, i) => renderSection(s, 0, `t-${i}`))}
    </View>
  );
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdf-renderer/components/sections-table.tsx
git commit -m "renderer(67c1): sections-table with toggle-gated columns + category subtotals"
```

---

### Task 13: Totals block

**Files:**
- Create: `src/lib/pdf-renderer/components/totals-block.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/lib/pdf-renderer/components/totals-block.tsx
// Right-aligned totals. Toggle-gated rows; non-zero gate on markup/discount.

import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { PdfPreset, Estimate, Invoice } from "@/lib/types";

interface Props {
  document: Estimate | Invoice;
  preset: PdfPreset;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function TotalsBlock({ document: doc, preset }: Props) {
  const subtotal = Number(doc.subtotal);
  const markupAmt = Number(doc.markup_amount);
  const discountAmt = Number(doc.discount_amount);
  const adjusted = Number(doc.adjusted_subtotal);
  const taxRate = Number(doc.tax_rate);
  const taxAmt = Number(doc.tax_amount);
  // total: estimates store as `total`; invoices as `total_amount`
  const total = Number(("total" in doc ? doc.total : (doc as Invoice).total_amount));

  return (
    <View style={styles.totalsBlock}>
      <View style={styles.totalsRow}>
        <Text>Subtotal</Text>
        <Text>{fmt(subtotal)}</Text>
      </View>
      {preset.show_markup && markupAmt !== 0 && (
        <View style={styles.totalsRow}>
          <Text>Markup</Text>
          <Text>{fmt(markupAmt)}</Text>
        </View>
      )}
      {preset.show_discount && discountAmt !== 0 && (
        <View style={styles.totalsRow}>
          <Text>Discount</Text>
          <Text>−{fmt(Math.abs(discountAmt))}</Text>
        </View>
      )}
      {(preset.show_markup && markupAmt !== 0) || (preset.show_discount && discountAmt !== 0) ? (
        <View style={styles.totalsRow}>
          <Text>Adjusted Subtotal</Text>
          <Text>{fmt(adjusted)}</Text>
        </View>
      ) : null}
      {preset.show_tax && (
        <View style={styles.totalsRow}>
          <Text>Tax ({taxRate.toFixed(2)}%)</Text>
          <Text>{fmt(taxAmt)}</Text>
        </View>
      )}
      <View style={styles.totalsRowBold}>
        <Text>Total</Text>
        <Text>{fmt(total)}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdf-renderer/components/totals-block.tsx
git commit -m "renderer(67c1): totals-block with toggle gates + non-zero gates on markup/discount"
```

---

### Task 14: Orchestrators (`estimate-pdf.tsx`, `invoice-pdf.tsx`) + `render.ts`

**Files:**
- Create: `src/lib/pdf-renderer/estimate-pdf.tsx`
- Create: `src/lib/pdf-renderer/invoice-pdf.tsx`
- Create: `src/lib/pdf-renderer/render.ts`

- [ ] **Step 1: estimate-pdf.tsx**

```typescript
// src/lib/pdf-renderer/estimate-pdf.tsx
import { Document, Page, View } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import { PageHeader } from "@/lib/pdf-renderer/components/page-header";
import { CompanyBlock } from "@/lib/pdf-renderer/components/company-block";
import { RecipientBlock } from "@/lib/pdf-renderer/components/recipient-block";
import { DocumentDetails } from "@/lib/pdf-renderer/components/document-details";
import { StatementBlock } from "@/lib/pdf-renderer/components/statement-block";
import { SectionsTable } from "@/lib/pdf-renderer/components/sections-table";
import { TotalsBlock } from "@/lib/pdf-renderer/components/totals-block";
import { PageFooter } from "@/lib/pdf-renderer/components/page-footer";
import type { RenderInput } from "@/lib/pdf-renderer/types";

type Input = Extract<RenderInput, { kind: "estimate" }>;

export function EstimatePdf(input: Input) {
  const { document, sections, lineItems, preset, company, recipient, jobNumber } = input;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PageHeader documentTitle={preset.document_title} logoUrl={company.logo_url} />
        <View style={styles.twoCol}>
          <CompanyBlock company={company} />
          <RecipientBlock recipient={recipient} />
        </View>
        <DocumentDetails document={document} kind="estimate" />
        {preset.show_opening_statement && (
          <StatementBlock html={document.opening_statement} />
        )}
        <SectionsTable sections={sections} lineItems={lineItems} preset={preset} />
        <TotalsBlock document={document} preset={preset} />
        {preset.show_closing_statement && (
          <StatementBlock html={document.closing_statement} />
        )}
        <PageFooter jobNumber={jobNumber} />
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: invoice-pdf.tsx**

```typescript
// src/lib/pdf-renderer/invoice-pdf.tsx
import { Document, Page, View } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import { PageHeader } from "@/lib/pdf-renderer/components/page-header";
import { CompanyBlock } from "@/lib/pdf-renderer/components/company-block";
import { RecipientBlock } from "@/lib/pdf-renderer/components/recipient-block";
import { DocumentDetails } from "@/lib/pdf-renderer/components/document-details";
import { StatementBlock } from "@/lib/pdf-renderer/components/statement-block";
import { SectionsTable } from "@/lib/pdf-renderer/components/sections-table";
import { TotalsBlock } from "@/lib/pdf-renderer/components/totals-block";
import { PageFooter } from "@/lib/pdf-renderer/components/page-footer";
import type { RenderInput } from "@/lib/pdf-renderer/types";

type Input = Extract<RenderInput, { kind: "invoice" }>;

export function InvoicePdf(input: Input) {
  const { document, sections, lineItems, preset, company, recipient, jobNumber } = input;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PageHeader documentTitle={preset.document_title} logoUrl={company.logo_url} />
        <View style={styles.twoCol}>
          <CompanyBlock company={company} />
          <RecipientBlock recipient={recipient} />
        </View>
        <DocumentDetails document={document} kind="invoice" />
        {preset.show_opening_statement && (
          <StatementBlock html={document.opening_statement} />
        )}
        <SectionsTable sections={sections} lineItems={lineItems} preset={preset} />
        <TotalsBlock document={document} preset={preset} />
        {preset.show_closing_statement && (
          <StatementBlock html={document.closing_statement} />
        )}
        <PageFooter jobNumber={jobNumber} />
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: render.ts**

```typescript
// src/lib/pdf-renderer/render.ts — server-side render to Buffer.

import { renderToBuffer } from "@react-pdf/renderer";
import { EstimatePdf } from "@/lib/pdf-renderer/estimate-pdf";
import { InvoicePdf } from "@/lib/pdf-renderer/invoice-pdf";
import type { RenderInput } from "@/lib/pdf-renderer/types";

export async function renderPdf(input: RenderInput): Promise<Buffer> {
  if (input.kind === "estimate") {
    return renderToBuffer(<EstimatePdf {...input} />);
  }
  return renderToBuffer(<InvoicePdf {...input} />);
}
```

- [ ] **Step 4: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Build verify (renderer is now usable; catches any cross-file type drift)**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf-renderer/estimate-pdf.tsx src/lib/pdf-renderer/invoice-pdf.tsx src/lib/pdf-renderer/render.ts
git commit -m "renderer(67c1): orchestrators (Estimate/InvoicePdf) + renderToBuffer wrapper"
```

---

## Phase 6 — Routes (T15–T17)

### Task 15: Preview route `/api/pdf-presets/[id]/preview`

**Files:**
- Create: `src/lib/sample-pdf-data.ts`
- Create: `src/app/api/pdf-presets/[id]/preview/route.ts`

- [ ] **Step 1: Write sample data**

```typescript
// src/lib/sample-pdf-data.ts — synthetic data for the preset preview route.

import type {
  PdfPreset, Estimate, EstimateSection, EstimateLineItem,
  Invoice, InvoiceSection, InvoiceLineItem,
} from "@/lib/types";
import type { PdfCompany, PdfRecipient } from "@/lib/pdf-renderer/types";

export const SAMPLE_COMPANY: PdfCompany = {
  name: "Sample Company LLC",
  address: "123 Main Street · Houston, TX 77001",
  phone: "(555) 555-5555",
  email: "hello@example.com",
  logo_url: null,
};

export const SAMPLE_RECIPIENT: PdfRecipient = {
  name: "Jane Smith",
  email: "jane@example.com",
  phone: "(555) 123-4567",
  property_address: "456 Oak Avenue, Houston, TX 77002",
};

export const SAMPLE_JOB_NUMBER = "JOB-2026-0001";

export function buildSampleEstimate(orgId: string): {
  document: Estimate;
  sections: EstimateSection[];
  lineItems: EstimateLineItem[];
} {
  const estId = "00000000-0000-0000-0000-000000000001";
  const secId = "00000000-0000-0000-0000-000000000002";
  const document: Estimate = {
    id: estId,
    organization_id: orgId,
    job_id: "00000000-0000-0000-0000-0000000000aa",
    estimate_number: "JOB-2026-0001-EST-1",
    sequence_number: 1,
    title: "Sample Estimate",
    status: "draft",
    opening_statement: "<p>Thank you for choosing us for your emergency service needs.</p>",
    closing_statement: "<p>Payment due within 30 days. Please contact us with any questions.</p>",
    subtotal: 1200, markup_type: "percent", markup_value: 15, markup_amount: 180,
    discount_type: "amount", discount_value: 50, discount_amount: 50,
    adjusted_subtotal: 1330, tax_rate: 8.25, tax_amount: 109.73, total: 1439.73,
    issued_date: new Date().toISOString().slice(0, 10),
    valid_until: null, converted_to_invoice_id: null, converted_at: null,
    sent_at: null, approved_at: null, rejected_at: null,
    voided_at: null, void_reason: null,
    created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const sections: EstimateSection[] = [{
    id: secId, organization_id: orgId, estimate_id: estId,
    parent_section_id: null, title: "Initial Response", sort_order: 0,
    created_at: document.created_at, updated_at: document.created_at,
  }];
  const lineItems: EstimateLineItem[] = [
    {
      id: "00000000-0000-0000-0000-000000000010",
      organization_id: orgId, estimate_id: estId, section_id: secId,
      library_item_id: null, description: "Emergency response — first hour",
      code: "ER-1", quantity: 1, unit: "hr", unit_price: 250, total: 250, sort_order: 0,
      created_at: document.created_at, updated_at: document.created_at,
    },
    {
      id: "00000000-0000-0000-0000-000000000011",
      organization_id: orgId, estimate_id: estId, section_id: secId,
      library_item_id: null, description: "Air mover — daily rental",
      code: "AM-D", quantity: 5, unit: "day", unit_price: 190, total: 950, sort_order: 1,
      created_at: document.created_at, updated_at: document.created_at,
    },
  ];
  return { document, sections, lineItems };
}

export function buildSampleInvoice(orgId: string): {
  document: Invoice;
  sections: InvoiceSection[];
  lineItems: InvoiceLineItem[];
} {
  // Mirrors the estimate but as an invoice; adapt fields exposed by Invoice.
  const invId = "00000000-0000-0000-0000-000000000020";
  const secId = "00000000-0000-0000-0000-000000000021";
  const document: Invoice = {
    id: invId,
    organization_id: orgId,
    job_id: "00000000-0000-0000-0000-0000000000aa",
    invoice_number: "JOB-2026-0001-INV-1",
    sequence_number: 1,
    title: "Sample Invoice",
    status: "draft",
    opening_statement: "<p>Thank you for choosing us for your emergency service needs.</p>",
    closing_statement: "<p>Payment due within 30 days. Please contact us with any questions.</p>",
    subtotal: 1200, markup_type: "percent", markup_value: 15, markup_amount: 180,
    discount_type: "amount", discount_value: 50, discount_amount: 50,
    adjusted_subtotal: 1330, tax_rate: 8.25, tax_amount: 109.73,
    total_amount: 1439.73,
    issued_date: new Date().toISOString().slice(0, 10),
    due_date: null, converted_from_estimate_id: null, voided_at: null, void_reason: null,
    notes: null, created_by: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as Invoice;
  const sections: InvoiceSection[] = [{
    id: secId, organization_id: orgId, invoice_id: invId,
    parent_section_id: null, title: "Initial Response", sort_order: 0,
    created_at: document.created_at, updated_at: document.created_at,
  }];
  const lineItems: InvoiceLineItem[] = [
    {
      id: "00000000-0000-0000-0000-000000000030",
      organization_id: orgId, invoice_id: invId, section_id: secId,
      library_item_id: null, description: "Emergency response — first hour",
      code: "ER-1", quantity: 1, unit: "hr", unit_price: 250, total: 250, sort_order: 0,
      created_at: document.created_at, updated_at: document.created_at,
    } as InvoiceLineItem,
    {
      id: "00000000-0000-0000-0000-000000000031",
      organization_id: orgId, invoice_id: invId, section_id: secId,
      library_item_id: null, description: "Air mover — daily rental",
      code: "AM-D", quantity: 5, unit: "day", unit_price: 190, total: 950, sort_order: 1,
      created_at: document.created_at, updated_at: document.created_at,
    } as InvoiceLineItem,
  ];
  return { document, sections, lineItems };
}

export function buildSampleInput(preset: PdfPreset, orgId: string) {
  if (preset.document_type === "estimate") {
    const sample = buildSampleEstimate(orgId);
    return {
      kind: "estimate" as const, ...sample, preset,
      company: SAMPLE_COMPANY, recipient: SAMPLE_RECIPIENT, jobNumber: SAMPLE_JOB_NUMBER,
    };
  }
  const sample = buildSampleInvoice(orgId);
  return {
    kind: "invoice" as const, ...sample, preset,
    company: SAMPLE_COMPANY, recipient: SAMPLE_RECIPIENT, jobNumber: SAMPLE_JOB_NUMBER,
  };
}
```

> **Plan-time verification:** read `src/lib/types.ts` and confirm the field lists in `Estimate`, `Invoice`, `EstimateSection`, `InvoiceSection`, `EstimateLineItem`, `InvoiceLineItem` match the literals above. If the types have additional NOT-NULL fields (e.g. `qb_invoice_id` on Invoice), add them with sensible nulls. tsc will surface any mismatch.

- [ ] **Step 2: Write the preview route**

```typescript
// src/app/api/pdf-presets/[id]/preview/route.ts — inline sample PDF.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireAnyPermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getPreset } from "@/lib/pdf-presets";
import { renderPdf } from "@/lib/pdf-renderer/render";
import { buildSampleInput } from "@/lib/sample-pdf-data";
import { apiError } from "@/lib/api-errors";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requireAnyPermission(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  try {
    const preset = await getPreset(supabase, id);
    if (!preset) return NextResponse.json({ error: "not found" }, { status: 404 });
    const input = buildSampleInput(preset, orgId);
    const buffer = await renderPdf(input);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="preset-preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e, "GET /api/pdf-presets/[id]/preview render");
  }
}
```

- [ ] **Step 3: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Manual verify**

Open `/settings/pdf-presets` → Edit default Estimate preset → click "Preview sample PDF". A PDF should open inline in a new tab with sample content reflecting current toggle state. Toggle `show_markup` off → save → preview again → markup row gone.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sample-pdf-data.ts src/app/api/pdf-presets/[id]/preview/route.ts
git commit -m "route(67c1): /api/pdf-presets/[id]/preview — inline sample PDF"
```

---

### Task 16: Estimates pdf route `POST /api/estimates/[id]/pdf`

**Files:**
- Create: `src/app/api/estimates/[id]/pdf/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/estimates/[id]/pdf/route.ts — render → upload → signed URL.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getPreset, getDefaultPreset } from "@/lib/pdf-presets";
import { renderPdf } from "@/lib/pdf-renderer/render";
import { estimatePdfPath } from "@/lib/storage/paths";
import { apiError } from "@/lib/api-errors";
import type { Estimate, EstimateSection, EstimateLineItem } from "@/lib/types";
import type { PdfCompany, PdfRecipient } from "@/lib/pdf-renderer/types";

interface CompanySettingRow { key: string; value: string | null; }

async function loadCompany(
  service: ReturnType<typeof createServiceClient>,
): Promise<PdfCompany> {
  const { data } = await service.from("company_settings").select("key, value");
  const byKey = Object.fromEntries(
    ((data ?? []) as CompanySettingRow[]).map((r) => [r.key, r.value ?? ""]),
  );
  const addressParts = [
    byKey.address_street,
    [byKey.address_city, byKey.address_state, byKey.address_zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  return {
    name: byKey.company_name || null,
    address: addressParts.length ? addressParts.join(" · ") : null,
    phone: byKey.phone || null,
    email: byKey.email || null,
    logo_url: byKey.logo_url || null,
  };
}

async function loadRecipient(
  service: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<{ recipient: PdfRecipient; jobNumber: string }> {
  const { data: job } = await service
    .from("jobs")
    .select("job_number, property_address, contacts:contact_id(first_name, last_name, email, phone)")
    .eq("id", jobId)
    .maybeSingle<{
      job_number: string | null;
      property_address: string | null;
      contacts: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
    }>();
  const contact = job?.contacts ?? null;
  const recipient: PdfRecipient = {
    name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Customer",
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    property_address: job?.property_address ?? null,
  };
  return { recipient, jobNumber: job?.job_number ?? "JOB-UNKNOWN" };
}

interface PdfRequestBody { preset_id?: string; }

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  let body: PdfRequestBody = {};
  try { body = (await request.json().catch(() => ({}))) as PdfRequestBody; }
  catch { /* empty body OK; default preset will be used */ }

  try {
    // Load doc, sections, line items via the user's RLS-scoped client (org enforcement).
    const { data: doc } = await supabase
      .from("estimates").select("*").eq("id", id).maybeSingle<Estimate>();
    if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: sections } = await supabase
      .from("estimate_sections").select("*").eq("estimate_id", id);
    const { data: lineItems } = await supabase
      .from("estimate_line_items").select("*").eq("estimate_id", id);

    const preset = body.preset_id
      ? await getPreset(supabase, body.preset_id)
      : await getDefaultPreset(supabase, "estimate");
    if (!preset) return NextResponse.json({ error: "preset not found (and no default seeded)" }, { status: 400 });
    if (preset.document_type !== "estimate") {
      return NextResponse.json({ error: "preset document_type mismatch" }, { status: 400 });
    }

    // Load company + recipient via service client (company_settings has its own RLS, but
    // the upload itself needs service-role to write to the pdfs bucket without per-user grants).
    const service = createServiceClient();
    const company = await loadCompany(service);
    const { recipient, jobNumber } = await loadRecipient(service, doc.job_id);

    const buffer = await renderPdf({
      kind: "estimate",
      document: doc,
      sections: (sections ?? []) as EstimateSection[],
      lineItems: (lineItems ?? []) as EstimateLineItem[],
      preset, company, recipient, jobNumber,
    });

    const path = estimatePdfPath(orgId, jobNumber, doc.estimate_number);
    const { error: upErr } = await service.storage
      .from("pdfs")
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (upErr) return apiError(upErr, "POST /api/estimates/[id]/pdf upload");

    const { data: signed, error: signErr } = await service.storage
      .from("pdfs").createSignedUrl(path, 300);
    if (signErr || !signed) return apiError(signErr ?? new Error("sign failed"), "POST /api/estimates/[id]/pdf sign");

    return NextResponse.json({
      download_url: signed.signedUrl,
      storage_path: path,
      filename: `${doc.estimate_number}.pdf`,
    });
  } catch (e) {
    return apiError(e, "POST /api/estimates/[id]/pdf");
  }
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If types.ts has additional fields on Estimate that don't have defaults in the DB row, this surfaces here — adjust the `as Estimate` cast or augment the type.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/estimates/[id]/pdf/route.ts
git commit -m "route(67c1): POST /api/estimates/[id]/pdf — render + upload + signed URL"
```

---

### Task 17: Replace invoices pdf route + delete superseded files + update read-only caller

**Files:**
- Modify: `src/app/api/invoices/[id]/pdf/route.ts` (rewrite as POST)
- Delete: `src/lib/invoices/generate-invoice-pdf.tsx`
- Delete: `src/components/invoices/invoice-pdf-document.tsx`
- Modify: `src/components/invoices/invoice-read-only-client.tsx` (update Export PDF call site)

- [ ] **Step 1: Rewrite the invoices route**

Replace the entire file with the POST shape mirroring T16. Use `Invoice`, `InvoiceSection`, `InvoiceLineItem` types and `invoicePdfPath` helper. Permission key: `view_invoices`. Default preset doc_type: `invoice`.

```typescript
// src/app/api/invoices/[id]/pdf/route.ts — render → upload → signed URL.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getPreset, getDefaultPreset } from "@/lib/pdf-presets";
import { renderPdf } from "@/lib/pdf-renderer/render";
import { invoicePdfPath } from "@/lib/storage/paths";
import { apiError } from "@/lib/api-errors";
import type { Invoice, InvoiceSection, InvoiceLineItem } from "@/lib/types";
import type { PdfCompany, PdfRecipient } from "@/lib/pdf-renderer/types";

interface CompanySettingRow { key: string; value: string | null; }

async function loadCompany(
  service: ReturnType<typeof createServiceClient>,
): Promise<PdfCompany> {
  const { data } = await service.from("company_settings").select("key, value");
  const byKey = Object.fromEntries(
    ((data ?? []) as CompanySettingRow[]).map((r) => [r.key, r.value ?? ""]),
  );
  const addressParts = [
    byKey.address_street,
    [byKey.address_city, byKey.address_state, byKey.address_zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  return {
    name: byKey.company_name || null,
    address: addressParts.length ? addressParts.join(" · ") : null,
    phone: byKey.phone || null,
    email: byKey.email || null,
    logo_url: byKey.logo_url || null,
  };
}

async function loadRecipient(
  service: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<{ recipient: PdfRecipient; jobNumber: string }> {
  const { data: job } = await service
    .from("jobs")
    .select("job_number, property_address, contacts:contact_id(first_name, last_name, email, phone)")
    .eq("id", jobId)
    .maybeSingle<{
      job_number: string | null;
      property_address: string | null;
      contacts: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
    }>();
  const contact = job?.contacts ?? null;
  const recipient: PdfRecipient = {
    name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Customer",
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    property_address: job?.property_address ?? null,
  };
  return { recipient, jobNumber: job?.job_number ?? "JOB-UNKNOWN" };
}

interface PdfRequestBody { preset_id?: string; }

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_invoices");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  let body: PdfRequestBody = {};
  try { body = (await request.json().catch(() => ({}))) as PdfRequestBody; }
  catch { /* empty body OK */ }

  try {
    const { data: doc } = await supabase
      .from("invoices").select("*").eq("id", id).maybeSingle<Invoice>();
    if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: sections } = await supabase
      .from("invoice_sections").select("*").eq("invoice_id", id);
    const { data: lineItems } = await supabase
      .from("invoice_line_items").select("*").eq("invoice_id", id);

    const preset = body.preset_id
      ? await getPreset(supabase, body.preset_id)
      : await getDefaultPreset(supabase, "invoice");
    if (!preset) return NextResponse.json({ error: "preset not found (and no default seeded)" }, { status: 400 });
    if (preset.document_type !== "invoice") {
      return NextResponse.json({ error: "preset document_type mismatch" }, { status: 400 });
    }

    const service = createServiceClient();
    const company = await loadCompany(service);
    const { recipient, jobNumber } = await loadRecipient(service, doc.job_id);

    const buffer = await renderPdf({
      kind: "invoice",
      document: doc,
      sections: (sections ?? []) as InvoiceSection[],
      lineItems: (lineItems ?? []) as InvoiceLineItem[],
      preset, company, recipient, jobNumber,
    });

    const path = invoicePdfPath(orgId, jobNumber, doc.invoice_number);
    const { error: upErr } = await service.storage
      .from("pdfs")
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (upErr) return apiError(upErr, "POST /api/invoices/[id]/pdf upload");

    const { data: signed, error: signErr } = await service.storage
      .from("pdfs").createSignedUrl(path, 300);
    if (signErr || !signed) return apiError(signErr ?? new Error("sign failed"), "POST /api/invoices/[id]/pdf sign");

    return NextResponse.json({
      download_url: signed.signedUrl,
      storage_path: path,
      filename: `${doc.invoice_number}.pdf`,
    });
  } catch (e) {
    return apiError(e, "POST /api/invoices/[id]/pdf");
  }
}
```

- [ ] **Step 2: Delete superseded files**

```bash
rm src/lib/invoices/generate-invoice-pdf.tsx
rm src/components/invoices/invoice-pdf-document.tsx
```

- [ ] **Step 3: Update the read-only client caller**

In `src/components/invoices/invoice-read-only-client.tsx`, replace the existing `window.open` call (around line 45) with a POST + download flow:

```
old_string:     window.open(`/api/invoices/${invoice.id}/pdf`, "_blank");
new_string:     const res = await fetch(`/api/invoices/${invoice.id}/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      // Fall back to a noop; toast handled by the parent. The full flow lands in T18 via the modal.
      return;
    }
    const { download_url } = (await res.json()) as { download_url: string };
    const a = document.createElement("a");
    a.href = download_url;
    a.click();
```

The function's containing handler needs to be `async`. Verify by reading lines 40-55 of `invoice-read-only-client.tsx` before editing — adjust the `async` keyword on the handler if needed.

- [ ] **Step 4: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Build verify**

Run: `npm run build`
Expected: `✓ Compiled successfully`. (Catches any other importer of the deleted files.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/invoices/[id]/pdf/route.ts \
        src/lib/invoices/generate-invoice-pdf.tsx \
        src/components/invoices/invoice-pdf-document.tsx \
        src/components/invoices/invoice-read-only-client.tsx
git commit -m "route(67c1): POST /api/invoices/[id]/pdf rewrite + delete 67b stub renderer"
```

---

## Phase 7 — Export modal + integration (T18, T19)

### Task 18: Export PDF modal component

**Files:**
- Create: `src/components/export-pdf-modal/index.tsx`

- [ ] **Step 1: Write the modal**

```typescript
// src/components/export-pdf-modal/index.tsx
"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { PdfPreset, DocumentType } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: DocumentType;
  documentId: string;
  filenameHint: string; // e.g. estimate_number, used as the download filename
}

export function ExportPdfModal({ open, onOpenChange, documentType, documentId, filenameHint }: Props) {
  const [presets, setPresets] = useState<PdfPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/pdf-presets?document_type=${documentType}`);
      if (cancelled) return;
      if (!res.ok) {
        toast({ title: "Could not load presets", variant: "destructive" });
        setLoading(false);
        return;
      }
      const { presets: list } = (await res.json()) as { presets: PdfPreset[] };
      if (cancelled) return;
      setPresets(list);
      const def = list.find((p) => p.is_default) ?? list[0];
      setSelectedId(def?.id ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, documentType, toast]);

  async function handleExport() {
    if (!selectedId) return;
    setExporting(true);
    const route = documentType === "estimate"
      ? `/api/estimates/${documentId}/pdf`
      : `/api/invoices/${documentId}/pdf`;
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset_id: selectedId }),
    });
    setExporting(false);
    if (!res.ok) {
      toast({ title: "Could not generate PDF", variant: "destructive" });
      return;
    }
    const { download_url } = (await res.json()) as { download_url: string };
    const a = document.createElement("a");
    a.href = download_url;
    a.download = `${filenameHint}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ title: "PDF exported" });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export PDF</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <Label htmlFor="preset-select">Preset</Label>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading presets…</p>
          ) : presets.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No presets configured. Visit Settings → PDF Presets.
            </p>
          ) : (
            <select
              id="preset-select"
              className="w-full rounded border px-2 py-1.5"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleExport} disabled={!selectedId || exporting || loading}>
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/export-pdf-modal/index.tsx
git commit -m "ui(67c1): export-pdf-modal — preset picker + Export button + browser download"
```

---

### Task 19: Wire Export button into estimate builder + estimate read-only + invoice builder + invoice read-only

**Files:**
- Modify: `src/components/estimate-builder/header-bar.tsx` (Export button — both estimate and invoice modes)
- Modify: estimate read-only client (locate via `grep -ln 'EstimateReadOnly\|estimate-read-only' src/components/`)
- Modify: invoice read-only client `src/components/invoices/invoice-read-only-client.tsx` (replace the inline POST hack from T17 step 3 with the modal)

- [ ] **Step 1: Locate the exact files**

```bash
grep -rn "estimate-read-only\|EstimateReadOnly" src/components/ | head -5
grep -rn "invoice-read-only" src/components/ | head -5
```

Note the exact file paths returned; use them in the steps below.

- [ ] **Step 2: Add Export button to HeaderBar**

In `src/components/estimate-builder/header-bar.tsx`, find the action buttons cluster (the area where Save / Send / Mark-Approved / Convert / Void render). Add a new "Export PDF" button visible in both `estimate` and `invoice` modes, gated to non-template:

```typescript
// At the top of the file:
import { useState } from "react";
import { ExportPdfModal } from "@/components/export-pdf-modal";
```

Inside the component, near other useState hooks:
```typescript
const [exportOpen, setExportOpen] = useState(false);
```

In the JSX (within the action buttons area, gated by `mode !== "template"`):
```typescript
{mode !== "template" && (
  <Button variant="outline" onClick={() => setExportOpen(true)}>
    Export PDF
  </Button>
)}
```

At the end of the component's return JSX (before the closing fragment/wrapper):
```typescript
{mode !== "template" && (
  <ExportPdfModal
    open={exportOpen}
    onOpenChange={setExportOpen}
    documentType={mode === "estimate" ? "estimate" : "invoice"}
    documentId={entity.data.id}
    filenameHint={
      mode === "estimate"
        ? (entity.data as { estimate_number: string }).estimate_number
        : (entity.data as { invoice_number: string }).invoice_number
    }
  />
)}
```

(Reference: 67b's header-bar uses a discriminated `entity` prop — see [`docs/superpowers/specs/2026-05-01-build-67b-design.md`](../specs/2026-05-01-build-67b-design.md) for shape. Verify the exact narrowing pattern by reading lines around the existing Save button in header-bar.tsx.)

- [ ] **Step 3: Add Export button to estimate read-only client**

Wire the same `ExportPdfModal` into the estimate read-only page's action area. Pattern is identical to T19 step 2 except `mode` is implicitly "estimate" — pass `documentType="estimate"`.

- [ ] **Step 4: Replace the inline hack in invoice read-only client**

Reading `src/components/invoices/invoice-read-only-client.tsx`, find the function that T17 step 3 modified. Replace the entire handler body with `setExportOpen(true)` and add the `ExportPdfModal` to the rendered JSX with `documentType="invoice"`. Same pattern as T19 step 2.

- [ ] **Step 5: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Build verify + manual smoke**

```bash
npm run build
```
Expected: `✓ Compiled successfully`.

Manual: navigate to a real estimate → click Export PDF → modal opens → default preset selected → click Export → file downloads. Repeat for an invoice.

- [ ] **Step 7: Commit**

```bash
git add src/components/estimate-builder/header-bar.tsx \
        src/components/invoices/invoice-read-only-client.tsx \
        <estimate-read-only-file-from-step-1>
git commit -m "ui(67c1): wire ExportPdfModal into estimate builder, invoice builder, and both read-only views"
```

---

## Phase 8 — `xactimate_code` retirement (T20, T21)

### Task 20: Code cleanup — types, mapper, QB sync

**Files:**
- Modify: `src/lib/types.ts` (remove `xactimate_code` from `InvoiceLineItem`)
- Modify: `src/lib/invoices.ts` (remove all `xactimate_code` references)
- Modify: `src/lib/qb/sync/invoices.ts` (remap or drop)

- [ ] **Step 1: Audit `xactimate_code` usage in runtime code**

```bash
grep -rn "xactimate_code" src/
```

Expected matches (per the brainstorm-time grep): `src/lib/types.ts`, `src/lib/invoices.ts`, `src/lib/qb/sync/invoices.ts`. The `src/components/invoices/invoice-pdf-document.tsx` file was deleted in T17 — confirm it's gone.

- [ ] **Step 2: Read `src/lib/qb/sync/invoices.ts` and decide per reference**

Open the file and locate every `xactimate_code` reference. For each:
- If it's READING `line_item.xactimate_code` to push to a QB field: change the read to `line_item.code` (the new column name from Build 38 onwards). Keep the QB field mapping.
- If it's a no-op import / dead code: delete the line.

The exact edit depends on the file content. Apply each edit, capture before/after, and verify tsc.

- [ ] **Step 3: Remove `xactimate_code` from `InvoiceLineItem` interface**

In `src/lib/types.ts`, remove the field from the `InvoiceLineItem` interface. Read the surrounding ~20 lines to confirm there are no other consumers of the removed field name in the same file.

- [ ] **Step 4: Remove `xactimate_code` from `src/lib/invoices.ts`**

Likely in a SELECT column list, INSERT payload, or mapper. Replace any `xactimate_code` reference with `code` if the intent was the new column, or delete if the intent was the legacy column.

- [ ] **Step 5: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors. Any remaining read of `.xactimate_code` will surface here.

- [ ] **Step 6: Verify the grep is now clean of runtime references**

```bash
grep -rn "xactimate_code" src/
```

Expected: 0 matches in `src/`. (Docs and migrations may still reference it; that's fine.)

- [ ] **Step 7: Build verify**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 8: Manual happy-path smoke**

Pick a 67b-era estimate, convert to invoice, verify the new invoice's `invoice_line_items.code` is populated correctly (use Supabase MCP `execute_sql`):

```sql
SELECT i.invoice_number, li.description, li.code, li.xactimate_code
FROM invoices i
JOIN invoice_line_items li ON li.invoice_id = i.id
ORDER BY i.created_at DESC LIMIT 5;
```

Expected: `code` is populated. `xactimate_code` is still populated at this point (RPC dual-write still active — T21 removes it). `code = xactimate_code` for any rows from the convert path.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/lib/invoices.ts src/lib/qb/sync/invoices.ts
git commit -m "cleanup(67c1): drop xactimate_code reads from types, invoices.ts, qb/sync (I1 step 1 of 2)"
```

---

### Task 21: Migration — drop dual-write + drop column

**Files:**
- Create: `supabase/migration-build67c1-retire-xactimate-code.sql`

- [ ] **Step 1: Read the existing convert RPC body**

Use Supabase MCP `execute_sql`:
```sql
SELECT pg_get_functiondef('convert_estimate_to_invoice'::regproc);
```

Capture the full body. The new migration will replace it with a version that drops `xactimate_code` from the INSERT column list and from the SELECT clause inside the recursive CTE — preserving the I2 regex-safe due-days cast and the I4 inline totals recompute.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration-build67c1-retire-xactimate-code.sql
-- Build 67c1 — close I1: drop xactimate_code dual-write from convert RPC, drop column.
-- Spec: docs/superpowers/specs/2026-05-04-build-67c1-design.md

-- 1. Replace the convert RPC. Body is the current implementation (from
--    pg_get_functiondef in step 1) with `xactimate_code` removed from the
--    INSERT column list and SELECT clause in the line-items recursive insert.
--    DO NOT regress: the I2 regex-safe `^\s*-?\d+\s*$` cast on
--    default_invoice_due_days and the I4 inline totals recompute (matches
--    convert_estimate_to_invoice's existing markup/discount/tax/total math)
--    must remain intact.

CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(...)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  -- (carry over the DECLARE block from the current function body)
BEGIN
  -- (carry over the body, with the two-line edit:
  --  - INSERT INTO invoice_line_items (..., code, ...) -- xactimate_code removed
  --  - SELECT ..., li.code, ... FROM estimate_line_items li -- xactimate_code removed
  --  Preserve I2 (regex-safe due_days cast) and I4 (inline totals recompute).)
END;
$$;

-- 2. Drop the column.
ALTER TABLE invoice_line_items DROP COLUMN xactimate_code;
```

> **The function body is a verbatim carry-over of the current implementation with two literal removals.** The plan task here cannot show the full text without re-quoting the current 100+ line function — instead, the executor must:
>   1. Run the `pg_get_functiondef` query in step 1.
>   2. Paste the result into the migration file.
>   3. Apply the two literal removals (one in the INSERT column list, one in the recursive SELECT).
>   4. Save the file.
>
> Verify after writing: the migration's CREATE OR REPLACE body does NOT contain the string `xactimate_code` anywhere. The migration's only column-mutation statement is the final `ALTER TABLE ... DROP COLUMN`.

- [ ] **Step 3: Apply migration via Supabase MCP**

Use `mcp__31d06679-...__apply_migration` with `name: "build67c1_retire_xactimate_code"` and the SQL body from step 2.

- [ ] **Step 4: Verify post-apply via Supabase MCP `execute_sql`**

```sql
-- Column gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoice_line_items' AND column_name = 'xactimate_code';
-- Expected: 0 rows.

-- RPC body has no xactimate_code reference
SELECT (pg_get_functiondef('convert_estimate_to_invoice'::regproc) LIKE '%xactimate_code%') AS still_referenced;
-- Expected: false.

-- I2 marker still present (regex on raw due-days)
SELECT (pg_get_functiondef('convert_estimate_to_invoice'::regproc) LIKE '%I2 fix%') AS i2_present;
-- Expected: true.

-- I4 marker still present (inline totals recompute)
SELECT (pg_get_functiondef('apply_template_to_estimate'::regproc) LIKE '%I4 fix%') AS i4_present;
-- Expected: true. (Note: I4 lives on apply_template, not convert.)
```

- [ ] **Step 5: Manual end-to-end smoke**

Convert a fresh estimate to invoice via the UI. Verify:
- Conversion succeeds (200, redirects to new invoice editor)
- New invoice's line items have `code` populated
- No `xactimate_code` column on `invoice_line_items` (Supabase Studio table view confirms)

- [ ] **Step 6: Commit**

```bash
git add supabase/migration-build67c1-retire-xactimate-code.sql
git commit -m "migration(67c1): drop xactimate_code dual-write + column — closes I1"
```

---

## Phase 9 — Final integration (T22, T23)

### Task 22: New-org default-preset onboarding hook

**Files:**
- Locate via grep: `grep -rn "INSERT INTO organizations\|create_organization\|handle_new_user" src/ supabase/ | head -10`

- [ ] **Step 1: Find the new-org bootstrap path**

There's likely an RPC or trigger that runs when a new organization is created — it seeds default settings, creates the admin membership, etc. Grep for it.

- [ ] **Step 2: Decide between (a) and (b)**

Given the seeding migration in T1 only handles existing orgs, new orgs onboarded after the migration applied will have NO default presets. Two options:

**(a)** Patch the new-org bootstrap RPC to insert two default presets per new org (extends an existing migration if there is one, or a new tiny migration).

**(b)** Patch `getDefaultPreset` (or its callers) to lazily create a default preset if none exists for the (org, doc_type) pair.

Recommendation: **(a)** if the bootstrap RPC is straightforward to extend (most likely yes — 67a's settings keys + permissions already follow this pattern). Otherwise **(b)** as a fallback.

- [ ] **Step 3: Implement chosen option**

If (a): write `supabase/migration-build67c1-seed-presets-on-org-create.sql` extending the relevant function. Verify with `execute_sql` that a synthetic new org would receive presets (test via `BEGIN; INSERT ... ROLLBACK;` if safe).

If (b): modify `src/lib/pdf-presets.ts` `getDefaultPreset` to insert + return when none exists. Add a unit-of-work test by exercising via a fresh-org Supabase session (only if a TestCo equivalent exists; otherwise skip and rely on T23 manual test).

- [ ] **Step 4: tsc check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
# (a) option:
git add supabase/migration-build67c1-seed-presets-on-org-create.sql
git commit -m "migration(67c1): seed default PDF presets when a new organization is created"

# OR (b) option:
git add src/lib/pdf-presets.ts
git commit -m "lib(67c1): lazy-seed default PDF preset when getDefaultPreset returns null"
```

---

### Task 23: §11-style manual test pass

**Files:** none (write results to `docs/superpowers/specs/2026-05-04-build-67c1-test-results.md`)

- [ ] **Step 1: Execute all 12 test cases from the spec section 10**

For each test case:
1. Mark expected outcome.
2. Execute via the live preview / dev server.
3. Record actual outcome (PASS / FAIL with notes).

- [ ] **Step 2: Write the test results doc**

Create `docs/superpowers/specs/2026-05-04-build-67c1-test-results.md` with header and the 12-row results table (mirrors the 67b test-results doc shape).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-04-build-67c1-test-results.md
git commit -m "docs(67c1): §11 manual test results NN/12 PASS"
```

---

## Self-review (post-write)

### Spec coverage (each spec section → tasks)

| Spec section | Implementing tasks |
|---|---|
| §1 Goals & non-goals | (sets scope; no direct task) |
| §2 Decisions locked | (drives every task) |
| §3 Deliverables 1–10 | T1, T2, T3–T5, T6–T7, T8, T9–T14, T15, T16–T17, T18, T19, T20–T21, T23 |
| §4 Data model `pdf_presets` | T1 (migration) + T2 (types) |
| §5 PDF renderer | T9 + T10 + T11 + T12 + T13 + T14 |
| §6 API surface (8 routes) | T4 + T5 + T15 + T16 + T17 |
| §7 UI components | T6 (nav) + T7 (manager) + T8 (editor) + T18 (export modal) + T19 (wiring) |
| §8 `xactimate_code` retirement | T20 (code) + T21 (migration) |
| §9 Edge cases | Renderer cases handled in T9–T14 component code; CRUD cases in T3 + T5; export cases in T16 + T17 + T18 |
| §10 Manual test plan (12 cases) | T23 |
| §11 Open questions for plan-write | T15 (sample-pdf-data field-name verify), T20 (qb/sync per-ref decisions), T22 (onboarding hook), T11 (Tiptap/HTML — confirmed HTML during plan-write), bucket existence (created in T1) |

No gaps detected.

### Placeholder scan

- Searched for "TBD" / "TODO" / "implement later" / "fill in details": none in task bodies.
- Task 21 step 2 explicitly carries over the existing function body via `pg_get_functiondef` rather than re-quoting it inline. This is intentional — the body is 100+ lines whose canonical source is the current production function, and copying via the MCP is more reliable than risking spec drift in the plan file. Marked with a clear "verify after writing" instruction.
- Task 19 step 1 uses a `grep` to locate exact file paths rather than hardcoding them. Acceptable: the read-only-client file paths can drift; the grep instruction is concrete.

### Type consistency

- `PdfPreset` shape: defined in T2, consumed by T3, T4, T5, T7, T8, T15, T16, T17, T18 — all match.
- `DocumentType` union: defined in T2, used as the `document_type` query param + filter throughout. Consistent.
- `RenderInput` discriminated union: defined in T9, consumed by T14 (orchestrators) + T15 (sample) + T16 + T17 (route handlers). Consistent.
- `PdfCompany` / `PdfRecipient`: defined in T9 types.ts, consumed by T10 (atomic components), T15 (sample), T16/T17 (routes). Consistent.
- `htmlToPdfNodes`: defined in T9, consumed by T11 (`StatementBlock`). Consistent.
- `estimatePdfPath` / `invoicePdfPath`: defined in T1 (paths.ts), consumed by T16 / T17. Consistent.

### Risk surfaces flagged

1. **T16 / T17 type casts (`as Estimate`, `as Invoice`)**: if `Estimate` or `Invoice` types in `src/lib/types.ts` have NOT-NULL fields the DB row won't always populate, this surfaces as tsc errors at T16/T17. Plan-time fix: either widen the local type or add the missing nullable variant.
2. **T9 `html-to-pdf.tsx` parser**: regex-based, handles only the subset Tiptap emits. If the editor adds image/heading nodes later, output silently degrades. Worth a brief integration test in T23.
3. **T21 RPC body carry-over**: the executor must not regress I2 / I4. The verification queries in step 4 explicitly check both markers.
4. **T22 onboarding hook**: open-ended; the executor must locate the bootstrap path. Falls back to lazy-seeding (option b) if the explicit hook doesn't exist or is too entangled to extend safely.

---

## Done state

- All 23 tasks committed on `main` (or a feature branch, executor's choice).
- `npx tsc --noEmit` clean.
- `npm run build` ✓ Compiled successfully.
- 12/12 tests in T23 PASS (record exceptions inline if any).
- Vercel auto-deploy completes successfully on push to `main`.
- I1 closed; `xactimate_code` no longer in the schema or runtime code.

Next: 67c2 (Send modal + email infra + per-user "from" override groundwork) — gets its own brainstorm/spec/plan cycle after 67c1 ships.

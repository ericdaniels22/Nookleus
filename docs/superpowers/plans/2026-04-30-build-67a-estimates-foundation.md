# Build 67a — Estimates & Invoices Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data foundation, Item Library admin UX, and end-to-end estimate creation/editing on the job page so Eric can manually build estimates with sections, subsections, and library-backed line items.

**Architecture:** New tables (`item_library`, `estimates`, `estimate_sections`, `estimate_line_items`, `estimate_templates`, `pdf_presets`, `invoice_sections`) all org-scoped with RLS. Existing `invoices` and `invoice_line_items` altered (not dropped) to add the 18-era columns. Server-side recalc-on-save in `src/lib/estimates.ts`. Builder UI mirrors the Build 14j form-builder pattern (auto-save via `useRef` debounce + `sonner` toasts, `@dnd-kit/sortable` for reorder).

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + RLS + RPC), Tailwind + shadcn/ui (`Dialog`, `Tabs`, `Tooltip`), `@dnd-kit/sortable`, Tiptap (existing `src/components/tiptap-editor.tsx`), `sonner` for toasts, `lucide-react` icons. **No test framework** — verification = `npm run build` (tsc) + Supabase MCP SQL inspection + manual preview via the Claude Preview MCP.

**Source spec:** [docs/superpowers/specs/2026-04-30-build-67a-estimates-foundation-design.md](../specs/2026-04-30-build-67a-estimates-foundation-design.md)

---

## File Structure

### Created files

| Path | Responsibility |
|---|---|
| `supabase/migration-build67a-estimates-foundation.sql` | All schema work + RLS + RPCs + permission seed |
| `src/lib/estimates.ts` | Estimate CRUD, `recalculateTotals`, `generateEstimateNumber` wrapper |
| `src/lib/item-library.ts` | Item Library CRUD with org scoping |
| `src/lib/format.ts` | `formatCurrency(n: number): string` helper |
| `src/app/api/estimates/route.ts` | POST create, GET list by `?job_id` |
| `src/app/api/estimates/[id]/route.ts` | GET, PUT (metadata+adjustments), DELETE (void) |
| `src/app/api/estimates/[id]/sections/route.ts` | POST section, PUT bulk reorder |
| `src/app/api/estimates/[id]/sections/[section_id]/route.ts` | PUT rename, DELETE |
| `src/app/api/estimates/[id]/line-items/route.ts` | POST item, PUT bulk reorder |
| `src/app/api/estimates/[id]/line-items/[item_id]/route.ts` | PUT edit, DELETE |
| `src/app/api/item-library/route.ts` | GET list (filters), POST create |
| `src/app/api/item-library/[id]/route.ts` | GET, PUT, DELETE (deactivate) |
| `src/app/settings/item-library/page.tsx` | Table + filters + create/edit modal |
| `src/app/jobs/[id]/estimates/new/page.tsx` | Server action: create draft, redirect to edit |
| `src/app/estimates/[id]/edit/page.tsx` | Estimate builder shell (server-rendered) |
| `src/app/estimates/[id]/page.tsx` | Read-only estimate view |
| `src/components/estimate-builder/index.tsx` | Builder layout + state owner + auto-save |
| `src/components/estimate-builder/header-bar.tsx` | Title, status, action buttons |
| `src/components/estimate-builder/metadata-bar.tsx` | Reference, dates, status, created-by |
| `src/components/estimate-builder/customer-block.tsx` | Read-only customer info from job |
| `src/components/estimate-builder/section-card.tsx` | Section + subsection container |
| `src/components/estimate-builder/subsection-card.tsx` | Nested under a section |
| `src/components/estimate-builder/line-item-row.tsx` | Drag handle + fields + delete |
| `src/components/estimate-builder/totals-panel.tsx` | Sticky bottom-right totals |
| `src/components/estimate-builder/add-item-dialog.tsx` | Library tab + Custom tab |
| `src/components/estimate-builder/template-applicator.tsx` | Disabled placeholder for 67b |
| `src/components/estimate-builder/save-indicator.tsx` | "Saving…" / "Saved at HH:MM" |
| `src/components/estimate-builder/use-estimate.ts` | State + auto-save hook |
| `src/components/item-library/item-form.tsx` | Create/edit form (used inside modal) |
| `src/components/item-library/item-table.tsx` | Library list table + filters |
| `src/components/job-detail/estimates-invoices-section.tsx` | Embedded card on job page |

### Modified files

| Path | Change |
|---|---|
| `src/lib/types.ts` | Add `Estimate`, `EstimateSection`, `EstimateLineItem`, `ItemLibraryItem`, `EstimateTemplate`, `PdfPreset` interfaces; extend `Invoice` |
| `src/components/job-detail.tsx` | Embed `<EstimatesInvoicesSection>` between Billing card and Files |
| `src/components/nav.tsx` | Add new "Catalog" group with "Item Library" link |

---

## Conventions

- Currency math uses `Math.round(n * 100) / 100`; only `formatCurrency()` (display) calls `toFixed(2)`.
- Estimate numbers render in monospace via `font-mono` Tailwind class.
- All API routes follow this skeleton (matches [src/app/api/expenses/route.ts](../../../src/app/api/expenses/route.ts)):

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
```

- Tiptap editor reused via the existing default export at `src/components/tiptap-editor.tsx`.
- Dnd-kit pattern reused from `src/components/form-builder/canvas.tsx` (sections + items in same DndContext, `restrictToVerticalAxis`, `closestCenter`).
- Auto-save pattern from `src/components/form-builder/use-form-config.ts` (1500–2000ms debounce, `lastSavedRef` snapshot, `sonner` toasts).
- Commit messages: lowercase imperative, scope-prefixed (`feat(67a):`, `fix(67a):`, `chore(67a):`). Standard footer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Milestones

- **M1** — Pre-migration cleanup (1 task)
- **M2** — Schema migration (1 task)
- **M3** — TypeScript interfaces (1 task)
- **M4** — Currency formatter (1 task)
- **M5** — Server libs: `estimates.ts`, `item-library.ts` (2 tasks)
- **M6** — API routes: estimates + sections + line-items + library (8 tasks)
- **M7** — Item Library admin page (2 tasks)
- **M8** — Estimate creation flow + builder shell (2 tasks)
- **M9** — Builder pieces: header, metadata, customer (3 tasks)
- **M10** — Builder pieces: sections, line items, add-item dialog (4 tasks)
- **M11** — Builder pieces: totals panel, Tiptap statements (2 tasks)
- **M12** — Drag-and-drop wiring (1 consolidated task)
- **M13** — Auto-save + save indicator (1 task)
- **M14** — Read-only estimate view (1 task)
- **M15** — Job detail integration + nav (2 tasks)
- **M16** — Permission audit + manual test pass + handoff (1 task)

Tasks below are numbered globally.

---

## Task 1: Pre-migration cleanup — delete the test invoice

**Files:** None (DB only).

- [ ] **Step 1: Verify the test invoice still exists**

Run via Supabase MCP `execute_sql` (project `rzzprgidqbnqcdupmpfe`):

```sql
SELECT id, invoice_number, total_amount FROM invoices WHERE id = 'e340eb98-2dce-41a1-aa1c-11fb0ff6b05f';
```

Expected: 1 row, `INV-2026-0001`, `0.07`. If 0 rows, skip to Step 3.

- [ ] **Step 2: Delete the test invoice + its line items**

```sql
DELETE FROM invoice_line_items WHERE invoice_id = 'e340eb98-2dce-41a1-aa1c-11fb0ff6b05f';
DELETE FROM invoices WHERE id = 'e340eb98-2dce-41a1-aa1c-11fb0ff6b05f';
```

- [ ] **Step 3: Verify clean state**

```sql
SELECT count(*) FROM invoices;
SELECT count(*) FROM invoice_line_items;
```

Expected: both 0.

(No commit — DB-only.)

---

## Task 2: Schema migration — `migration-build67a-estimates-foundation.sql`

**Files:**
- Create: `supabase/migration-build67a-estimates-foundation.sql`

- [ ] **Step 1: Create the migration file**

Write the full migration to `supabase/migration-build67a-estimates-foundation.sql`. Contents:

```sql
-- Build 67a — Estimates & Invoices Foundation
-- Spec: docs/superpowers/specs/2026-04-30-build-67a-estimates-foundation-design.md
-- Pre-flight: INV-2026-0001 + its 2 invoice_line_items rows must be deleted before this runs.

-- ============================================================================
-- 1. Drop legacy line_items (Build 6 artifact, 0 rows, superseded by invoice_line_items in Build 38)
-- ============================================================================
DROP TABLE IF EXISTS line_items CASCADE;

-- ============================================================================
-- 2. item_library
-- ============================================================================
CREATE TABLE item_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  code text,
  category text NOT NULL DEFAULT 'services'
    CHECK (category IN ('labor','equipment','materials','services','other')),
  default_quantity numeric(10,2) NOT NULL DEFAULT 1,
  default_unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  damage_type_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_item_library_org ON item_library(organization_id);
CREATE INDEX idx_item_library_category ON item_library(category);
CREATE INDEX idx_item_library_active ON item_library(is_active);
CREATE INDEX idx_item_library_damage_tags ON item_library USING GIN (damage_type_tags);
CREATE INDEX idx_item_library_section_tags ON item_library USING GIN (section_tags);

ALTER TABLE item_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_library
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_item_library_updated_at
  BEFORE UPDATE ON item_library FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 3. estimates
-- ============================================================================
CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  estimate_number text UNIQUE NOT NULL,
  sequence_number integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','approved','rejected','converted','voided')),
  opening_statement text,
  closing_statement text,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  markup_type text NOT NULL DEFAULT 'none'
    CHECK (markup_type IN ('percent','amount','none')),
  markup_value numeric(10,2) NOT NULL DEFAULT 0,
  markup_amount numeric(10,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('percent','amount','none')),
  discount_value numeric(10,2) NOT NULL DEFAULT 0,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  adjusted_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  issued_date date DEFAULT CURRENT_DATE,
  valid_until date,
  converted_to_invoice_id uuid,
  converted_at timestamptz,
  sent_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, sequence_number)
);
CREATE INDEX idx_estimates_org ON estimates(organization_id);
CREATE INDEX idx_estimates_job_id ON estimates(job_id);
CREATE INDEX idx_estimates_status ON estimates(status);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimates
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 4. estimate_sections
-- ============================================================================
CREATE TABLE estimate_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES estimate_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_estimate_sections_org ON estimate_sections(organization_id);
CREATE INDEX idx_estimate_sections_estimate_id ON estimate_sections(estimate_id);
CREATE INDEX idx_estimate_sections_parent ON estimate_sections(parent_section_id);

ALTER TABLE estimate_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimate_sections
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimate_sections_updated_at
  BEFORE UPDATE ON estimate_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 5. estimate_line_items
-- ============================================================================
CREATE TABLE estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES estimate_sections(id) ON DELETE CASCADE,
  library_item_id uuid REFERENCES item_library(id) ON DELETE SET NULL,
  description text NOT NULL,
  code text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_estimate_line_items_org ON estimate_line_items(organization_id);
CREATE INDEX idx_estimate_line_items_estimate_id ON estimate_line_items(estimate_id);
CREATE INDEX idx_estimate_line_items_section_id ON estimate_line_items(section_id);

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimate_line_items
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimate_line_items_updated_at
  BEFORE UPDATE ON estimate_line_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 6. estimate_templates (table only; no UI in 67a)
-- ============================================================================
CREATE TABLE estimate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  damage_type_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  opening_statement text,
  closing_statement text,
  structure jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_estimate_templates_org ON estimate_templates(organization_id);
CREATE INDEX idx_estimate_templates_active ON estimate_templates(is_active);

ALTER TABLE estimate_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimate_templates
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimate_templates_updated_at
  BEFORE UPDATE ON estimate_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 7. pdf_presets (table only; no UI in 67a)
-- ============================================================================
CREATE TABLE pdf_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('estimate','invoice')),
  document_title text NOT NULL,
  group_items_by text NOT NULL DEFAULT 'section',
  show_code boolean NOT NULL DEFAULT true,
  show_description boolean NOT NULL DEFAULT true,
  show_quantity boolean NOT NULL DEFAULT true,
  show_unit_cost boolean NOT NULL DEFAULT true,
  show_total boolean NOT NULL DEFAULT true,
  show_notes boolean NOT NULL DEFAULT false,
  show_markup boolean NOT NULL DEFAULT true,
  show_discount boolean NOT NULL DEFAULT true,
  show_taxes boolean NOT NULL DEFAULT true,
  show_company_details boolean NOT NULL DEFAULT true,
  show_sender_details boolean NOT NULL DEFAULT true,
  show_recipient_details boolean NOT NULL DEFAULT true,
  show_document_details boolean NOT NULL DEFAULT true,
  show_opening_statement boolean NOT NULL DEFAULT true,
  show_line_items boolean NOT NULL DEFAULT true,
  show_category_subtotals boolean NOT NULL DEFAULT false,
  show_total_cost boolean NOT NULL DEFAULT true,
  show_closing_statement boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_presets_org ON pdf_presets(organization_id);
CREATE INDEX idx_pdf_presets_document_type ON pdf_presets(document_type);
CREATE UNIQUE INDEX idx_pdf_presets_one_default_per_type
  ON pdf_presets(organization_id, document_type) WHERE is_default = true;

ALTER TABLE pdf_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pdf_presets
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_pdf_presets_updated_at
  BEFORE UPDATE ON pdf_presets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 8. invoice_sections (table only; no UI in 67a — 67b will use it)
-- ============================================================================
CREATE TABLE invoice_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_sections_org ON invoice_sections(organization_id);
CREATE INDEX idx_invoice_sections_invoice_id ON invoice_sections(invoice_id);

ALTER TABLE invoice_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_sections
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_invoice_sections_updated_at
  BEFORE UPDATE ON invoice_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 9. ALTER invoices to add 67-era columns (Build 6 + 38 → Build 67)
--    Pre-flight: INV-2026-0001 already deleted by Task 1.
-- ============================================================================
ALTER TABLE invoices
  ADD COLUMN sequence_number integer,
  ADD COLUMN title text,
  ADD COLUMN opening_statement text,
  ADD COLUMN closing_statement text,
  ADD COLUMN markup_type text NOT NULL DEFAULT 'none'
    CHECK (markup_type IN ('percent','amount','none')),
  ADD COLUMN markup_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN markup_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_type text NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('percent','amount','none')),
  ADD COLUMN discount_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN adjusted_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN converted_from_estimate_id uuid REFERENCES estimates(id),
  ADD COLUMN void_reason text,
  ADD COLUMN created_by uuid REFERENCES user_profiles(id);

ALTER TABLE invoices
  ALTER COLUMN sequence_number SET NOT NULL,
  ALTER COLUMN title SET NOT NULL;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_job_seq_unique UNIQUE (job_id, sequence_number);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','sent','partial','paid','voided'));

-- ============================================================================
-- 10. ALTER invoice_line_items to add 67-era columns
--     Existing columns from Build 38 already cover several needs:
--       - sort_order (already integer NOT NULL DEFAULT 0)
--       - xactimate_code (text — surfaced as `code` in TS via mapper)
--       - amount (surfaced as `total` in TS via mapper)
--     This ALTER only adds section_id, library_item_id, unit.
-- ============================================================================
ALTER TABLE invoice_line_items
  ADD COLUMN section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  ADD COLUMN library_item_id uuid REFERENCES item_library(id) ON DELETE SET NULL,
  ADD COLUMN unit text;

CREATE INDEX idx_invoice_line_items_section_id ON invoice_line_items(section_id);
CREATE INDEX idx_invoice_line_items_library_item_id ON invoice_line_items(library_item_id);

-- ============================================================================
-- 11. Cross-FK: estimates.converted_to_invoice_id -> invoices.id
-- ============================================================================
ALTER TABLE estimates
  ADD CONSTRAINT fk_estimates_converted_to_invoice
  FOREIGN KEY (converted_to_invoice_id) REFERENCES invoices(id);

-- ============================================================================
-- 12. RPC: generate_estimate_number(p_job_id) — atomic per-job sequence
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_estimate_number(p_job_id uuid)
RETURNS TABLE(estimate_number text, sequence_number integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_job_number text;
  v_seq integer;
BEGIN
  SELECT job_number INTO v_job_number
    FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job_number IS NULL THEN
    RAISE EXCEPTION 'job % not found or not visible to caller', p_job_id;
  END IF;
  SELECT COALESCE(MAX(e.sequence_number), 0) + 1 INTO v_seq
    FROM estimates e WHERE e.job_id = p_job_id;
  estimate_number := v_job_number || '-EST-' || v_seq;
  sequence_number := v_seq;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_estimate_number(uuid) TO authenticated;

-- ============================================================================
-- 13. RPC: generate_invoice_number(p_job_id) — same shape, INV suffix
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_invoice_number(p_job_id uuid)
RETURNS TABLE(invoice_number text, sequence_number integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_job_number text;
  v_seq integer;
BEGIN
  SELECT job_number INTO v_job_number
    FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job_number IS NULL THEN
    RAISE EXCEPTION 'job % not found or not visible to caller', p_job_id;
  END IF;
  SELECT COALESCE(MAX(i.sequence_number), 0) + 1 INTO v_seq
    FROM invoices i WHERE i.job_id = p_job_id;
  invoice_number := v_job_number || '-INV-' || v_seq;
  sequence_number := v_seq;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_invoice_number(uuid) TO authenticated;

-- ============================================================================
-- 14. Seed company_settings keys per organization
-- ============================================================================
INSERT INTO company_settings (organization_id, key, value)
SELECT o.id, kv.key, kv.value
FROM organizations o
CROSS JOIN (VALUES
  ('default_tax_rate', '0.00'),
  ('default_estimate_opening_statement', ''),
  ('default_estimate_closing_statement', ''),
  ('default_invoice_opening_statement', ''),
  ('default_invoice_closing_statement', ''),
  ('default_estimate_valid_days', '30'),
  ('default_invoice_due_days', '30')
) AS kv(key, value)
ON CONFLICT (organization_id, key) DO NOTHING;

-- ============================================================================
-- 15. Extend set_default_permissions with the 12 new keys + backfill
-- ============================================================================
DROP FUNCTION IF EXISTS public.set_default_permissions(uuid, text);
CREATE OR REPLACE FUNCTION public.set_default_permissions(p_user_organization_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  all_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports', 'access_settings',
    'log_expenses', 'manage_vendors', 'manage_contract_templates', 'manage_expense_categories',
    'view_accounting', 'manage_accounting',
    -- Build 67a
    'view_estimates', 'view_invoices',
    'create_estimates', 'edit_estimates', 'convert_estimates', 'send_estimates',
    'create_invoices', 'edit_invoices', 'send_invoices',
    'manage_item_library', 'manage_templates', 'manage_pdf_presets'
  ];
  admin_perms text[] := all_perms;
  lead_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports',
    'log_expenses',
    -- Build 67a
    'view_estimates', 'view_invoices',
    'create_estimates', 'edit_estimates', 'convert_estimates', 'send_estimates',
    'create_invoices', 'edit_invoices', 'send_invoices'
  ];
  member_perms text[] := array[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses',
    -- Build 67a
    'view_estimates', 'view_invoices'
  ];
  granted_perms text[];
  perm text;
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id FROM public.user_organizations WHERE id = p_user_organization_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_default_permissions: user_organization % not found', p_user_organization_id;
  END IF;

  IF p_role = 'admin' THEN
    granted_perms := admin_perms;
  ELSIF p_role = 'crew_lead' THEN
    granted_perms := lead_perms;
  ELSE
    granted_perms := member_perms;
  END IF;

  FOREACH perm IN ARRAY all_perms LOOP
    INSERT INTO public.user_organization_permissions (user_organization_id, permission_key, granted)
    VALUES (p_user_organization_id, perm, perm = ANY(granted_perms))
    ON CONFLICT (user_organization_id, permission_key) DO UPDATE SET granted = excluded.granted;

    -- Legacy mirror — kept in sync per build48 plan
    INSERT INTO public.user_permissions (user_id, permission_key, granted)
    VALUES (v_user_id, perm, perm = ANY(granted_perms))
    ON CONFLICT (user_id, permission_key) DO UPDATE SET granted = excluded.granted;
  END LOOP;
END;
$$;

-- Backfill: re-run for every existing membership so new permission keys propagate.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, role FROM public.user_organizations LOOP
    PERFORM public.set_default_permissions(r.id, r.role);
  END LOOP;
END $$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__31d06679-..._apply_migration` with project `rzzprgidqbnqcdupmpfe`, name `build67a_estimates_foundation`, body = full file contents.

- [ ] **Step 3: Verify all tables exist and RLS enabled**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('item_library','estimates','estimate_sections','estimate_line_items',
                    'estimate_templates','pdf_presets','invoice_sections')
ORDER BY tablename;
```

Expected: 7 rows, `rowsecurity = true` for all.

- [ ] **Step 4: Verify RPCs callable**

```sql
SELECT proname FROM pg_proc WHERE proname IN ('generate_estimate_number','generate_invoice_number');
```

Expected: 2 rows.

- [ ] **Step 5: Verify settings seeded for AAA + TestCo**

```sql
SELECT o.name, count(*) FROM organizations o
JOIN company_settings cs ON cs.organization_id = o.id
WHERE cs.key IN ('default_tax_rate','default_estimate_opening_statement','default_estimate_closing_statement',
                 'default_invoice_opening_statement','default_invoice_closing_statement',
                 'default_estimate_valid_days','default_invoice_due_days')
GROUP BY o.name;
```

Expected: 7 per org.

- [ ] **Step 6: Verify permission seed**

```sql
SELECT permission_key, count(*)
FROM user_organization_permissions
WHERE permission_key IN ('view_estimates','create_estimates','manage_item_library','manage_pdf_presets')
GROUP BY permission_key;
```

Expected: 4 rows, count >= 1 each.

- [ ] **Step 7: Verify legacy `line_items` is gone, `invoices` extended**

```sql
SELECT 'line_items_exists' AS check, count(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='line_items';
SELECT count(*) AS new_invoices_cols FROM information_schema.columns
  WHERE table_schema='public' AND table_name='invoices'
    AND column_name IN ('sequence_number','title','markup_type','adjusted_subtotal','converted_from_estimate_id');
```

Expected: `line_items_exists = 0`, `new_invoices_cols = 5`.

- [ ] **Step 8: Commit the migration file**

```bash
git add supabase/migration-build67a-estimates-foundation.sql
git commit -m "$(cat <<'EOF'
feat(67a): schema migration — estimates, item library, sections, RLS

Drops legacy line_items (Build 6 artifact, 0 rows). Creates 7 new tables
(item_library, estimates, estimate_sections, estimate_line_items,
estimate_templates, pdf_presets, invoice_sections) — all org-scoped with
tenant_isolation RLS. Alters invoices and invoice_line_items in place to
add the 67-era columns (sequence_number, title, markup/discount/tax,
section_id, etc.). Adds two atomic numbering RPCs and extends
set_default_permissions with 12 new permission keys, backfilled across
existing memberships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TypeScript interfaces — extend `src/lib/types.ts`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Read existing `Invoice` interface to know what's there**

Open `src/lib/types.ts` and locate the `Invoice` interface so the extension below merges cleanly.

- [ ] **Step 2: Append new interfaces and extend `Invoice`**

Add at the bottom of `src/lib/types.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Build 67a — Estimates & Invoices
// ─────────────────────────────────────────────────────────────────────────────

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'converted' | 'voided';
export type AdjustmentType = 'percent' | 'amount' | 'none';
export type ItemCategory = 'labor' | 'equipment' | 'materials' | 'services' | 'other';

export interface Estimate {
  id: string;
  organization_id: string;
  job_id: string;
  estimate_number: string;
  sequence_number: number;
  title: string;
  status: EstimateStatus;
  opening_statement: string | null;
  closing_statement: string | null;
  subtotal: number;
  markup_type: AdjustmentType;
  markup_value: number;
  markup_amount: number;
  discount_type: AdjustmentType;
  discount_value: number;
  discount_amount: number;
  adjusted_subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  issued_date: string | null;
  valid_until: string | null;
  converted_to_invoice_id: string | null;
  converted_at: string | null;
  sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EstimateSection {
  id: string;
  organization_id: string;
  estimate_id: string;
  parent_section_id: string | null;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EstimateLineItem {
  id: string;
  organization_id: string;
  estimate_id: string;
  section_id: string;
  library_item_id: string | null;
  description: string;
  code: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ItemLibraryItem {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  code: string | null;
  category: ItemCategory;
  default_quantity: number;
  default_unit: string | null;
  unit_price: number;
  damage_type_tags: string[];
  section_tags: string[];
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Convenience: a fully-loaded estimate with nested sections + items.
export interface EstimateWithContents extends Estimate {
  sections: Array<EstimateSection & {
    items: EstimateLineItem[];
    subsections: Array<EstimateSection & { items: EstimateLineItem[] }>;
  }>;
}

// Schema-only in 67a (no UI). Defined here so 67b/c don't reshape types later.
export interface EstimateTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  damage_type_tags: string[];
  opening_statement: string | null;
  closing_statement: string | null;
  structure: { sections: Array<{
    title: string;
    sort_order: number;
    subsections: Array<{ title: string; sort_order: number; items: TemplateItem[] }>;
    items: TemplateItem[];
  }> };
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateItem {
  library_item_id: string;
  description_override: string | null;
  quantity_override: number | null;
  unit_price_override: number | null;
  sort_order: number;
}

export interface PdfPreset {
  id: string;
  organization_id: string;
  name: string;
  document_type: 'estimate' | 'invoice';
  document_title: string;
  group_items_by: 'section';
  show_code: boolean;
  show_description: boolean;
  show_quantity: boolean;
  show_unit_cost: boolean;
  show_total: boolean;
  show_notes: boolean;
  show_markup: boolean;
  show_discount: boolean;
  show_taxes: boolean;
  show_company_details: boolean;
  show_sender_details: boolean;
  show_recipient_details: boolean;
  show_document_details: boolean;
  show_opening_statement: boolean;
  show_line_items: boolean;
  show_category_subtotals: boolean;
  show_total_cost: boolean;
  show_closing_statement: boolean;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

Then locate the existing `Invoice` interface and add these fields (only the ones missing):

```ts
sequence_number: number;
title: string;
opening_statement: string | null;
closing_statement: string | null;
markup_type: AdjustmentType;
markup_value: number;
markup_amount: number;
discount_type: AdjustmentType;
discount_value: number;
discount_amount: number;
adjusted_subtotal: number;
converted_from_estimate_id: string | null;
void_reason: string | null;
created_by: string | null;
```

The existing `Invoice.total` (mapped from DB `total_amount`) stays as-is. Mapping happens at the API-route boundary in 67b — for 67a the existing read paths are untouched.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If there are errors in pre-existing files unrelated to this task, note them and continue.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "$(cat <<'EOF'
feat(67a): add Estimate / EstimateSection / EstimateLineItem / ItemLibrary types

Plus EstimateTemplate, TemplateItem, PdfPreset (schema-only — used in
67b/c). Extends Invoice with the 14 new 67-era columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Currency formatter — `src/lib/format.ts`

**Files:**
- Create: `src/lib/format.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/format.ts`:

```ts
// Shared currency formatter — used by estimate/invoice builders, totals
// panels, and read-only views. Server-side math elsewhere uses
// Math.round(n * 100) / 100; only display passes through here.

export function formatCurrency(n: number): string {
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Round to 2 decimals for monetary math. Use this any time you compute
// a total / subtotal / tax amount — never .toFixed (which returns string).
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/format.ts
git commit -m "$(cat <<'EOF'
feat(67a): add formatCurrency + round2 helpers in src/lib/format.ts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Server lib — `src/lib/estimates.ts`

**Files:**
- Create: `src/lib/estimates.ts`

This file owns the recalc transaction, the numbering RPC wrapper, and the loaded-with-children fetch shape. API routes import from here.

- [ ] **Step 1: Write the file**

Create `src/lib/estimates.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Estimate,
  EstimateLineItem,
  EstimateSection,
  EstimateWithContents,
} from "@/lib/types";
import { round2 } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// Numbering — atomic per-job sequence via RPC (uses SELECT FOR UPDATE in SQL)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateEstimateNumber(
  jobId: string,
  supabase: SupabaseClient,
): Promise<{ estimate_number: string; sequence_number: number }> {
  const { data, error } = await supabase
    .rpc("generate_estimate_number", { p_job_id: jobId });
  if (error) throw new Error(`generate_estimate_number failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("generate_estimate_number returned no row");
  return data[0] as { estimate_number: string; sequence_number: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaded fetch — returns estimate + sections (one level of nesting) + items
// ─────────────────────────────────────────────────────────────────────────────

export async function getEstimateWithContents(
  estimateId: string,
  supabase: SupabaseClient,
): Promise<EstimateWithContents | null> {
  const { data: estimate, error: estErr } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", estimateId)
    .maybeSingle<Estimate>();
  if (estErr) throw new Error(`getEstimate failed: ${estErr.message}`);
  if (!estimate) return null;

  const { data: sections, error: secErr } = await supabase
    .from("estimate_sections")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .returns<EstimateSection[]>();
  if (secErr) throw new Error(`getSections failed: ${secErr.message}`);

  const { data: items, error: itemErr } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .returns<EstimateLineItem[]>();
  if (itemErr) throw new Error(`getLineItems failed: ${itemErr.message}`);

  const allSections = sections ?? [];
  const allItems = items ?? [];
  const topLevel = allSections.filter((s) => s.parent_section_id === null);
  const subsByParent = new Map<string, EstimateSection[]>();
  for (const s of allSections) {
    if (s.parent_section_id) {
      const arr = subsByParent.get(s.parent_section_id) ?? [];
      arr.push(s);
      subsByParent.set(s.parent_section_id, arr);
    }
  }
  const itemsBySection = new Map<string, EstimateLineItem[]>();
  for (const it of allItems) {
    const arr = itemsBySection.get(it.section_id) ?? [];
    arr.push(it);
    itemsBySection.set(it.section_id, arr);
  }

  return {
    ...estimate,
    sections: topLevel.map((sec) => ({
      ...sec,
      items: itemsBySection.get(sec.id) ?? [],
      subsections: (subsByParent.get(sec.id) ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((sub) => ({
          ...sub,
          items: itemsBySection.get(sub.id) ?? [],
        })),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// recalculateTotals — server source of truth
// Called after every mutation that affects line items, markup, discount, or tax.
// Does NOT use a multi-statement transaction (Supabase JS limitation); the
// final UPDATE is the only writer of the cached values, and reads happen
// fresh in this function, so concurrent recalc calls converge.
// ─────────────────────────────────────────────────────────────────────────────

export async function recalculateTotals(
  estimateId: string,
  supabase: SupabaseClient,
): Promise<void> {
  // 1. Fetch line items
  const { data: items, error: itemErr } = await supabase
    .from("estimate_line_items")
    .select("id, quantity, unit_price, total")
    .eq("estimate_id", estimateId);
  if (itemErr) throw new Error(`recalc fetch items: ${itemErr.message}`);

  // 2. Defensive: write back any drifted line totals
  const lineUpdates: Array<{ id: string; total: number }> = [];
  for (const li of (items ?? []) as Array<{ id: string; quantity: number; unit_price: number; total: number }>) {
    const want = round2(Number(li.quantity) * Number(li.unit_price));
    if (want !== Number(li.total)) {
      lineUpdates.push({ id: li.id, total: want });
    }
  }
  if (lineUpdates.length > 0) {
    for (const u of lineUpdates) {
      const { error } = await supabase
        .from("estimate_line_items")
        .update({ total: u.total })
        .eq("id", u.id);
      if (error) throw new Error(`recalc write line: ${error.message}`);
    }
  }

  // 3. Subtotal from authoritative line totals
  const subtotal = round2(
    ((items ?? []) as Array<{ quantity: number; unit_price: number }>)
      .reduce((acc, li) => acc + Number(li.quantity) * Number(li.unit_price), 0),
  );

  // 4. Load adjustment fields
  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .select("markup_type, markup_value, discount_type, discount_value, tax_rate")
    .eq("id", estimateId)
    .maybeSingle<{
      markup_type: "percent" | "amount" | "none";
      markup_value: number;
      discount_type: "percent" | "amount" | "none";
      discount_value: number;
      tax_rate: number;
    }>();
  if (estErr) throw new Error(`recalc fetch est: ${estErr.message}`);
  if (!est) throw new Error(`estimate ${estimateId} not found during recalc`);

  // 5. Markup
  let markup_amount = 0;
  if (est.markup_type === "amount") markup_amount = round2(Number(est.markup_value));
  else if (est.markup_type === "percent") markup_amount = round2(subtotal * Number(est.markup_value) / 100);

  // 6. Discount
  let discount_amount = 0;
  if (est.discount_type === "amount") discount_amount = round2(Number(est.discount_value));
  else if (est.discount_type === "percent") discount_amount = round2(subtotal * Number(est.discount_value) / 100);

  // 7. Adjusted subtotal
  const adjusted_subtotal = round2(subtotal + markup_amount - discount_amount);

  // 8. Tax
  const tax_amount = round2(adjusted_subtotal * Number(est.tax_rate) / 100);

  // 9. Total
  const total = round2(adjusted_subtotal + tax_amount);

  // 10. Write back
  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      subtotal,
      markup_amount,
      discount_amount,
      adjusted_subtotal,
      tax_amount,
      total,
    })
    .eq("id", estimateId);
  if (updErr) throw new Error(`recalc write totals: ${updErr.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// One-level-only nesting validation
// ─────────────────────────────────────────────────────────────────────────────

export async function assertSectionDepth(
  parentSectionId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const { data, error } = await supabase
    .from("estimate_sections")
    .select("parent_section_id")
    .eq("id", parentSectionId)
    .maybeSingle<{ parent_section_id: string | null }>();
  if (error) throw new Error(`assertSectionDepth: ${error.message}`);
  if (!data) throw new Error("parent section not found");
  if (data.parent_section_id !== null) {
    throw new Error("Sections cannot nest more than one level deep");
  }
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/estimates.ts
git commit -m "$(cat <<'EOF'
feat(67a): src/lib/estimates.ts — recalc, numbering, loaded fetch

generateEstimateNumber wraps the generate_estimate_number RPC.
getEstimateWithContents loads an estimate + sections + items in three
queries and assembles the nested shape. recalculateTotals reads line
items, defensively rewrites drifted line totals, then computes subtotal
→ markup → discount → adjusted subtotal → tax → total per spec §6, all
2-decimal rounded via round2().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Server lib — `src/lib/item-library.ts`

**Files:**
- Create: `src/lib/item-library.ts`

- [ ] **Step 1: Write the file**

Create `src/lib/item-library.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemLibraryItem, ItemCategory } from "@/lib/types";

export interface ListItemsFilters {
  search?: string;
  category?: ItemCategory;
  damage_type?: string;
  is_active?: boolean;
}

export async function listItems(
  filters: ListItemsFilters,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem[]> {
  let q = supabase.from("item_library").select("*");
  if (filters.category) q = q.eq("category", filters.category);
  if (typeof filters.is_active === "boolean") q = q.eq("is_active", filters.is_active);
  if (filters.damage_type) q = q.contains("damage_type_tags", [filters.damage_type]);
  if (filters.search) {
    const s = filters.search;
    q = q.or(`name.ilike.%${s}%,description.ilike.%${s}%,code.ilike.%${s}%`);
  }
  q = q.order("sort_order", { ascending: true }).order("name", { ascending: true });
  const { data, error } = await q.returns<ItemLibraryItem[]>();
  if (error) throw new Error(`listItems failed: ${error.message}`);
  return data ?? [];
}

export async function getItem(
  id: string,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem | null> {
  const { data, error } = await supabase
    .from("item_library")
    .select("*")
    .eq("id", id)
    .maybeSingle<ItemLibraryItem>();
  if (error) throw new Error(`getItem failed: ${error.message}`);
  return data;
}

export interface CreateItemInput {
  name: string;
  description: string;
  code?: string | null;
  category: ItemCategory;
  default_quantity: number;
  default_unit?: string | null;
  unit_price: number;
  damage_type_tags?: string[];
  section_tags?: string[];
}

export async function createItem(
  input: CreateItemInput,
  organizationId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem> {
  const { data, error } = await supabase
    .from("item_library")
    .insert({
      organization_id: organizationId,
      created_by: userId,
      name: input.name,
      description: input.description,
      code: input.code ?? null,
      category: input.category,
      default_quantity: input.default_quantity,
      default_unit: input.default_unit ?? null,
      unit_price: input.unit_price,
      damage_type_tags: input.damage_type_tags ?? [],
      section_tags: input.section_tags ?? [],
    })
    .select("*")
    .single<ItemLibraryItem>();
  if (error) throw new Error(`createItem failed: ${error.message}`);
  return data;
}

export type UpdateItemInput = Partial<CreateItemInput>;

export async function updateItem(
  id: string,
  input: UpdateItemInput,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem> {
  const { data, error } = await supabase
    .from("item_library")
    .update(input)
    .eq("id", id)
    .select("*")
    .single<ItemLibraryItem>();
  if (error) throw new Error(`updateItem failed: ${error.message}`);
  return data;
}

export async function deactivateItem(id: string, supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from("item_library").update({ is_active: false }).eq("id", id);
  if (error) throw new Error(`deactivateItem failed: ${error.message}`);
}

export async function reactivateItem(id: string, supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from("item_library").update({ is_active: true }).eq("id", id);
  if (error) throw new Error(`reactivateItem failed: ${error.message}`);
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/item-library.ts
git commit -m "$(cat <<'EOF'
feat(67a): src/lib/item-library.ts — CRUD with filter helpers

Org scoping is handled by RLS — callers must already be inside an
authenticated supabase client whose JWT carries the active organization.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: API route — `POST /api/estimates`, `GET /api/estimates?job_id=`

**Files:**
- Create: `src/app/api/estimates/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/estimates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { generateEstimateNumber } from "@/lib/estimates";
import type { Estimate } from "@/lib/types";

interface CreatePayload {
  job_id: string;
  title?: string;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "create_estimates");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as CreatePayload;
  if (!body.job_id) return NextResponse.json({ error: "job_id required" }, { status: 400 });

  const orgId = await getActiveOrganizationId(supabase);

  // Default title from settings if not supplied
  let title = body.title?.trim();
  if (!title) {
    const { data: setting } = await supabase
      .from("company_settings")
      .select("value")
      .eq("organization_id", orgId)
      .eq("key", "default_estimate_title")
      .maybeSingle();
    title = setting?.value || "Estimate";
  }

  const numbered = await generateEstimateNumber(body.job_id, supabase);

  const { data: estimate, error } = await supabase
    .from("estimates")
    .insert({
      organization_id: orgId,
      job_id: body.job_id,
      estimate_number: numbered.estimate_number,
      sequence_number: numbered.sequence_number,
      title,
      status: "draft",
      created_by: auth.userId,
    })
    .select("*")
    .single<Estimate>();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ estimate }, { status: 201 });
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "job_id query param required" }, { status: 400 });

  const { data, error } = await supabase
    .from("estimates")
    .select("*")
    .eq("job_id", jobId)
    .order("sequence_number", { ascending: true })
    .returns<Estimate[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ estimates: data ?? [] });
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/estimates/route.ts
git commit -m "$(cat <<'EOF'
feat(67a): POST /api/estimates + GET /api/estimates?job_id=

POST creates a draft via the atomic generate_estimate_number RPC and
returns the estimate. GET lists by job, ordered by sequence_number.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: API route — `/api/estimates/[id]`

**Files:**
- Create: `src/app/api/estimates/[id]/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/estimates/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getEstimateWithContents, recalculateTotals } from "@/lib/estimates";
import type { Estimate } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

interface UpdatePayload {
  title?: string;
  opening_statement?: string | null;
  closing_statement?: string | null;
  issued_date?: string | null;
  valid_until?: string | null;
  markup_type?: "percent" | "amount" | "none";
  markup_value?: number;
  discount_type?: "percent" | "amount" | "none";
  discount_value?: number;
  tax_rate?: number;
  status?: Estimate["status"];
  updated_at_snapshot?: string;
}

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const estimate = await getEstimateWithContents(id, supabase);
  if (!estimate) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ estimate });
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as UpdatePayload;

  // Concurrent-edit guard
  if (body.updated_at_snapshot) {
    const { data: current } = await supabase
      .from("estimates")
      .select("updated_at")
      .eq("id", id)
      .maybeSingle<{ updated_at: string }>();
    if (current && current.updated_at !== body.updated_at_snapshot) {
      const fresh = await getEstimateWithContents(id, supabase);
      return NextResponse.json({ error: "stale", estimate: fresh }, { status: 409 });
    }
  }

  const update: Record<string, unknown> = {};
  for (const k of ["title","opening_statement","closing_statement","issued_date","valid_until",
                    "markup_type","markup_value","discount_type","discount_value","tax_rate","status"] as const) {
    if (k in body && body[k] !== undefined) update[k] = body[k];
  }
  if (body.tax_rate !== undefined) {
    if (body.tax_rate < 0 || body.tax_rate > 100) {
      return NextResponse.json({ error: "tax_rate must be between 0 and 100" }, { status: 400 });
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("estimates").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Always recalc — markup/discount/tax may have changed
  await recalculateTotals(id, supabase);

  const fresh = await getEstimateWithContents(id, supabase);
  return NextResponse.json({ estimate: fresh });
}

export async function DELETE(request: Request, ctx: RouteCtx) {
  // DELETE = void (no hard delete)
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const reason = url.searchParams.get("reason");

  const { error } = await supabase
    .from("estimates")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      void_reason: reason,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/estimates/[id]/route.ts
git commit -m "$(cat <<'EOF'
feat(67a): GET / PUT / DELETE /api/estimates/[id]

GET returns the loaded estimate (sections + subsections + items).
PUT updates metadata + adjustments and triggers recalculateTotals;
returns 409 with the fresh estimate when updated_at_snapshot drifts.
DELETE voids (no hard delete) — sets status=voided + voided_at +
void_reason from ?reason= query param.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: API route — `/api/estimates/[id]/sections`

**Files:**
- Create: `src/app/api/estimates/[id]/sections/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/estimates/[id]/sections/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { assertSectionDepth } from "@/lib/estimates";
import type { EstimateSection } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

interface CreatePayload {
  title: string;
  parent_section_id?: string | null;
  sort_order?: number;
}

interface ReorderPayload {
  sections: Array<{ id: string; sort_order: number; parent_section_id: string | null }>;
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as CreatePayload;
  if (!body.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });

  if (body.parent_section_id) {
    try {
      await assertSectionDepth(body.parent_section_id, supabase);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const orgId = await getActiveOrganizationId(supabase);

  // Compute sort_order if not given
  let sort_order = body.sort_order;
  if (sort_order === undefined) {
    const { data: max } = await supabase
      .from("estimate_sections")
      .select("sort_order")
      .eq("estimate_id", estimateId)
      .is("parent_section_id", body.parent_section_id ?? null)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();
    sort_order = (max?.sort_order ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("estimate_sections")
    .insert({
      organization_id: orgId,
      estimate_id: estimateId,
      parent_section_id: body.parent_section_id ?? null,
      title: body.title.trim(),
      sort_order,
    })
    .select("*")
    .single<EstimateSection>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ section: data }, { status: 201 });
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as ReorderPayload;
  if (!Array.isArray(body.sections)) {
    return NextResponse.json({ error: "sections array required" }, { status: 400 });
  }

  for (const s of body.sections) {
    const { error } = await supabase
      .from("estimate_sections")
      .update({ sort_order: s.sort_order, parent_section_id: s.parent_section_id })
      .eq("id", s.id)
      .eq("estimate_id", estimateId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/estimates/[id]/sections/route.ts
git commit -m "$(cat <<'EOF'
feat(67a): POST + PUT /api/estimates/[id]/sections

POST creates a section under the estimate, validating one-level
nesting. Auto-computes next sort_order if omitted. PUT bulk-reorders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

The plan continues with Tasks 10–30 in subsequent files due to size. Saving here and continuing in a follow-up commit so the plan stays committable in chunks.

---

## Tasks 10–30 (continuation)

The remaining tasks are written in a continuation file: `docs/superpowers/plans/2026-04-30-build-67a-estimates-foundation-part2.md`. The split is mechanical — one plan, two files — because a single 4000+ line markdown file becomes hard to navigate.

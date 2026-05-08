---
date: 2026-04-30
build_id: 67a
status: design-approved
author: Claude (Eric authoring)
related:
  - "[[build-14a]]"
  - "[[build-14d]]"
  - "[[build-17c]]"
  - "[[build-18a]]"
  - "[[build-66]]"
source_prompt: ~/Downloads/Nookleus-Estimates-Invoices-Build-Guide-v1.md
---

# Build 67a — Estimates & Invoices Foundation

## 1. Why this exists

Replace the bare-bones invoicing system (Build 6 + Build 38 / 17) with a complete estimate-and-invoice platform that lets Eric retire Magicplan. Build 67a delivers the data foundation, the Item Library admin UX, and end-to-end estimate creation/editing/viewing on the job page. Templates, estimate-to-invoice conversion, the invoice editor UI, PDF generation, and email shipping are deferred to Build 67b and 67c.

After 67a ships, the user can:

- Manage a reusable, org-scoped item library (Air Mover, Dehumidifier, Initial Response, etc.).
- Create estimates on a job with hierarchical sections (sections + one level of subsections) and line items.
- Add line items from the library or as one-off custom items.
- Reorder sections, subsections, and line items via drag-and-drop.
- See live totals with markup, discount, and tax that recalculate as values change.
- Auto-save the estimate every ~2 seconds.
- Void estimates.
- See estimates listed on the job detail page.

**Build label rationale.** "Build 18a" already shipped (multi-tenant infra). The next sequential migration counter is 67. Estimates → Invoices → Conversion → PDF naturally splits into three sub-builds, so the labels are 67a / 67b / 67c.

## 2. Why the original prompt needs revision

The build guide (`~/Downloads/Nookleus-Estimates-Invoices-Build-Guide-v1.md`) was authored against a snapshot of the platform that's about a year stale. Six of its assumptions clash with current Nookleus state. Each has been resolved:

| Original assumption | Current state | Resolution |
|---|---|---|
| Build label "18a" | Build 18a is multi-tenant infra (migrations build42–54) | Relabel to **67a / 67b / 67c** |
| Single-tenant; no RLS | Every existing table has `organization_id NOT NULL` + RLS enforced (Build 18b) | New tables get `organization_id` + tenant-scoped RLS from day 1 |
| Migrations at `supabase/migrations/<timestamp>_*.sql` | Repo uses flat `supabase/migration-build<NN>-*.sql` | Single migration: `supabase/migration-build67a-estimates-foundation.sql` |
| `invoices` is empty; drop and rebuild | 1 row (Build 17 test, $0.07), 2 `invoice_line_items` rows, QB-sync triggers, 35 source files referencing it | **ALTER, not drop.** Eric will delete the test invoice; no backfill needed |
| Permissions in `user_permissions(user_id, permission_key)` | Deprecated in Build 48; canonical is `user_organization_permissions(user_organization_id, permission_key)` | Extend `set_default_permissions(p_user_organization_id, p_role)` array literals |
| References `/mnt/project/*.docx` build guide files | Those paths don't exist on Eric's Windows machine | Use the attached `~/Downloads/Nookleus-Estimates-Invoices-Build-Guide-v1.md` |

## 3. Scope

### In scope (67a)

- Schema: all new estimate/library/template/preset/section tables; ALTER `invoices` and `invoice_line_items` to support sections + statements + markup/discount/adjusted_subtotal; drop legacy `line_items`.
- Item Library admin page (`/settings/item-library`) — list, search, filter, create, edit, deactivate. Org-scoped.
- Estimate creation flow (`/jobs/[id]/estimates/new` → redirect to `/estimates/[id]/edit`).
- Estimate builder (`/estimates/[id]/edit`): three-region layout (header bar / metadata + customer / sections + totals), Tiptap opening + closing statements, drag-and-drop reorder for sections / subsections / line items, sticky totals panel with markup + discount + tax controls, auto-save every ~2s, visible save indicator.
- Add Item dialog (Library tab + Custom tab).
- Read-only estimate view (`/estimates/[id]`) — basic HTML rendering.
- Estimates list on job detail (`src/components/job-detail.tsx`) between Billing card and Files.
- Sidebar nav: new "Catalog" group with "Item Library" link.
- Permissions: 12 new keys wired into `set_default_permissions` and enforced on every API route.
- Schema-only (no UI): `estimate_templates`, `pdf_presets`, `invoice_sections`. Created so 67b/c don't need schema changes.

### Out of scope (deferred)

| Feature | Build |
|---|---|
| Estimate templates UI + apply-to-estimate | 67b |
| Estimate-to-invoice conversion | 67b |
| Invoice editor UI (reuse builder shell) | 67b |
| PDF preset manager UI | 67c |
| PDF generation + storage | 67c |
| Email sending of estimates / invoices | 67c |
| Signature blocks on estimates / invoices | (cut; Build 15 owns contracts) |
| Per-line-item taxable toggle | (cut; single tax rate on adjusted subtotal) |
| File attachments on estimates / invoices | (cut; attachments belong on the job) |

## 4. Architectural decisions

Inherited from the build guide where unchanged:

- **Estimate-as-historical-record.** On conversion (67b), original estimate stays with `status='converted'`; a new invoice is created with bidirectional `converted_from_estimate_id` / `converted_to_invoice_id` links.
- **Library items snapshotted into estimates.** `estimate_line_items.description / code / unit_price` are copied at insert time; updating the library item later does not retro-affect estimates.
- **Job-derived numbering.** `${jobs.job_number}-EST-${seq}` and `${jobs.job_number}-INV-${seq}` (per-job, per-doc-type sequence). Atomic via `SELECT FOR UPDATE` on the parent job row.
- **Post-adjustment tax.** `tax_amount = (subtotal + markup_amount − discount_amount) * tax_rate / 100`.
- **Server-side recalc on save.** Client computes live for UX; server is source of truth via `recalculateTotals(estimateId, supabase)` in a transaction.
- **PDF presets as first-class entities** — schema only in 67a.

Added by this revision:

- **Multi-tenant from day 1.** Every new table has `organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`. RLS policies follow [migration-build49](../../../supabase/migration-build49-rls-policies-written-not-enforced.sql) / [build57](../../../supabase/migration-build57-drop-allow-all-policies.sql) — the standard `tenant_isolation` pattern: `USING (organization_id = nookleus.active_organization_id())`.
- **No invoice-data churn.** `invoices` is altered in place; existing column `total_amount` stays (35 source files reference it). The build guide's `total` column maps to existing `total_amount` in TypeScript types but the column name doesn't change.
- **`invoice_line_items` keeps `amount`.** Adding `section_id` (FK to new `invoice_sections`) + `library_item_id`, `code`, `unit`, `sort_order`. The Build 38 column `amount` continues to mean the same thing as `estimate_line_items.total`.
- **Auth via existing helpers.** `getActiveOrganizationId(supabase)` for org scoping in API routes, `hasPermission(key)` from `src/lib/auth-context.tsx` for client-side gating, server-side perm check by reading `user_organization_permissions` directly.

## 5. Schema (authoritative)

### 5.1 New tables

All new tables include:
```sql
organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
```
plus an RLS policy:
```sql
ALTER TABLE <tbl> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <tbl>
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());
```

#### `item_library`
Master list of reusable line items, org-scoped.

```sql
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
```

#### `estimates`

```sql
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
  converted_to_invoice_id uuid,  -- FK added below after invoices alter
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
```

#### `estimate_sections`

```sql
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
```

One-level-only nesting is enforced application-side: when creating a section with a non-null `parent_section_id`, validate that the parent's own `parent_section_id` is `NULL`. Reject otherwise.

#### `estimate_line_items`

```sql
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
```

#### `estimate_templates` (table only, no UI in 67a)

```sql
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
```

#### `pdf_presets` (table only, no UI in 67a)

Schema matches the build guide verbatim plus `organization_id`. Partial unique:

```sql
CREATE UNIQUE INDEX idx_pdf_presets_one_default_per_type
  ON pdf_presets(organization_id, document_type)
  WHERE is_default = true;
```

#### `invoice_sections` (table only, no UI in 67a)

```sql
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
```

### 5.2 Existing tables — modifications

#### `invoices` — ALTER

Eric will delete the existing test row (`INV-2026-0001`) before the migration runs. Migration adds:

```sql
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

-- After test row delete, sequence_number + title can be NOT NULL
ALTER TABLE invoices
  ALTER COLUMN sequence_number SET NOT NULL,
  ALTER COLUMN title SET NOT NULL;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_job_seq_unique UNIQUE (job_id, sequence_number);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','sent','partial','paid','voided'));
```

`total_amount` keeps its name (35 source files reference it). TypeScript `Invoice.total` maps to `total_amount` in the type definitions; runtime queries use `total_amount`.

After estimates is created, add the cross-FK:

```sql
ALTER TABLE estimates
  ADD CONSTRAINT fk_estimates_converted_to_invoice
  FOREIGN KEY (converted_to_invoice_id) REFERENCES invoices(id);
```

#### `invoice_line_items` — ALTER

```sql
ALTER TABLE invoice_line_items
  ADD COLUMN section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  ADD COLUMN library_item_id uuid REFERENCES item_library(id) ON DELETE SET NULL,
  ADD COLUMN code text,
  ADD COLUMN unit text,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX idx_invoice_line_items_section_id ON invoice_line_items(section_id);
CREATE INDEX idx_invoice_line_items_library_item_id ON invoice_line_items(library_item_id);
```

`section_id` stays nullable until 67b creates invoice editor UI that requires it. `amount` keeps its existing meaning — TypeScript `InvoiceLineItem.total` maps to `amount`.

#### `line_items` (legacy Build 6) — DROP

```sql
DROP TABLE IF EXISTS line_items CASCADE;
```

Confirmed 0 rows. Already superseded by `invoice_line_items` since Build 38.

### 5.3 Settings keys

Seed into `company_settings` per organization (RLS-scoped INSERTs run inside an org-context). Idempotent:

```sql
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
```

### 5.4 Permissions

Extend `set_default_permissions(p_user_organization_id, p_role)` (declared in [migration-build48:351](../../../supabase/migration-build48-migrate-user-permissions-and-preferences.sql:351)). Add the 12 new keys to `all_perms`, then to `lead_perms` and `member_perms` per the table below. After redefining the function, re-run it for every existing `(user_organization_id, role)` to backfill.

| Key | Admin | Crew Lead | Crew Member |
|---|:-:|:-:|:-:|
| `view_estimates` | ✓ | ✓ | ✓ |
| `view_invoices` | ✓ | ✓ | ✓ |
| `create_estimates` | ✓ | ✓ | — |
| `edit_estimates` | ✓ | ✓ | — |
| `convert_estimates` | ✓ | ✓ | — |
| `send_estimates` | ✓ | ✓ | — |
| `create_invoices` | ✓ | ✓ | — |
| `edit_invoices` | ✓ | ✓ | — |
| `send_invoices` | ✓ | ✓ | — |
| `manage_item_library` | ✓ | — | — |
| `manage_templates` | ✓ | — | — |
| `manage_pdf_presets` | ✓ | — | — |

## 6. Calculation logic — `src/lib/estimates.ts`

```ts
async function recalculateTotals(estimateId: string, supabase: SupabaseClient): Promise<void>
```

Runs in a single transaction:

1. Fetch all `estimate_line_items` for `estimateId`.
2. Defensive: for each line, if `quantity * unit_price !== total`, write back the corrected total.
3. `subtotal = Σ line.total` (with `Math.round(n * 100) / 100`).
4. Load `estimate.markup_*`, `discount_*`, `tax_rate`.
5. `markup_amount = markup_type === 'percent' ? subtotal * markup_value / 100 : markup_type === 'amount' ? markup_value : 0`.
6. `discount_amount = ...` (same shape).
7. `adjusted_subtotal = subtotal + markup_amount − discount_amount`.
8. `tax_amount = adjusted_subtotal * tax_rate / 100`.
9. `total = adjusted_subtotal + tax_amount`.
10. `UPDATE estimates SET subtotal, markup_amount, discount_amount, adjusted_subtotal, tax_amount, total, updated_at = now() WHERE id = $1`.

Round all monetary values to 2 decimals via `Math.round(n * 100) / 100`. Use `toFixed(2)` only for display in `formatCurrency(n)` in `src/lib/utils.ts`.

The same shape applies to invoices (67b will wire it up). Reuse the function generically or write a parallel `recalculateInvoiceTotals` — either works.

## 7. Numbering — atomic per-job sequence

```ts
async function generateEstimateNumber(jobId: string, supabase: SupabaseClient):
  Promise<{ estimate_number: string; sequence_number: number }>
```

Implementation: a Postgres function called via RPC (Supabase JS doesn't support multi-statement transactions cleanly; an RPC keeps the lock-acquire / max+1 / format atomic):

```sql
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
    RAISE EXCEPTION 'job % not found', p_job_id;
  END IF;
  SELECT COALESCE(MAX(e.sequence_number), 0) + 1 INTO v_seq
    FROM estimates e WHERE e.job_id = p_job_id;
  estimate_number := v_job_number || '-EST-' || v_seq;
  sequence_number := v_seq;
  RETURN NEXT;
END;
$$;
```

Same shape for `generate_invoice_number(p_job_id uuid)` returning `INV` instead of `EST`.

The RPC inherits the caller's RLS context — `SELECT job_number FROM jobs WHERE id = p_job_id` returns NULL for cross-org `job_id`, so the function `RAISE`s. `UNIQUE(job_id, sequence_number)` on both `estimates` and `invoices` is the additional safety net.

Server-side permission check pattern (used in every API route):

```ts
import { createClient } from '@/lib/supabase/server';
import { getActiveOrganizationId } from '@/lib/active-organization';

async function requirePermission(key: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const orgId = await getActiveOrganizationId(supabase);
  const { data: uo } = await supabase
    .from('user_organizations')
    .select('id, role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single();
  if (uo?.role === 'admin') return null;  // admin bypass matches client-side
  const { data: perm } = await supabase
    .from('user_organization_permissions')
    .select('granted')
    .eq('user_organization_id', uo.id)
    .eq('permission_key', key)
    .single();
  if (!perm?.granted) return new Response('Forbidden', { status: 403 });
  return null;  // proceed
}
```

This mirrors `hasPermission(key)` in [src/lib/auth-context.tsx:160](../../../src/lib/auth-context.tsx:160). The exact factoring (helper file, function name) is left to writing-plans.

## 8. File structure

### Migration

- `supabase/migration-build67a-estimates-foundation.sql` — single file: drops `line_items`, creates all new tables (with RLS), alters `invoices` + `invoice_line_items`, adds the cross-FK from `estimates` to `invoices`, creates the two RPCs, seeds `company_settings`, redefines `set_default_permissions`, backfills existing memberships' permissions.

### Server utilities

- `src/lib/estimates.ts` — `createEstimate`, `getEstimate`, `getEstimateWithSections` (returns nested structure), `updateEstimate`, `voidEstimate`, `generateEstimateNumber`, `recalculateTotals`.
- `src/lib/item-library.ts` — `listItems(filters)`, `getItem`, `createItem`, `updateItem`, `deactivateItem`, `reactivateItem`.

### Types — extend `src/lib/types.ts`

```ts
export type EstimateStatus = 'draft'|'sent'|'approved'|'rejected'|'converted'|'voided';
export type AdjustmentType = 'percent'|'amount'|'none';
export type ItemCategory = 'labor'|'equipment'|'materials'|'services'|'other';

export interface Estimate { /* full shape per §5.1 */ }
export interface EstimateSection { /* ... */ }
export interface EstimateLineItem { /* ... */ }
export interface ItemLibraryItem { /* ... */ }
```

The `Invoice` interface already exists; extend it with the new fields. `total` in TS = `total_amount` in DB. Resolution: a thin mapper at the API-route boundary (`mapInvoiceRow(row): Invoice` in `src/lib/invoices.ts`) — Supabase JS's `.select('total:total_amount')` aliasing is brittle around updates / RLS-scoped queries.

### API routes (all in `src/app/api/`)

Every route (a) reads `getActiveOrganizationId(supabase)` and scopes the query, (b) checks `hasPermission(key)` via the server-side equivalent, (c) returns 403 on perm fail / 404 on cross-org access / 409 on `updated_at` drift.

| Path | Methods | Permission |
|---|---|---|
| `estimates/route.ts` | POST, GET (`?job_id=`) | `create_estimates` / `view_estimates` |
| `estimates/[id]/route.ts` | GET, PUT (metadata + adjustments → triggers recalc), DELETE (= void) | `view_estimates` / `edit_estimates` |
| `estimates/[id]/sections/route.ts` | POST, PUT (bulk reorder) | `edit_estimates` |
| `estimates/[id]/sections/[section_id]/route.ts` | PUT (rename), DELETE (cascade + recalc) | `edit_estimates` |
| `estimates/[id]/line-items/route.ts` | POST (recalc), PUT (bulk reorder) | `edit_estimates` |
| `estimates/[id]/line-items/[item_id]/route.ts` | PUT (recalc), DELETE (recalc) | `edit_estimates` |
| `item-library/route.ts` | GET (`?search=&category=&damage_type=&is_active=`), POST | GET: `view_estimates` OR `view_invoices` / POST: `manage_item_library` |
| `item-library/[id]/route.ts` | GET, PUT, DELETE (soft, `is_active=false`) | GET: `view_estimates` OR `view_invoices` / PUT, DELETE: `manage_item_library` |

### Pages

- `src/app/settings/item-library/page.tsx` — table + filter bar + "+ New Item" button (modal).
- `src/app/jobs/[id]/estimates/new/page.tsx` — server action: create draft, redirect to `/estimates/[new_id]/edit`.
- `src/app/estimates/[id]/edit/page.tsx` — the estimate builder (server-rendered shell + client builder component).
- `src/app/estimates/[id]/page.tsx` — read-only view (basic HTML rendering; PDF in 67c).

### Components (all under `src/components/`)

- `estimate-builder/index.tsx` — owns auto-save, layout, builder state.
- `estimate-builder/header-bar.tsx`, `metadata-bar.tsx`, `customer-block.tsx`.
- `estimate-builder/section-card.tsx`, `subsection-card.tsx`, `line-item-row.tsx`.
- `estimate-builder/totals-panel.tsx` — sticky bottom-right.
- `estimate-builder/add-item-dialog.tsx` — Library tab + Custom tab.
- `estimate-builder/template-applicator.tsx` — disabled placeholder for 67b.
- `estimate-builder/save-indicator.tsx`.
- `item-library/item-form.tsx`, `item-table.tsx`.
- `job-detail/estimates-invoices-section.tsx` — embedded card.

### Modifications

- `src/components/job-detail.tsx` — embed `<EstimatesInvoicesSection jobId={job.id} />` between Billing card and Files section. Note: the actual page file is a thin server-rendered wrapper; this is the client component.
- `src/components/nav.tsx` — add new "Catalog" sidebar group with "Item Library" link, `Library` or `Boxes` icon from `lucide-react`.

## 9. UI behavior — the builder

Layout: matches Magicplan in spirit, trimmed to what Eric uses. Top-bar / metadata-bar / customer-block / Tiptap opening / sections list / Tiptap closing / sticky totals (bottom-right).

- **Drag-and-drop** uses `@dnd-kit/sortable` (already used in `src/components/form-builder/`). Sections drag at the top level only. Subsections drag within a parent section only. Line items drag within a section or subsection only — cross-section drag is intentionally disabled (delete + re-add to move).
- **Add Item dialog** (shadcn `Dialog`): tabs for "From Library" (default) and "Custom Item". Library tab filters by job's damage type by default; multi-add with "Done" close. Custom tab creates a one-off line item with `library_item_id = null`.
- **Auto-save**: debounced ~2s after any field change. Save indicator shows "Saving…" → "Saved at HH:MM"; on failure, "Save failed — retrying in Ns" with exponential backoff. Never lose user input. On 409 (concurrent edit), show a toast "Modified by another user — refresh to see changes".
- **Pill formatting**: estimate numbers render in monospace.
- **Negative quantities / unit prices** allowed (credits/adjustments propagate naturally).
- **Tax rate** clamped at input level to 0–100.
- **Negative total** allowed; show subtle warning indicator next to total.
- **Voided estimates** render with strikethrough title + "VOIDED" badge in the list; builder is read-only.

## 10. Edge cases

| Case | Behavior |
|---|---|
| Concurrent edit | `updated_at` snapshot on read; 409 + toast on stale write |
| Delete section with line items | Confirm dialog ("This section has N items. Delete anyway?"), cascade FK |
| Deactivated library item referenced by an estimate | Estimate keeps snapshot data; library tab filters out inactive items |
| Empty estimate | Empty state: "Add a section to get started" + prominent "+ New Section" button |
| Tax rate input | `min=0 max=100` |
| Template applicator | Disabled button + tooltip "Available in next build" |
| Auto-save during network blip | Indefinite "Saving…" → on failure "Save failed — retrying" with exponential backoff |
| Line item drag cross-section | Disallowed at dnd-kit constraint level |
| Subsection drag onto another section | Disallowed at dnd-kit constraint level |

## 11. Manual test plan

After `npm run build` is clean:

1. **Item Library**: create an item via modal; edit; deactivate; reactivate; filter by category, damage type, active state; search. Verify org isolation: TestCo should not see AAA's items and vice versa (use the workspace switcher).
2. **Permissions**: create a Crew Member user in TestCo; verify they see the Estimates section but cannot click "+ New Estimate" or edit; Crew Lead can create/edit but cannot manage the library; Admin sees everything.
3. **Numbering**: create two estimates back-to-back on the same job; verify `EST-1` then `EST-2`. Create on a different job; verify `EST-1` again.
4. **Builder**: build out a multi-section estimate with subsections and line items. Verify drag-and-drop within constraints. Verify auto-save indicator transitions. Verify totals recalculate live and match the stored values after save.
5. **Calculation correctness**: subtotal = Σ items; with markup % vs $; with discount % vs $; tax applied to adjusted subtotal; total matches.
6. **Library snapshotting**: add a library item to an estimate; edit the library item's price; reload the estimate — line item price should NOT change.
7. **Voiding**: void an estimate; confirm read-only state; confirm strikethrough + VOIDED badge in the job-page list.
8. **Cross-org RLS**: from AAA workspace, attempt direct API call against a TestCo `estimate_id` — expect 404.

## 12. Out-of-band tasks

- **Pre-migration**: Eric deletes `INV-2026-0001` and its 2 `invoice_line_items` rows so the `sequence_number NOT NULL` constraint can be added without backfill.
  ```sql
  DELETE FROM invoice_line_items WHERE invoice_id = 'e340eb98-2dce-41a1-aa1c-11fb0ff6b05f';
  DELETE FROM invoices WHERE id = 'e340eb98-2dce-41a1-aa1c-11fb0ff6b05f';
  ```
- **Post-migration**: smoke-test the existing Stripe receipt + QB sync flows still work (the ALTER preserves all existing columns + triggers, but worth a sanity check before declaring done).

## 13. Carry-over to 67b / 67c

- 67b: estimate templates (apply-to-estimate); invoice editor reusing the builder shell; estimate-to-invoice conversion (snapshot copy + bidirectional FK fill); add invoice list to the job-detail card.
- 67c: PDF preset manager UI; PDF generation (likely `@react-pdf/renderer` to match existing `src/components/invoices/invoice-pdf-document.tsx`); email shipping via the existing email infrastructure.

## 14. Open questions

None remaining. All conflicts resolved during brainstorming. If new ones surface during implementation, raise them per Rule C (stop on material finding) — established as a feedback memory in [[2026-04-30-build-14j]].

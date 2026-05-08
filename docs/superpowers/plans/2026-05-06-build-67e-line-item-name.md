# Build 67e — Line Item Name (Title) on Estimates and Invoices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nullable `name` (title) column to `estimate_line_items` and `invoice_line_items` so the library item's title flows through the AddItemDialog, builder, convert/apply-template RPCs, and the PDF — rendered as a bold primary line above the muted description in both the builder and the exported PDF.

**Architecture:** Additive nullable column on both line-item tables. Two `CREATE OR REPLACE FUNCTION` updates in the same migration: `convert_estimate_to_invoice` extends its line-item SELECT cursor + INSERT to copy `name`, and `apply_template_to_estimate` extends both of its line-item INSERTs to write `name = v_lib.name` (library-only — no `name_override` in template structure JSON, mirroring the existing `unit`/`code` library-only pattern from build 67b cleanup M3). API POST routes derive `name` from the library snapshot or accept an optional custom-item `name`. PUT routes accept optional `name` updates. UI changes: AddItemDialog Custom tab gains an optional name input; LineItemRow stacks bold name above muted description; PDF SectionsTable stacks them inside the existing Description column.

**Tech Stack:** Next.js (App Router) on `next/dist`-vendored fork, Supabase Postgres + service-role client (prod project `rzzprgidqbnqcdupmpfe`), base-ui primitives + tailwindcss, sonner for toasts, react-pdf for PDF rendering. **No test framework** — verification is `npx tsc --noEmit` clean + manual §11 test pass against prod Supabase Test Co.

**Spec:** [docs/superpowers/specs/2026-05-06-build-67e-line-item-name-design.md](../specs/2026-05-06-build-67e-line-item-name-design.md)

**Reference build for pattern:** [docs/superpowers/plans/2026-05-05-build-67d-soft-delete-estimates-invoices.md](2026-05-05-build-67d-soft-delete-estimates-invoices.md) (most recent SDD-pattern plan; uses pg_get_functiondef pre-flight + manual prod migration apply).

---

## File structure

### New files
- `supabase/migration-build67e-line-item-name.sql` — schema delta + two RPC replacements

### Modified files
- `src/lib/types.ts:588-603` — add `name: string | null` to `EstimateLineItem`
- `src/lib/types.ts:710-725` — add `name: string | null` to `InvoiceLineItem`
- `src/lib/types.ts:758-797` — add `name: string | null` to `TemplateWithContents` line-item shape (in both the direct `items` array and the `subsections.items` array)
- `src/app/api/estimates/[id]/line-items/route.ts:77-121` — extend library SELECT to include `name`, INSERT with `name`; extend custom-item branch to accept optional `body.name`
- `src/app/api/estimates/[id]/line-items/[item_id]/route.ts:12-21, 59-93` — accept optional `name` in PUT body, validate, include in update
- `src/app/api/invoices/[id]/line-items/route.ts:57-115` — same as estimate POST
- `src/app/api/invoices/[id]/line-items/[item_id]/route.ts:9-83` — same as estimate PUT
- `src/components/estimate-builder/add-item-dialog.tsx:147-164` — Library tab template-mode local item: write `name: libItem.name` and `description: libItem.description` separately (replaces the current `description: libItem.name` hack)
- `src/components/estimate-builder/add-item-dialog.tsx:316-521` — Custom tab: add optional `name` input field above description, pass into POST body and template-mode local item
- `src/components/estimate-builder/line-item-row.tsx` — stack bold `name` input on its own line above the muted `description` input; right-side fields (code/qty/unit/price/total) align with the name row
- `src/lib/pdf-renderer/components/sections-table.tsx:58-71` — replace single `<Text style={styles.tdDesc}>{item.description}</Text>` cell with a stacked `<View>` containing bold name (when non-null) above muted description
- `src/lib/pdf-renderer/styles.ts` — add `tdName` style (bold, default text color, same width as `tdDesc`); soften `tdDesc` color to muted when name is present (achieved by pairing — keep `tdDesc` as-is and let the new `tdDescMuted` apply only inside the stacked view, or simply switch all desc text to a paler color since reading legibility on white is fine; the simplest path is one new `tdName` style + leaving `tdDesc` unchanged, which the spec accepts)
- `docs/vault/00-NOW.md` — bump to reflect 67e ship state in the wrap-up phase

---

## Phase 0 — Pre-flight capture from prod

### Task 1: Capture current convert_estimate_to_invoice body verbatim from prod

**Files:**
- Read-only — output captured into the migration file in Task 4.

- [ ] **Step 1: Run pg_get_functiondef against prod**

Use the Supabase MCP `execute_sql` tool against project `rzzprgidqbnqcdupmpfe`:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'convert_estimate_to_invoice';
```

- [ ] **Step 2: Compare against the body captured at 67d wrap**

The body should match [supabase/migration-build67d-soft-delete-estimates-invoices.sql:72-231](../../supabase/migration-build67d-soft-delete-estimates-invoices.sql:72) verbatim (the `deleted_at IS NULL` guard on the source SELECT is the latest delta).

If the live body differs from 67d's — **stop and reconcile**. Something landed since 67d wrap that this plan does not anticipate.

If it matches — proceed.

- [ ] **Step 3: Save the captured body**

Paste the verbatim output to `/tmp/67e-convert-rpc-current.sql` (or any scratch path). The body in Task 4 must be a literal copy with only the documented additions.

### Task 2: Capture current apply_template_to_estimate body verbatim from prod

**Files:**
- Read-only — output captured into the migration file in Task 4.

- [ ] **Step 1: Run pg_get_functiondef against prod**

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_template_to_estimate';
```

- [ ] **Step 2: Compare against 67b cleanup body**

The body should match [supabase/migration-build67b-cleanup.sql:191-426](../../supabase/migration-build67b-cleanup.sql:191) verbatim (the I4 inline totals recompute is the latest delta).

If different — **stop and reconcile**.

- [ ] **Step 3: Save the captured body**

Save to `/tmp/67e-apply-template-rpc-current.sql`.

### Task 3: Confirm `name` column does not already exist on either line-item table

**Files:**
- Read-only.

- [ ] **Step 1: Probe both tables**

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('estimate_line_items', 'invoice_line_items')
  AND column_name = 'name';
```

Expected: zero rows. If any row returns — stop and reconcile.

- [ ] **Step 2: Probe live row counts (sanity for §11 verification later)**

```sql
SELECT
  (SELECT COUNT(*) FROM estimate_line_items) AS estimate_line_item_count,
  (SELECT COUNT(*) FROM invoice_line_items) AS invoice_line_item_count;
```

Expected: positive numbers in both Test Co + AAA Disaster Recovery (data exists). Record the totals; after migration apply they should be unchanged.

---

## Phase 1 — Migration

### Task 4: Draft `migration-build67e-line-item-name.sql`

**Files:**
- Create: `supabase/migration-build67e-line-item-name.sql`

- [ ] **Step 1: Write the file**

```sql
-- Build 67e — Line item name (title) on estimates and invoices.
-- Spec: docs/superpowers/specs/2026-05-06-build-67e-line-item-name-design.md
--
-- Adds a nullable `name text` column to estimate_line_items and
-- invoice_line_items, and updates the two RPCs that INSERT into those tables
-- to populate `name`:
--   1. convert_estimate_to_invoice — extends the line-item SELECT cursor
--      to include `name`, and the INSERT column list + VALUES to include it.
--   2. apply_template_to_estimate — extends both line-item INSERTs (parent-
--      section items + subsection items) to write `name = v_lib.name`. Library
--      lookup-failure cases leave `v_lib.name` NULL, matching the existing
--      `[unknown item]` fallback used for description on broken refs (so the
--      legacy item_library M3 lib-only pattern from 67b cleanup is preserved).
--
-- Pre-flight (Tasks 1 + 2 of the plan) confirmed the live function bodies
-- match 67d (convert) and 67b cleanup (apply-template) verbatim before
-- drafting this migration.

-- ============================================================================
-- 1. Schema delta — additive nullable name column
-- ============================================================================
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE invoice_line_items  ADD COLUMN IF NOT EXISTS name text;

-- ============================================================================
-- 2. convert_estimate_to_invoice — copy name from estimate to invoice line items
-- ============================================================================
-- Body is a literal carry-forward of the 67d body. Only the line-item loop
-- changed: SELECT cursor adds `name`, INSERT column list adds `name`, VALUES
-- adds `v_item.name` (between library_item_id and description).
CREATE OR REPLACE FUNCTION public.convert_estimate_to_invoice(p_estimate_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_estimate     estimates%ROWTYPE;
  v_org_id       uuid;
  v_job_id       uuid;
  v_inv_number   text;
  v_inv_seq      integer;
  v_due_days_raw text;
  v_due_days     integer;
  v_due_date     date;
  v_new_invoice_id uuid;
  v_section      record;
  v_subsection   record;
  v_section_map  jsonb := '{}'::jsonb;
  v_old_section_id uuid;
  v_new_section_id uuid;
  v_item         record;
  v_subtotal     numeric(10,2) := 0;
  v_markup_amt   numeric(10,2) := 0;
  v_discount_amt numeric(10,2) := 0;
  v_adjusted     numeric(10,2) := 0;
  v_tax_amt      numeric(10,2) := 0;
  v_total        numeric(10,2) := 0;
BEGIN
  SELECT * INTO v_estimate FROM estimates WHERE id = p_estimate_id AND deleted_at IS NULL FOR UPDATE;
  IF v_estimate.id IS NULL THEN
    RAISE EXCEPTION 'estimate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_estimate.status <> 'approved' THEN
    RAISE EXCEPTION 'estimate_not_approved' USING ERRCODE = 'P0001';
  END IF;
  IF v_estimate.converted_to_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'estimate_already_converted:%', v_estimate.converted_to_invoice_id
      USING ERRCODE = 'P0001';
  END IF;

  v_org_id := v_estimate.organization_id;
  v_job_id := v_estimate.job_id;

  SELECT t.invoice_number, t.sequence_number
    INTO v_inv_number, v_inv_seq
    FROM generate_invoice_number(v_job_id) t;

  -- I2 fix: defensive cast for default_invoice_due_days.
  SELECT value INTO v_due_days_raw
    FROM company_settings
   WHERE organization_id = v_org_id AND key = 'default_invoice_due_days';
  IF v_due_days_raw IS NULL OR v_due_days_raw !~ '^\s*-?\d+\s*$' THEN
    v_due_days := 30;
  ELSE
    v_due_days := v_due_days_raw::integer;
    IF v_due_days < 0 THEN v_due_days := 30; END IF;
  END IF;
  v_due_date := CURRENT_DATE + v_due_days;

  INSERT INTO invoices (
    organization_id, job_id, invoice_number, sequence_number, title,
    status, issued_date, due_date,
    opening_statement, closing_statement,
    markup_type, markup_value, discount_type, discount_value, tax_rate,
    converted_from_estimate_id, created_by
  ) VALUES (
    v_org_id, v_job_id, v_inv_number, v_inv_seq, v_estimate.title,
    'draft', CURRENT_DATE, v_due_date,
    v_estimate.opening_statement, v_estimate.closing_statement,
    v_estimate.markup_type, v_estimate.markup_value,
    v_estimate.discount_type, v_estimate.discount_value, v_estimate.tax_rate,
    v_estimate.id, auth.uid()
  )
  RETURNING id INTO v_new_invoice_id;

  FOR v_section IN
    SELECT id, title, sort_order FROM estimate_sections
     WHERE estimate_id = p_estimate_id AND parent_section_id IS NULL
     ORDER BY sort_order
  LOOP
    INSERT INTO invoice_sections (organization_id, invoice_id, parent_section_id, title, sort_order)
    VALUES (v_org_id, v_new_invoice_id, NULL, v_section.title, v_section.sort_order)
    RETURNING id INTO v_new_section_id;
    v_section_map := jsonb_set(v_section_map, ARRAY[v_section.id::text], to_jsonb(v_new_section_id));
  END LOOP;

  FOR v_subsection IN
    SELECT id, title, sort_order, parent_section_id FROM estimate_sections
     WHERE estimate_id = p_estimate_id AND parent_section_id IS NOT NULL
     ORDER BY sort_order
  LOOP
    v_old_section_id := v_subsection.parent_section_id;
    INSERT INTO invoice_sections (organization_id, invoice_id, parent_section_id, title, sort_order)
    VALUES (
      v_org_id, v_new_invoice_id,
      (v_section_map->>(v_old_section_id::text))::uuid,
      v_subsection.title, v_subsection.sort_order
    )
    RETURNING id INTO v_new_section_id;
    v_section_map := jsonb_set(v_section_map, ARRAY[v_subsection.id::text], to_jsonb(v_new_section_id));
  END LOOP;

  -- 67e: SELECT cursor + INSERT carry the `name` column through the conversion.
  FOR v_item IN
    SELECT id, section_id, library_item_id, name, description, code,
           quantity, unit, unit_price, total, sort_order
      FROM estimate_line_items
     WHERE estimate_id = p_estimate_id
     ORDER BY sort_order
  LOOP
    v_old_section_id := v_item.section_id;
    INSERT INTO invoice_line_items (
      organization_id, invoice_id, section_id, library_item_id,
      name, description, code, quantity, unit, unit_price, amount, sort_order
    ) VALUES (
      v_org_id, v_new_invoice_id,
      (v_section_map->>(v_old_section_id::text))::uuid,
      v_item.library_item_id,
      v_item.name, v_item.description, v_item.code, v_item.quantity, v_item.unit,
      v_item.unit_price, v_item.total, v_item.sort_order
    );
    v_subtotal := v_subtotal + v_item.total;
  END LOOP;

  v_subtotal := round(v_subtotal::numeric, 2);

  UPDATE estimates SET
    status = 'converted',
    converted_to_invoice_id = v_new_invoice_id,
    converted_at = now(),
    updated_at = now()
  WHERE id = p_estimate_id;

  -- I4 fix: inline totals recompute.
  v_markup_amt := CASE v_estimate.markup_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.markup_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.markup_value::numeric, 2)
    ELSE 0
  END;
  v_discount_amt := CASE v_estimate.discount_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.discount_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.discount_value::numeric, 2)
    ELSE 0
  END;
  v_adjusted := round((v_subtotal + v_markup_amt - v_discount_amt)::numeric, 2);
  v_tax_amt  := round((v_adjusted * v_estimate.tax_rate / 100)::numeric, 2);
  v_total    := round((v_adjusted + v_tax_amt)::numeric, 2);

  UPDATE invoices SET
    subtotal = v_subtotal,
    markup_amount = v_markup_amt,
    discount_amount = v_discount_amt,
    adjusted_subtotal = v_adjusted,
    tax_amount = v_tax_amt,
    total_amount = v_total,
    updated_at = now()
  WHERE id = v_new_invoice_id;

  RETURN v_new_invoice_id;
END;
$function$;

-- ============================================================================
-- 3. apply_template_to_estimate — populate line-item name from library
-- ============================================================================
-- Body is a literal carry-forward of the 67b-cleanup body. Only the two
-- INSERTs into estimate_line_items changed: each gains `name` in the column
-- list and `v_lib.name` in the VALUES (NULL when the library lookup failed,
-- which falls naturally out of the v_lib record reset on miss). No template
-- structure JSON change — name follows the M3 library-only pattern (matches
-- unit + code).
CREATE OR REPLACE FUNCTION public.apply_template_to_estimate(
  p_estimate_id uuid,
  p_template_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_estimate    estimates%ROWTYPE;
  v_template    estimate_templates%ROWTYPE;
  v_existing_section_count integer;
  v_struct      jsonb;
  v_section     jsonb;
  v_subsection  jsonb;
  v_item        jsonb;
  v_section_idx integer := 0;
  v_subsection_idx integer := 0;
  v_item_idx    integer;
  v_new_section_id uuid;
  v_new_subsection_id uuid;
  v_lib_id      uuid;
  v_lib         item_library%ROWTYPE;
  v_desc        text;
  v_qty         numeric(10,2);
  v_unit_price  numeric(10,2);
  v_unit        text;
  v_code        text;
  v_total       numeric(10,2);
  v_broken_refs jsonb := '[]'::jsonb;
  v_section_count_out integer := 0;
  v_line_item_count_out integer := 0;
  v_placeholder bool;
  v_ref_obj     jsonb;
  v_subtotal     numeric(10,2) := 0;
  v_markup_amt   numeric(10,2) := 0;
  v_discount_amt numeric(10,2) := 0;
  v_adjusted     numeric(10,2) := 0;
  v_tax_amt      numeric(10,2) := 0;
  v_total_out    numeric(10,2) := 0;
BEGIN
  SELECT * INTO v_estimate FROM estimates WHERE id = p_estimate_id FOR UPDATE;
  IF v_estimate.id IS NULL THEN
    RAISE EXCEPTION 'estimate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_estimate.status <> 'draft' THEN
    RAISE EXCEPTION 'estimate_not_draft' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_existing_section_count
    FROM estimate_sections WHERE estimate_id = p_estimate_id;
  IF v_existing_section_count > 0 THEN
    RAISE EXCEPTION 'estimate_not_empty' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_template FROM estimate_templates WHERE id = p_template_id;
  IF v_template.id IS NULL OR v_template.is_active = false
     OR v_template.organization_id <> v_estimate.organization_id THEN
    RAISE EXCEPTION 'template_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  v_struct := v_template.structure;

  FOR v_section IN SELECT * FROM jsonb_array_elements(COALESCE(v_struct->'sections', '[]'::jsonb))
  LOOP
    INSERT INTO estimate_sections (organization_id, estimate_id, parent_section_id, title, sort_order)
    VALUES (
      v_estimate.organization_id, p_estimate_id, NULL,
      v_section->>'title',
      COALESCE((v_section->>'sort_order')::integer, v_section_idx)
    )
    RETURNING id INTO v_new_section_id;
    v_section_count_out := v_section_count_out + 1;

    v_item_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_section->'items', '[]'::jsonb))
    LOOP
      v_lib_id := NULLIF(v_item->>'library_item_id', '')::uuid;
      v_placeholder := false;
      IF v_lib_id IS NOT NULL THEN
        SELECT * INTO v_lib FROM item_library
         WHERE id = v_lib_id AND is_active = true
           AND organization_id = v_estimate.organization_id;
      ELSE
        v_lib.id := NULL;
        v_lib.name := NULL;
      END IF;
      v_desc := COALESCE(NULLIF(v_item->>'description_override', ''), v_lib.description, '[unknown item]');
      v_qty := COALESCE(NULLIF(v_item->>'quantity_override', '')::numeric, v_lib.default_quantity, 1);
      v_unit_price := COALESCE(NULLIF(v_item->>'unit_price_override', '')::numeric, v_lib.unit_price, 0);
      v_unit := v_lib.default_unit;
      v_code := v_lib.code;
      v_total := round((v_qty * v_unit_price)::numeric, 2);

      IF v_lib_id IS NOT NULL AND v_lib.id IS NULL THEN
        v_placeholder := (
             (v_item->>'description_override') IS NULL
          AND (v_item->>'quantity_override')   IS NULL
          AND (v_item->>'unit_price_override') IS NULL
        );
        v_ref_obj := jsonb_build_object(
          'section_idx', v_section_idx,
          'item_idx',    v_item_idx,
          'library_item_id', v_lib_id,
          'placeholder', v_placeholder
        );
        v_broken_refs := v_broken_refs || jsonb_build_array(v_ref_obj);
      END IF;

      -- 67e: column list + VALUES gain `name` / `v_lib.name`. Lib-only — no
      -- template-side override (matches existing unit/code M3 pattern).
      INSERT INTO estimate_line_items (
        organization_id, estimate_id, section_id, library_item_id,
        name, description, code, quantity, unit, unit_price, total, sort_order
      ) VALUES (
        v_estimate.organization_id, p_estimate_id, v_new_section_id,
        CASE WHEN v_lib.id IS NOT NULL THEN v_lib.id ELSE NULL END,
        v_lib.name, v_desc, v_code, v_qty, v_unit, v_unit_price, v_total,
        COALESCE((v_item->>'sort_order')::integer, v_item_idx)
      );
      v_subtotal := v_subtotal + v_total;
      v_line_item_count_out := v_line_item_count_out + 1;
      v_item_idx := v_item_idx + 1;
    END LOOP;

    v_subsection_idx := 0;
    FOR v_subsection IN SELECT * FROM jsonb_array_elements(COALESCE(v_section->'subsections', '[]'::jsonb))
    LOOP
      INSERT INTO estimate_sections (organization_id, estimate_id, parent_section_id, title, sort_order)
      VALUES (
        v_estimate.organization_id, p_estimate_id, v_new_section_id,
        v_subsection->>'title',
        COALESCE((v_subsection->>'sort_order')::integer, v_subsection_idx)
      )
      RETURNING id INTO v_new_subsection_id;
      v_section_count_out := v_section_count_out + 1;

      v_item_idx := 0;
      FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_subsection->'items', '[]'::jsonb))
      LOOP
        v_lib_id := NULLIF(v_item->>'library_item_id', '')::uuid;
        v_placeholder := false;
        IF v_lib_id IS NOT NULL THEN
          SELECT * INTO v_lib FROM item_library
           WHERE id = v_lib_id AND is_active = true
             AND organization_id = v_estimate.organization_id;
        ELSE
          v_lib.id := NULL;
          v_lib.name := NULL;
        END IF;
        v_desc := COALESCE(NULLIF(v_item->>'description_override', ''), v_lib.description, '[unknown item]');
        v_qty := COALESCE(NULLIF(v_item->>'quantity_override', '')::numeric, v_lib.default_quantity, 1);
        v_unit_price := COALESCE(NULLIF(v_item->>'unit_price_override', '')::numeric, v_lib.unit_price, 0);
        v_unit := v_lib.default_unit;
        v_code := v_lib.code;
        v_total := round((v_qty * v_unit_price)::numeric, 2);

        IF v_lib_id IS NOT NULL AND v_lib.id IS NULL THEN
          v_placeholder := (
               (v_item->>'description_override') IS NULL
            AND (v_item->>'quantity_override')   IS NULL
            AND (v_item->>'unit_price_override') IS NULL
          );
          v_ref_obj := jsonb_build_object(
            'section_idx', v_section_idx,
            'item_idx',    v_item_idx,
            'library_item_id', v_lib_id,
            'placeholder', v_placeholder,
            'in_subsection', true,
            'subsection_idx', v_subsection_idx
          );
          v_broken_refs := v_broken_refs || jsonb_build_array(v_ref_obj);
        END IF;

        -- 67e: same lib-only name addition as the parent-section branch.
        INSERT INTO estimate_line_items (
          organization_id, estimate_id, section_id, library_item_id,
          name, description, code, quantity, unit, unit_price, total, sort_order
        ) VALUES (
          v_estimate.organization_id, p_estimate_id, v_new_subsection_id,
          CASE WHEN v_lib.id IS NOT NULL THEN v_lib.id ELSE NULL END,
          v_lib.name, v_desc, v_code, v_qty, v_unit, v_unit_price, v_total,
          COALESCE((v_item->>'sort_order')::integer, v_item_idx)
        );
        v_subtotal := v_subtotal + v_total;
        v_line_item_count_out := v_line_item_count_out + 1;
        v_item_idx := v_item_idx + 1;
      END LOOP;
      v_subsection_idx := v_subsection_idx + 1;
    END LOOP;

    v_section_idx := v_section_idx + 1;
  END LOOP;

  IF v_template.opening_statement IS NOT NULL AND v_template.opening_statement <> '' THEN
    UPDATE estimates SET opening_statement = v_template.opening_statement
     WHERE id = p_estimate_id;
  END IF;
  IF v_template.closing_statement IS NOT NULL AND v_template.closing_statement <> '' THEN
    UPDATE estimates SET closing_statement = v_template.closing_statement
     WHERE id = p_estimate_id;
  END IF;

  v_subtotal := round(v_subtotal::numeric, 2);
  v_markup_amt := CASE v_estimate.markup_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.markup_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.markup_value::numeric, 2)
    ELSE 0
  END;
  v_discount_amt := CASE v_estimate.discount_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.discount_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.discount_value::numeric, 2)
    ELSE 0
  END;
  v_adjusted := round((v_subtotal + v_markup_amt - v_discount_amt)::numeric, 2);
  v_tax_amt  := round((v_adjusted * v_estimate.tax_rate / 100)::numeric, 2);
  v_total_out := round((v_adjusted + v_tax_amt)::numeric, 2);

  UPDATE estimates SET
    subtotal = v_subtotal,
    markup_amount = v_markup_amt,
    discount_amount = v_discount_amt,
    adjusted_subtotal = v_adjusted,
    tax_amount = v_tax_amt,
    total = v_total_out,
    updated_at = now()
  WHERE id = p_estimate_id;

  RETURN jsonb_build_object(
    'section_count', v_section_count_out,
    'line_item_count', v_line_item_count_out,
    'broken_refs', v_broken_refs
  );
END;
$function$;

-- ============================================================================
-- 4. Re-grants (CREATE OR REPLACE preserves grants in PG 15+; explicit for parity).
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_template_to_estimate(uuid, uuid) TO authenticated;
```

- [ ] **Step 2: Sanity-diff the two RPC bodies against the captured originals**

For `convert_estimate_to_invoice`: the only intentional differences vs. the body captured in Task 1 are (a) `name` added to the SELECT cursor column list, (b) `name` added to the INSERT column list, (c) `v_item.name` added to the VALUES. Anything else differing means a copy error — fix it.

For `apply_template_to_estimate`: the only intentional differences vs. the body captured in Task 2 are (a) two `name` additions to the INSERT column list (parent + sub), (b) two `v_lib.name` additions to the VALUES, (c) one `v_lib.name := NULL;` assignment in the `ELSE` block of each lib-lookup so the implicit NULL is explicit and survives loop iterations where a previous lib hit set the field. Anything else differing means a copy error — fix it.

- [ ] **Step 3: Commit the migration draft**

```bash
git add supabase/migration-build67e-line-item-name.sql
git commit -m "migration(67e): draft line-item name column + RPC carry-forward"
```

### Task 5: Apply the migration to prod (manual)

**Files:**
- Read-only.

- [ ] **Step 1: User applies via Supabase Studio**

Per `reference_supabase_projects` memory — prod migrations are manually applied; the CLI does not auto-track. Open the SQL editor for project `rzzprgidqbnqcdupmpfe`, paste the entire contents of `supabase/migration-build67e-line-item-name.sql`, run.

The agent should pause here and ask the user to confirm the migration succeeded (a clean "Success" + the `RETURN` of the GRANT statements).

- [ ] **Step 2: Verify schema delta via MCP**

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('estimate_line_items', 'invoice_line_items')
  AND column_name = 'name';
```

Expected: 2 rows, both `text` and `is_nullable = YES`.

- [ ] **Step 3: Verify RPC bodies replaced**

```sql
SELECT proname, length(pg_get_functiondef(oid)) AS body_len
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('convert_estimate_to_invoice','apply_template_to_estimate');
```

Body lengths should be larger than the pre-migration captures by roughly 30–60 chars each (the `name` additions). If the bodies are unchanged the migration didn't actually run — re-apply.

- [ ] **Step 4: Verify row counts unchanged**

Re-run the count query from Task 3 Step 2. Both totals should match the pre-migration values (the migration is purely additive — no data touched).

---

## Phase 2 — TypeScript types

### Task 6: Add `name: string | null` to the three line-item interfaces in `types.ts`

**Files:**
- Modify: `src/lib/types.ts:588-603`
- Modify: `src/lib/types.ts:710-725`
- Modify: `src/lib/types.ts:758-797`

- [ ] **Step 1: Add `name` to `EstimateLineItem`**

In `src/lib/types.ts:588-603`, after `library_item_id: string | null;` insert:

```ts
  name: string | null;
```

So the interface reads:

```ts
export interface EstimateLineItem {
  id: string;
  organization_id: string;
  estimate_id: string;
  section_id: string;
  library_item_id: string | null;
  name: string | null;
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
```

- [ ] **Step 2: Add `name` to `InvoiceLineItem`**

Same field placement in `src/lib/types.ts:710-725`:

```ts
export interface InvoiceLineItem {
  id: string;
  organization_id: string;
  invoice_id: string;
  section_id: string | null;
  library_item_id: string | null;
  name: string | null;
  description: string;
  code: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Add `name` to `TemplateWithContents` line-item shape**

In `src/lib/types.ts:758-797`, the `items: Array<{...}>` shape and the inner `subsections.items: Array<{...}>` shape both need `name: string | null;` inserted after `library_item_id: string | null;`. Both shapes mirror the estimate-line-item subset.

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS. The change is additive on interfaces; consumers that build literal objects without spreading existing rows will surface as type errors.

If errors appear, they tell you which call sites need updating before Phase 3 lands. Common candidates: any `as EstimateLineItem` cast in test fixtures or `crypto.randomUUID()`-built local items. Fix those by adding `name: null` (or the appropriate value) inline.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts
git commit -m "types(67e): add name field to line-item interfaces"
```

---

## Phase 3 — API routes

### Task 7: Estimate POST `/api/estimates/[id]/line-items` — derive name from library + accept custom name

**Files:**
- Modify: `src/app/api/estimates/[id]/line-items/route.ts:13-22, 71-152`

- [ ] **Step 1: Extend the `CreatePayload` interface**

At [src/app/api/estimates/[id]/line-items/route.ts:13-22](../../src/app/api/estimates/[id]/line-items/route.ts:13), add `name`:

```ts
interface CreatePayload {
  section_id: string;
  library_item_id?: string | null;
  name?: string | null;
  description?: string;
  code?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price?: number;
  sort_order?: number;
}
```

- [ ] **Step 2: Resolve `name` from library snapshot**

Inside the `if (body.library_item_id)` branch around [line 78-91](../../src/app/api/estimates/[id]/line-items/route.ts:78), extend the `.select(...)` to include `name` and the destructured shape:

```ts
    const { data: lib } = await supabase
      .from("item_library")
      .select("name, description, code, default_unit, unit_price, is_active")
      .eq("id", body.library_item_id)
      .maybeSingle<{
        name: string;
        description: string;
        code: string | null;
        default_unit: string | null;
        unit_price: number;
        is_active: boolean;
      }>();
```

Declare a `name` local right alongside the existing `description` / `code` / `unit` / `unit_price` declarations near [line 72-75](../../src/app/api/estimates/[id]/line-items/route.ts:72), and assign `name = lib.name;` in the library branch and `name = body.name?.trim() || null;` in the custom branch.

Place the local declaration as:

```ts
  let name: string | null;
  let description: string;
  let code: string | null;
  let unit: string | null;
  let unit_price: number;
```

- [ ] **Step 3: Validate optional custom-item name**

In the custom-item `else` branch around [line 107-121](../../src/app/api/estimates/[id]/line-items/route.ts:107), after the existing description trim block, add:

```ts
    if (body.name !== undefined && body.name !== null) {
      if (typeof body.name !== "string") {
        return NextResponse.json({ error: "name must be a string" }, { status: 400 });
      }
      const trimmed = body.name.trim();
      if (trimmed.length > 200) {
        return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
      }
      name = trimmed.length > 0 ? trimmed : null;
    } else {
      name = null;
    }
```

- [ ] **Step 4: Include `name` in the INSERT**

Update the `.insert({ ... })` block at [line 138-152](../../src/app/api/estimates/[id]/line-items/route.ts:138):

```ts
    .insert({
      organization_id: orgId,
      estimate_id: estimateId,
      section_id: body.section_id,
      library_item_id: body.library_item_id ?? null,
      name,
      description,
      code,
      quantity: body.quantity,
      unit,
      unit_price,
      total,
      sort_order,
    })
```

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/estimates/[id]/line-items/route.ts
git commit -m "api(67e): pass library name through estimate line-item POST"
```

### Task 8: Estimate PUT `/api/estimates/[id]/line-items/[item_id]` — accept optional name updates

**Files:**
- Modify: `src/app/api/estimates/[id]/line-items/[item_id]/route.ts:12-21, 59-93`

- [ ] **Step 1: Extend `UpdatePayload`**

At [src/app/api/estimates/[id]/line-items/[item_id]/route.ts:12-21](../../src/app/api/estimates/[id]/line-items/[item_id]/route.ts:12):

```ts
interface UpdatePayload {
  name?: string | null;
  description?: string;
  code?: string | null;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  section_id?: string;
  sort_order?: number;
  updated_at_snapshot?: string;
}
```

- [ ] **Step 2: Validate + apply `name` in the update block**

Insert this block after the description validation around [line 61-69](../../src/app/api/estimates/[id]/line-items/[item_id]/route.ts:61) (before `code`):

```ts
  if (body.name !== undefined) {
    if (body.name === null) {
      update.name = null;
    } else if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string or null" }, { status: 400 });
    } else {
      const trimmed = body.name.trim();
      if (trimmed.length > 200) {
        return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
      }
      update.name = trimmed.length > 0 ? trimmed : null;
    }
  }
```

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/estimates/[id]/line-items/[item_id]/route.ts
git commit -m "api(67e): accept name on estimate line-item PUT"
```

### Task 9: Invoice POST `/api/invoices/[id]/line-items` — same as estimate POST

**Files:**
- Modify: `src/app/api/invoices/[id]/line-items/route.ts:10-22, 55-115`

- [ ] **Step 1: Extend `PostBody`**

At [src/app/api/invoices/[id]/line-items/route.ts:10-22](../../src/app/api/invoices/[id]/line-items/route.ts:10):

```ts
interface PostBody {
  section_id: string;
  library_item_id?: string;
  name?: string | null;
  description?: string;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  code?: string | null;
  sort_order?: number;
}
```

- [ ] **Step 2: Library branch — read + write `name`**

In the `if (body.library_item_id)` branch, extend the `.select` to include `name` and bring it into the destructured row shape and the assembled `lineRow`:

```ts
    if (body.library_item_id) {
      const { data: lib } = await supabase
        .from("item_library")
        .select("name, description, code, default_quantity, default_unit, unit_price")
        .eq("id", body.library_item_id)
        .eq("is_active", true)
        .maybeSingle<{
          name: string;
          description: string;
          code: string | null;
          default_quantity: number;
          default_unit: string | null;
          unit_price: number;
        }>();
      if (!lib) return NextResponse.json({ error: "library_item_not_found_or_inactive" }, { status: 400 });

      const qty = body.quantity ?? Number(lib.default_quantity);
      const overridePrice = body.unit_price !== undefined ? Number(body.unit_price) : Number(lib.unit_price);
      if (!Number.isFinite(overridePrice)) {
        return NextResponse.json({ error: "unit_price must be finite" }, { status: 400 });
      }
      lineRow = {
        organization_id: orgId,
        invoice_id: id,
        section_id: body.section_id,
        library_item_id: body.library_item_id,
        name: lib.name,
        description: lib.description,
        code: lib.code,
        quantity: qty,
        unit: lib.default_unit,
        unit_price: overridePrice,
        amount: roundMoney(qty * overridePrice),
        sort_order: body.sort_order ?? 0,
      };
```

- [ ] **Step 3: Custom branch — accept optional `name`**

Extend the custom-item `else` branch:

```ts
    } else {
      if (typeof body.description !== "string" || !body.description.trim()) {
        return NextResponse.json({ error: "description required for custom item" }, { status: 400 });
      }
      let customName: string | null = null;
      if (body.name !== undefined && body.name !== null) {
        if (typeof body.name !== "string") {
          return NextResponse.json({ error: "name must be a string" }, { status: 400 });
        }
        const trimmed = body.name.trim();
        if (trimmed.length > 200) {
          return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
        }
        customName = trimmed.length > 0 ? trimmed : null;
      }
      const qty = Number(body.quantity ?? 1);
      const price = Number(body.unit_price ?? 0);
      if (!Number.isFinite(qty) || qty < 0) {
        return NextResponse.json({ error: "quantity must be a non-negative number" }, { status: 400 });
      }
      if (!Number.isFinite(price)) {
        return NextResponse.json({ error: "unit_price must be finite" }, { status: 400 });
      }
      lineRow = {
        organization_id: orgId,
        invoice_id: id,
        section_id: body.section_id,
        library_item_id: null,
        name: customName,
        description: body.description,
        code: body.code ?? null,
        quantity: qty,
        unit: body.unit ?? null,
        unit_price: price,
        amount: roundMoney(qty * price),
        sort_order: body.sort_order ?? 0,
      };
    }
```

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/invoices/[id]/line-items/route.ts
git commit -m "api(67e): pass library name through invoice line-item POST"
```

### Task 10: Invoice PUT `/api/invoices/[id]/line-items/[item_id]` — accept optional name updates

**Files:**
- Modify: `src/app/api/invoices/[id]/line-items/[item_id]/route.ts:9-83`

- [ ] **Step 1: Extend `PutBody`**

At [src/app/api/invoices/[id]/line-items/[item_id]/route.ts:9-18](../../src/app/api/invoices/[id]/line-items/[item_id]/route.ts:9):

```ts
interface PutBody {
  name?: string | null;
  description?: string;
  code?: string | null;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  section_id?: string;
  sort_order?: number;
  updated_at_snapshot?: string;
}
```

- [ ] **Step 2: Validate + apply `name` in the patch**

Add this block right after `const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };` at [line 57](../../src/app/api/invoices/[id]/line-items/[item_id]/route.ts:57), before the `body.description` clause:

```ts
    if (body.name !== undefined) {
      if (body.name === null) {
        patch.name = null;
      } else if (typeof body.name !== "string") {
        return NextResponse.json({ error: "name must be a string or null" }, { status: 400 });
      } else {
        const trimmed = body.name.trim();
        if (trimmed.length > 200) {
          return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
        }
        patch.name = trimmed.length > 0 ? trimmed : null;
      }
    }
```

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/invoices/[id]/line-items/[item_id]/route.ts
git commit -m "api(67e): accept name on invoice line-item PUT"
```

---

## Phase 4 — AddItemDialog UI

### Task 11: AddItemDialog Library tab — fix template-mode local item to set `name` and `description` separately

**Files:**
- Modify: `src/components/estimate-builder/add-item-dialog.tsx:144-164`

- [ ] **Step 1: Replace the `description: libItem.name` hack**

Find the template-mode block at [src/components/estimate-builder/add-item-dialog.tsx:146-164](../../src/components/estimate-builder/add-item-dialog.tsx:146):

```ts
      if (mode === "template") {
        const localItem = {
          id: crypto.randomUUID(),
          section_id: sectionId,
          library_item_id: libItem.id,
          description: libItem.name,
          code: libItem.code ?? null,
          quantity: libItem.default_quantity,
          unit: libItem.default_unit ?? null,
          unit_price: libItem.unit_price,
          sort_order: 0,
        } as unknown as EstimateLineItem;
```

Replace the body with:

```ts
      if (mode === "template") {
        const localItem = {
          id: crypto.randomUUID(),
          section_id: sectionId,
          library_item_id: libItem.id,
          name: libItem.name,
          description: libItem.description,
          code: libItem.code ?? null,
          quantity: libItem.default_quantity,
          unit: libItem.default_unit ?? null,
          unit_price: libItem.unit_price,
          sort_order: 0,
        } as unknown as EstimateLineItem;
```

- [ ] **Step 2: Verify the parent template-mode `onLineItemAdded` reads name correctly**

Open [src/components/estimate-builder/estimate-builder.tsx:1169-1201](../../src/components/estimate-builder/estimate-builder.tsx:1169) and confirm the template branch spreads `newItem` into the section's `items` array — it does (`items: [...sec.items, newItem as any]`). After Task 6's type addition, the `name` field rides along untouched. No edit needed here.

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/estimate-builder/add-item-dialog.tsx
git commit -m "ui(67e): library tab template-mode populates name + description separately"
```

### Task 12: AddItemDialog Custom tab — add optional name input field

**Files:**
- Modify: `src/components/estimate-builder/add-item-dialog.tsx:316-521`

- [ ] **Step 1: Add `name` state and an input above the description block**

Inside the `CustomTab` component, add a `name` state next to `description` at [src/components/estimate-builder/add-item-dialog.tsx:333](../../src/components/estimate-builder/add-item-dialog.tsx:333):

```tsx
  const [name, setName] = useState("");
```

Then, in the JSX return, insert the name field above the existing Description block at [line 433-447](../../src/components/estimate-builder/add-item-dialog.tsx:433):

```tsx
      {/* Name (optional) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="custom-name" className="text-sm font-medium">
          Name
        </Label>
        <Input
          id="custom-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="Optional title (e.g. Asbestos Testing)"
          className="text-sm"
        />
      </div>
```

- [ ] **Step 2: Validate name length client-side**

In `handleAddCustom` at [line 340-417](../../src/components/estimate-builder/add-item-dialog.tsx:340), add this validation immediately after the existing description trim/length checks (around [line 348-349](../../src/components/estimate-builder/add-item-dialog.tsx:348)):

```ts
    const nameTrimmed = name.trim();
    if (nameTrimmed.length > 200) {
      toast.error("Name too long (max 200)");
      return;
    }
    const namePayload = nameTrimmed.length > 0 ? nameTrimmed : null;
```

- [ ] **Step 3: Pass `name` into both code paths**

In the template-mode local-item block at [line 367-386](../../src/components/estimate-builder/add-item-dialog.tsx:367):

```ts
      if (mode === "template") {
        const localItem = {
          id: crypto.randomUUID(),
          section_id: sectionId,
          library_item_id: null,
          name: namePayload,
          description: description.trim(),
          code: code.trim() || null,
          quantity: qty,
          unit: unit.trim() || null,
          unit_price: price,
          sort_order: 0,
        } as unknown as EstimateLineItem;
        onAdded(localItem);
        toast.success("Item added");
        onClose();
        return;
      }
```

In the POST body at [line 388-400](../../src/components/estimate-builder/add-item-dialog.tsx:388):

```ts
      const res = await fetch(`/api/${entityBase}/${estimateId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_id: sectionId,
          library_item_id: null,
          name: namePayload,
          description: description.trim(),
          code: code.trim() || null,
          quantity: qty,
          unit: unit.trim() || null,
          unit_price: price,
        }),
      });
```

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/estimate-builder/add-item-dialog.tsx
git commit -m "ui(67e): add optional name field to custom-item tab"
```

---

## Phase 5 — LineItemRow stacked layout

### Task 13: LineItemRow — stack bold name above muted description

**Files:**
- Modify: `src/components/estimate-builder/line-item-row.tsx`

- [ ] **Step 1: Add `name` local state, sync, and commit handler**

In `src/components/estimate-builder/line-item-row.tsx`, after the existing `description` state at [line 80](../../src/components/estimate-builder/line-item-row.tsx:80), add:

```ts
  const [name, setName] = useState(item.name ?? "");
```

In the `useEffect` props-sync at [line 87-93](../../src/components/estimate-builder/line-item-row.tsx:87), add `setName` and the dependency:

```ts
  useEffect(() => {
    setName(item.name ?? "");
    setDescription(item.description);
    setCode(item.code ?? "");
    setQuantity(String(item.quantity));
    setUnit(item.unit ?? "");
    setUnitPrice(String(item.unit_price));
  }, [item.name, item.description, item.code, item.quantity, item.unit, item.unit_price]);
```

After `commitDescription` at [line 105-115](../../src/components/estimate-builder/line-item-row.tsx:105), add:

```ts
  function commitName() {
    const trimmed = name.trim();
    const next: string | null = trimmed.length > 0 ? trimmed : null;
    if (next !== (item.name ?? null)) {
      onChange({ name: next });
    }
  }
```

- [ ] **Step 2: Restructure the JSX to a two-row stack**

Replace the entire return at [line 159-296](../../src/components/estimate-builder/line-item-row.tsx:159) with:

```tsx
  return (
    <div
      ref={setNodeRef}
      id={domId}
      style={style}
      className={cn(
        "group flex items-start gap-1 px-2 py-1.5 rounded-md border border-border bg-card text-sm",
        isDragging && "ring-2 ring-primary/30 shadow-md",
        readOnly && "opacity-75"
      )}
    >
      {/* Drag handle */}
      {!readOnly && (
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          <GripVertical size={14} />
        </button>
      )}
      {readOnly && <span className="w-5 shrink-0" />}

      {/* Stacked name + description column */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <input
          type="text"
          value={name}
          maxLength={200}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Item name"
          className={cn(
            "w-full bg-transparent border-0 outline-none ring-0 font-semibold text-sm text-foreground placeholder:text-muted-foreground/60",
            "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
            "disabled:cursor-default disabled:opacity-60"
          )}
        />
        <input
          type="text"
          value={description}
          maxLength={2000}
          disabled={readOnly}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Description"
          className={cn(
            "w-full bg-transparent border-0 outline-none ring-0 text-sm text-muted-foreground placeholder:text-muted-foreground/50",
            "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
            "disabled:cursor-default disabled:opacity-60"
          )}
        />
      </div>

      {/* Right-side fields, top-aligned with the name row */}
      <input
        type="text"
        value={code}
        disabled={readOnly}
        onChange={(e) => setCode(e.target.value)}
        onBlur={commitCode}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Code"
        className={cn(
          "w-20 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-muted-foreground placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      <input
        type="number"
        value={quantity}
        disabled={readOnly}
        onChange={(e) => setQuantity(e.target.value)}
        onBlur={commitQuantity}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Qty"
        className={cn(
          "w-16 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-foreground tabular-nums text-right placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      <input
        type="text"
        value={unit}
        disabled={readOnly}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={commitUnit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Unit"
        className={cn(
          "w-14 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-muted-foreground placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      <input
        type="number"
        value={unitPrice}
        disabled={readOnly}
        onChange={(e) => setUnitPrice(e.target.value)}
        onBlur={commitUnitPrice}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="0.00"
        className={cn(
          "w-24 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-foreground tabular-nums text-right placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      <span className="w-24 shrink-0 mt-0.5 text-right font-mono tabular-nums text-sm text-foreground">
        {formatCurrency(liveTotal)}
      </span>

      {!readOnly ? (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 mt-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
          aria-label="Delete line item"
        >
          <Trash2 size={13} />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
    </div>
  );
```

The container switched from `items-center` to `items-start` so the right-side fields can pin to the top (name) row via the `mt-0.5` consistent shim.

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Visual smoke test**

Start the dev server (`npm run dev`) and open `/jobs/<any-job>` → "+ New Estimate" → add a section → "+ Add Item". Pick any library item.

Expected:
- The new row shows the library item's name in bold on the top line
- The description appears in muted text directly below
- Code/qty/unit/price/total/delete are all on the right and align with the name row

If the layout looks broken, fix it and re-screenshot before commit.

- [ ] **Step 5: Commit**

```bash
git add src/components/estimate-builder/line-item-row.tsx
git commit -m "ui(67e): stack bold name above muted description in LineItemRow"
```

---

## Phase 6 — PDF SectionsTable

### Task 14: PDF SectionsTable — stack name above description in the Description cell

**Files:**
- Modify: `src/lib/pdf-renderer/components/sections-table.tsx:58-71`
- Modify: `src/lib/pdf-renderer/styles.ts` (only if a `tdName` style isn't already defined; otherwise reuse)

- [ ] **Step 1: Inspect the current `styles.ts` to decide on the new style**

Open `src/lib/pdf-renderer/styles.ts` and locate the `tdDesc` style. Add a sibling `tdName` immediately below it (or wherever the table-cell styles cluster). Style intent: bold weight, default text color, same width/flex as `tdDesc` (so the column geometry is preserved when the name+desc are wrapped in a stacked View).

If `tdDesc` is defined like `{ flex: <n>, padding: …, color: '#…' }` then `tdName` should mirror flex/padding and override color to the default body color (e.g. `#111`) and `fontWeight: 'bold'` (or `700`). The exact values should match the file's existing convention; do not invent new tokens.

If `styles.tdDesc` already includes `fontWeight: 'normal'` and a default color, you may instead just leave `tdDesc` as-is and add `tdName` as `{ ...tdDesc, fontWeight: 'bold' }` literal. That keeps the file change small.

- [ ] **Step 2: Replace the description cell with a stacked View**

In [src/lib/pdf-renderer/components/sections-table.tsx:58-71](../../src/lib/pdf-renderer/components/sections-table.tsx:58):

```tsx
  function renderItemRow(item: LineItem, key: string) {
    const total = lineTotal(item);
    const itemName = item.name ?? null;
    return (
      <View key={key} style={styles.tr} wrap={false}>
        {preset.show_code_column && <Text style={styles.tdCode}>{item.code ?? ""}</Text>}
        <View style={styles.tdDesc}>
          {itemName && <Text style={styles.tdName}>{itemName}</Text>}
          <Text>{item.description}</Text>
        </View>
        <Text style={styles.tdQty}>{Number(item.quantity)}</Text>
        <Text style={styles.tdUnit}>{item.unit ?? ""}</Text>
        <Text style={styles.tdPrice}>{fmt(Number(item.unit_price))}</Text>
        <Text style={styles.tdTotal}>{fmt(total)}</Text>
        {preset.show_notes_column && <Text style={styles.tdNotes}>{/* always empty for v1 */}</Text>}
      </View>
    );
  }
```

The View now wraps both lines and inherits `tdDesc`'s flex/width sizing (the column geometry is preserved). The inner `<Text style={styles.tdName}>` is bold; the description `<Text>` is unstyled and inherits muted color via the View's parent or its own `color` prop on the existing `tdDesc` style — verify visually after Step 4.

If the PDF layout shows the name and description on top of each other or with bad spacing, set `styles.tdName.marginBottom = 1` (or 2) to add a sliver of breathing room.

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```

Expected: PASS. `react-pdf` types accept Views inside table-row Views (the existing layout already uses nested Views for sections).

- [ ] **Step 4: Render a real PDF to verify layout**

In the dev server, open an estimate with one line item that has a name + description (created via the Library tab — see Task 11). Hit the Export PDF affordance. Open the rendered PDF.

Expected:
- The Description column shows the item's name in bold on the first line
- The description appears in default text below (or muted, depending on whether `tdDesc` color is already softer)
- Existing rows that have NULL name (legacy data) render description-only with no orphan blank line above

If the layout is broken or the bold name renders too wide, adjust `tdName` and re-render. Iterate until the rendered PDF matches the spec §4.6 description.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf-renderer/components/sections-table.tsx src/lib/pdf-renderer/styles.ts
git commit -m "pdf(67e): stack bold name above description in line-item rows"
```

---

## Phase 7 — Manual verification (§11 of the spec)

### Task 15: Test 1 — Library "happy path" on draft estimate

**Files:**
- Read-only — execution + observation.

- [ ] **Step 1: Add a fresh draft estimate to a Test Co job**

In the dev or staging frontend, open `/jobs/<test-job>` → "+ New Estimate" → add a section → "+ Add Item" → switch to Library tab.

- [ ] **Step 2: Add `Asbestos Testing` (or any library item with both name + description set)**

Click "+ Add" on the row.

Expected: builder line item shows `Asbestos Testing` in bold on the top line, the lab analysis description in muted text below.

- [ ] **Step 3: Reload the page**

Expected: the bold/muted layout persists. The name was actually saved (not just rendered transiently).

- [ ] **Step 4: Export PDF**

Expected: PDF Description column shows bold name above description in the same stacked layout.

If any expected outcome fails — capture the failure and stop. Do not proceed to Test 2.

### Task 16: Test 2 — Convert preserves name end-to-end

**Files:**
- Read-only.

- [ ] **Step 1: Approve the estimate from Test 1**

Use the existing Approve flow in the estimate detail page.

- [ ] **Step 2: Click Convert**

The convert action should produce a new draft invoice.

- [ ] **Step 3: Open the resulting invoice**

Expected: line items in the invoice show the same bold name above muted description in the builder.

- [ ] **Step 4: Export the invoice PDF**

Expected: invoice PDF Description column matches the estimate PDF — bold name above muted description.

If `name` is missing on the invoice's line items the convert RPC's name copy is broken — diff the live RPC body via `pg_get_functiondef` against the migration, fix, re-apply.

### Task 17: Test 3 — Apply-template preserves name

**Files:**
- Read-only.

- [ ] **Step 1: Create a template that includes a library item with a name**

In Templates editor: build a template with at least one library-backed item (the in-builder line item in the template editor will show bold name above description per Task 13).

- [ ] **Step 2: Save Template**

The library_item_id is captured into `template.structure`; `name` itself is not stored in JSON (lib-only).

- [ ] **Step 3: Apply the template to a new draft estimate**

Create a new draft estimate, click Apply Template, pick the saved template.

Expected: the materialized line item shows bold name above muted description, with the name resolved from the current library `name` value.

If the name is NULL on the materialized item, the apply RPC's `v_lib.name` write is broken — diff the live RPC body, fix, re-apply.

### Task 18: Test 4 — Existing pre-67e estimates render cleanly

**Files:**
- Read-only.

- [ ] **Step 1: Open an estimate created before today**

Pick any estimate listed before 2026-05-06. Open the builder.

Expected: rows render with description only, no broken layout, no NULL artifacts visible. The name `<input>` appears with the placeholder "Item name" but shows nothing else.

- [ ] **Step 2: Export the PDF**

Expected: PDF rows show description only (no orphan empty line where the name would be).

### Task 19: Test 5 — Edit name in builder persists

**Files:**
- Read-only.

- [ ] **Step 1: Click the name input on a line item**

Type a custom name (e.g. `Mold Remediation`).

- [ ] **Step 2: Blur the input**

Expected: the auto-save fires (network request to the PUT route). No error toast.

- [ ] **Step 3: Reload the page**

Expected: the name persists.

### Task 20: Test 6 — Edit description in builder still works

**Files:**
- Read-only.

- [ ] **Step 1: Click the description input on a line item**

Type a new description.

- [ ] **Step 2: Blur, reload**

Expected: description persists, name unchanged.

### Task 21: Test 7 — Custom item path

**Files:**
- Read-only.

- [ ] **Step 1: Add a custom item via the Custom tab**

Type a name (e.g. `Demo Hammer Hire`), description, qty, price.

Expected: form accepts the name; submit succeeds; new row shows bold name above description.

- [ ] **Step 2: Reload — name persists**

If the row shows description-only, the custom-tab code path is dropping the name. Re-check Task 12.

### Task 22: Test 8 — Permission gate

**Files:**
- Read-only.

- [ ] **Step 1: Sign in as a `crew_lead` user (no `edit_estimates` permission)**

Open the same estimate.

Expected: the name input is read-only or hidden, mirroring the description today. Crew leads cannot mutate either field.

If the name input becomes editable while description stays read-only — there's a conditional miss in the row component. Re-check the `readOnly` prop wiring on the new name `<input>` in Task 13.

### Task 23: Test 9 — Multi-tenant

**Files:**
- Read-only.

- [ ] **Step 1: Repeat Tests 1 + 2 in AAA Disaster Recovery**

Switch tenant via the org switcher; create + convert a small estimate with a library item.

Expected: the name flows through end-to-end. No leakage of items from Test Co.

---

## Phase 8 — Wrap-up

### Task 24: Final type/lint sweep

**Files:**
- Read-only validation.

- [ ] **Step 1: Run tsc**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 2: Run the project's lint**

```bash
npm run lint
```

Expected: clean (or only pre-existing warnings — diff against the pre-67e baseline if unsure).

- [ ] **Step 3: Re-run `git status`**

Expected: only the files this plan touches show changes; nothing stray.

### Task 25: Update `00-NOW.md`

**Files:**
- Modify: `docs/vault/00-NOW.md`

- [ ] **Step 1: Replace the active-build line and the recently-learned bullet**

The current top of `00-NOW.md` should reflect 67d wrap. Replace the active build line with `Build 67e — line-item name (title) on estimates and invoices` and add a "Recently learned" entry like:

```markdown
- 2026-05-06 — Added nullable `name text` to estimate_line_items and invoice_line_items; the convert + apply-template RPCs now carry name through, the builder/PDF render bold name above muted description, and the AddItemDialog Library tab template-mode local item is no longer using the `description: libItem.name` hack.
```

The exact phrasing should match the file's existing voice; the previous skill (start-of-session-orientation) reads from this file — keep it dense.

- [ ] **Step 2: Commit the vault bump**

```bash
git add docs/vault/00-NOW.md
git commit -m "vault: 67e ship state"
```

### Task 26: Final commit + handoff

**Files:**
- None.

- [ ] **Step 1: Run `/handoff` (or invoke the `end-of-session-handoff` skill)**

This writes the dated handoff doc and updates `00-NOW.md` if anything else needs polish.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin claude/crazy-saha-20b6b1
```

- [ ] **Step 3: Open a PR or merge per the repo's normal flow**

The branch contains: 1 migration, 1 RPC double-replace inside the same migration, type updates, four API route updates, two dialog changes, one row layout refactor, one PDF cell change, vault bump, handoff doc. Roughly 11 commits.

---

## Self-review checklist

Verified before final save:

1. **Spec coverage:** every §4 deliverable maps to a task — schema (Task 4), convert RPC (Task 4), apply-template RPC (Task 4), type updates (Task 6), API POST/PUT for both estimate + invoice (Tasks 7-10), AddItemDialog Library + Custom tabs (Tasks 11-12), LineItemRow stack (Task 13), PDF SectionsTable (Task 14). Every §6 verification step maps to a task in Phase 7 (Tasks 15-23).

2. **Placeholder scan:** no "TBD", no "implement appropriate validation", no "similar to Task N" without showing the code. The two RPC bodies in Task 4 are full literal carry-forwards from prod (per pre-flight). Every code change shows the exact code.

3. **Type consistency:** `name: string | null` is the same shape across `EstimateLineItem`, `InvoiceLineItem`, `TemplateWithContents` items, the API POST/PUT payloads, and the AddItemDialog local items. The RPCs' `v_lib.name` and `v_item.name` references match the column name added in Step 1 of Task 4.

4. **Open questions resolved:**
   - Q1 (apply-template RPC) — yes, RPC INSERTs into estimate_line_items twice; both inserts updated.
   - Q2 (custom-item name validation) — optional; trim; max 200; empty → null.
   - Q3 (AddItemDialog Custom tab needs name) — yes, added in Task 12.
   - Q4 (max length) — 200 (matches `item_library.name` cap; spec's suggested 500 rejected for round-trip safety).
   - Q5 (audit) — left as-is per spec.

5. **Risk callouts honored:** convert RPC verification (Task 16) explicitly checks the manual convert path before declaring done, per spec §8.

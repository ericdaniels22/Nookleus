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

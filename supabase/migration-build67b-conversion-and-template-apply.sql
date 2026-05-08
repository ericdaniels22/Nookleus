-- Build 67b — Estimate→Invoice conversion + Apply Template RPCs
-- Spec: docs/superpowers/specs/2026-05-01-build-67b-design.md (§5)

-- ============================================================================
-- 1. CHECK constraint: void-when-converted guard
-- ============================================================================
-- Backstops the API-level "cannot void a converted estimate" rule.
ALTER TABLE estimates
  ADD CONSTRAINT estimates_no_void_when_converted
  CHECK (NOT (status = 'voided' AND converted_to_invoice_id IS NOT NULL));

-- ============================================================================
-- 2. RPC: convert_estimate_to_invoice(p_estimate_id) → uuid
-- ============================================================================
CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(p_estimate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_estimate     estimates%ROWTYPE;
  v_org_id       uuid;
  v_job_id       uuid;
  v_inv_number   text;
  v_inv_seq      integer;
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
  -- 1. Lock and validate estimate
  SELECT * INTO v_estimate FROM estimates WHERE id = p_estimate_id FOR UPDATE;
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

  -- 2. Generate next invoice number (delegate to 67a RPC)
  SELECT t.invoice_number, t.sequence_number
    INTO v_inv_number, v_inv_seq
    FROM generate_invoice_number(v_job_id) t;

  -- 3. Read default due-days from settings
  SELECT COALESCE(NULLIF(value, '')::integer, 30) INTO v_due_days
    FROM company_settings
   WHERE organization_id = v_org_id AND key = 'default_invoice_due_days';
  v_due_days := COALESCE(v_due_days, 30);
  v_due_date := CURRENT_DATE + v_due_days;

  -- 4. INSERT new invoice (status='draft', issued today, due today + N)
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

  -- 5a. Copy top-level sections, build old_id → new_id map
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

  -- 5b. Copy subsections (parent_section_id remapped)
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

  -- 6. Copy line items (section_id remapped via map; estimate.total → invoice.amount)
  FOR v_item IN
    SELECT id, section_id, library_item_id, description, code,
           quantity, unit, unit_price, total, sort_order
      FROM estimate_line_items
     WHERE estimate_id = p_estimate_id
     ORDER BY sort_order
  LOOP
    v_old_section_id := v_item.section_id;
    INSERT INTO invoice_line_items (
      organization_id, invoice_id, section_id, library_item_id,
      description, code, quantity, unit, unit_price, amount, sort_order, xactimate_code
    ) VALUES (
      v_org_id, v_new_invoice_id,
      (v_section_map->>(v_old_section_id::text))::uuid,
      v_item.library_item_id,
      v_item.description, v_item.code, v_item.quantity, v_item.unit,
      v_item.unit_price, v_item.total, v_item.sort_order, v_item.code
    );
    v_subtotal := v_subtotal + v_item.total;
  END LOOP;

  v_subtotal := round(v_subtotal::numeric, 2);

  -- 7. Update estimate (mark converted)
  UPDATE estimates SET
    status = 'converted',
    converted_to_invoice_id = v_new_invoice_id,
    converted_at = now(),
    updated_at = now()
  WHERE id = p_estimate_id;

  -- 8. Recompute invoice totals (mirror lib/builder-shared.ts recalculateMonetary)
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
$$;

-- ============================================================================
-- 3. RPC: apply_template_to_estimate(p_estimate_id, p_template_id) → jsonb
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_template_to_estimate(
  p_estimate_id uuid,
  p_template_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_estimate    estimates%ROWTYPE;
  v_template    estimate_templates%ROWTYPE;
  v_section_count integer;
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
BEGIN
  -- 1. Lock + validate estimate
  SELECT * INTO v_estimate FROM estimates WHERE id = p_estimate_id FOR UPDATE;
  IF v_estimate.id IS NULL THEN
    RAISE EXCEPTION 'estimate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_estimate.status <> 'draft' THEN
    RAISE EXCEPTION 'estimate_not_draft' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_section_count
    FROM estimate_sections WHERE estimate_id = p_estimate_id;
  IF v_section_count > 0 THEN
    RAISE EXCEPTION 'estimate_not_empty' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Fetch template
  SELECT * INTO v_template FROM estimate_templates WHERE id = p_template_id;
  IF v_template.id IS NULL OR v_template.is_active = false
     OR v_template.organization_id <> v_estimate.organization_id THEN
    RAISE EXCEPTION 'template_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Parse structure
  v_struct := v_template.structure;

  -- 4. Loop sections
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

    -- Items directly under this section
    v_item_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_section->'items', '[]'::jsonb))
    LOOP
      v_lib_id := NULLIF(v_item->>'library_item_id', '')::uuid;
      v_placeholder := false;

      -- Library lookup (active + same org)
      IF v_lib_id IS NOT NULL THEN
        SELECT * INTO v_lib FROM item_library
         WHERE id = v_lib_id AND is_active = true
           AND organization_id = v_estimate.organization_id;
      ELSE
        v_lib.id := NULL;
      END IF;

      -- Coalesce: override → library current → placeholder default
      v_desc := COALESCE(NULLIF(v_item->>'description_override', ''), v_lib.description, '[unknown item]');
      v_qty := COALESCE(NULLIF(v_item->>'quantity_override', '')::numeric, v_lib.default_quantity, 1);
      v_unit_price := COALESCE(NULLIF(v_item->>'unit_price_override', '')::numeric, v_lib.unit_price, 0);
      v_unit := v_lib.default_unit;  -- only fill from library
      v_code := v_lib.code;
      v_total := round((v_qty * v_unit_price)::numeric, 2);

      -- Detect broken-ness: lib_id was set but lookup failed
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

      INSERT INTO estimate_line_items (
        organization_id, estimate_id, section_id, library_item_id,
        description, code, quantity, unit, unit_price, total, sort_order
      ) VALUES (
        v_estimate.organization_id, p_estimate_id, v_new_section_id,
        CASE WHEN v_lib.id IS NOT NULL THEN v_lib.id ELSE NULL END,
        v_desc, v_code, v_qty, v_unit, v_unit_price, v_total,
        COALESCE((v_item->>'sort_order')::integer, v_item_idx)
      );
      v_line_item_count_out := v_line_item_count_out + 1;
      v_item_idx := v_item_idx + 1;
    END LOOP;

    -- Subsections of this section
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

        INSERT INTO estimate_line_items (
          organization_id, estimate_id, section_id, library_item_id,
          description, code, quantity, unit, unit_price, total, sort_order
        ) VALUES (
          v_estimate.organization_id, p_estimate_id, v_new_subsection_id,
          CASE WHEN v_lib.id IS NOT NULL THEN v_lib.id ELSE NULL END,
          v_desc, v_code, v_qty, v_unit, v_unit_price, v_total,
          COALESCE((v_item->>'sort_order')::integer, v_item_idx)
        );
        v_line_item_count_out := v_line_item_count_out + 1;
        v_item_idx := v_item_idx + 1;
      END LOOP;
      v_subsection_idx := v_subsection_idx + 1;
    END LOOP;

    v_section_idx := v_section_idx + 1;
  END LOOP;

  -- 6. Apply statements (template wins if non-null + non-empty)
  IF v_template.opening_statement IS NOT NULL AND v_template.opening_statement <> '' THEN
    UPDATE estimates SET opening_statement = v_template.opening_statement
     WHERE id = p_estimate_id;
  END IF;
  IF v_template.closing_statement IS NOT NULL AND v_template.closing_statement <> '' THEN
    UPDATE estimates SET closing_statement = v_template.closing_statement
     WHERE id = p_estimate_id;
  END IF;

  -- 7. Recalc estimate totals (delegate to the existing 67a logic in TS — we just touch updated_at here)
  UPDATE estimates SET updated_at = now() WHERE id = p_estimate_id;

  -- 8. Return result
  RETURN jsonb_build_object(
    'section_count', v_section_count_out,
    'line_item_count', v_line_item_count_out,
    'broken_refs', v_broken_refs
  );
END;
$$;

-- ============================================================================
-- 4. Grants — both RPCs callable by authenticated role (RLS handles cross-org)
-- ============================================================================
GRANT EXECUTE ON FUNCTION convert_estimate_to_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_template_to_estimate(uuid, uuid) TO authenticated;

-- Build 67b cleanup — RPC fixes (I2, I4) + minor comment / variable cleanups (M3/M4/M6/M7/M8)

-- ============================================================================
-- 1. convert_estimate_to_invoice — I2 fix: regex-safe settings cast
-- ============================================================================
-- Header: this RPC is invoked by POST /api/estimates/[id]/convert (route maps
--   the RAISE EXCEPTION strings below to HTTP responses; do NOT change the
--   strings without updating the route):
--     'estimate_not_found'           → 404
--     'estimate_not_approved'        → 409 (must be approved before convert)
--     'estimate_already_converted:%' → 409 (existing_invoice_id parsed from %)
--   ERRCODE: P0001 = client-recoverable; P0002 = not-found.
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

  SELECT t.invoice_number, t.sequence_number
    INTO v_inv_number, v_inv_seq
    FROM generate_invoice_number(v_job_id) t;

  -- I2 fix: defensive cast for default_invoice_due_days. The settings UI
  -- validates input, but a malformed value here would otherwise raise
  -- 22P02 invalid_text_representation and abort the entire conversion.
  -- Read raw, regex-check, then cast — falling back to 30 on any miss.
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

  FOR v_item IN
    SELECT id, section_id, library_item_id, description, code,
           quantity, unit, unit_price, total, sort_order
      FROM estimate_line_items
     WHERE estimate_id = p_estimate_id
     ORDER BY sort_order
  LOOP
    v_old_section_id := v_item.section_id;
    -- xactimate_code dual-write retained pending I1 cleanup (deferred to 67c).
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

  UPDATE estimates SET
    status = 'converted',
    converted_to_invoice_id = v_new_invoice_id,
    converted_at = now(),
    updated_at = now()
  WHERE id = p_estimate_id;

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
-- 2. apply_template_to_estimate — I4 fix: inline totals recompute + M3/M4/M6/M7/M8
-- ============================================================================
-- Header: this RPC is invoked by POST /api/estimates/[id]/apply-template
--   (route maps the RAISE EXCEPTION strings below to HTTP responses; do NOT
--   change the strings without updating the route):
--     'estimate_not_found'              → 404
--     'estimate_not_draft'              → 409 (template can only apply to draft)
--     'estimate_not_empty'              → 409 (must be empty before apply)
--     'template_not_found_or_inactive'  → 404
--   ERRCODE: P0001 = client-recoverable; P0002 = not-found.
-- M3 note: the body fills `unit` and `code` from the library item only —
--   templates never override these fields by design (per spec §4).
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
  v_existing_section_count integer; -- M4 rename: was v_section_count (clashes visually with v_section_count_out)
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
  -- I4 totals scratchpad
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
      END IF;
      v_desc := COALESCE(NULLIF(v_item->>'description_override', ''), v_lib.description, '[unknown item]');
      -- M6: COALESCE the lib defaults explicitly in case schema relaxes NOT NULL later.
      v_qty := COALESCE(NULLIF(v_item->>'quantity_override', '')::numeric, v_lib.default_quantity, 1);
      v_unit_price := COALESCE(NULLIF(v_item->>'unit_price_override', '')::numeric, v_lib.unit_price, 0);
      -- M3: unit + code are library-only — templates never override.
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

      INSERT INTO estimate_line_items (
        organization_id, estimate_id, section_id, library_item_id,
        description, code, quantity, unit, unit_price, total, sort_order
      ) VALUES (
        v_estimate.organization_id, p_estimate_id, v_new_section_id,
        CASE WHEN v_lib.id IS NOT NULL THEN v_lib.id ELSE NULL END,
        v_desc, v_code, v_qty, v_unit, v_unit_price, v_total,
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
        END IF;
        v_desc := COALESCE(NULLIF(v_item->>'description_override', ''), v_lib.description, '[unknown item]');
        -- M7: same defensive COALESCE as the parent-section branch.
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

  -- I4 fix: inline totals recompute, mirroring convert_estimate_to_invoice.
  -- Previously this RPC only bumped updated_at; the route handler called
  -- recalculateTotals() in TS afterward. Direct callers (Studio / future
  -- code / manual ops) would otherwise leave subtotal/total stale.
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
$$;

-- ============================================================================
-- 3. Re-grants — necessary because CREATE OR REPLACE preserves grants in PG 15+,
--   but include them explicitly for parity with the original migration.
-- ============================================================================
GRANT EXECUTE ON FUNCTION convert_estimate_to_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_template_to_estimate(uuid, uuid) TO authenticated;

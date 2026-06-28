-- ============================================================================
-- Build 87: #686 — Equipment pricing carry-through on template→estimate apply
-- ============================================================================
--
-- Equipment "pieces × days" rows now survive the template→estimate apply. The
-- pricing fields ride the template `structure` JSONB blob (no schema change to
-- templates — they have no line-item table), and apply_template_to_estimate
-- reads them per item: an equipment row lands on the new Estimate in pieces×days
-- mode with `quantity = pieces × days`, and its note is RE-DERIVED at apply time
-- (NOT copied from the stored note) so the "N units for M days" string is always
-- consistent with the live pieces/days. A standard row applies exactly as before
-- (pricing_mode='standard', NULL pieces/days, stored note preserved).
--
-- Per the #679/#682 data-model decision this mode is an input affordance plus a
-- derived note, NOT a second pricing formula: pieces × days collapses into the
-- existing `quantity`, so `total = quantity × unit_price` and every downstream
-- consumer (subtotals, markup/discount/tax recompute, PDF) stays
-- equipment-ignorant. estimate_line_items already carries pricing_mode/pieces/
-- days (build85, #682), so this migration is a function replace only — no table
-- change.
--
-- MIGRATION DISCIPLINE (#686): this CREATE OR REPLACE was authored against the
-- LATEST LIVE body, fetched verbatim via pg_get_functiondef immediately before
-- writing — the flat-snapshot variant that is actually live on prod. NOTE: issue
-- #686 names build67b as the base, but that is STALE; the live function is a
-- later snapshot-pattern revision (no library lookup / description_override /
-- broken_refs), so basing the edit on build67b would have silently reverted it.
-- The ONLY changes from the live body are: (a) three DECLAREs (v_mode/v_pieces/
-- v_days); (b) an equipment block in EACH of the two item loops (section items
-- and subsection items) that, for pricing_mode='pieces_days', overrides v_qty
-- with pieces×days and v_note with the re-derived string; and (c) the three
-- columns threaded into both INSERTs. Everything else — the estimate/template
-- guards, the opening/closing statements, the subtotal/markup/discount/tax/total
-- recompute, the returned counts — is byte-for-byte unchanged.
--
-- The re-derivation string formatting is verified equal to deriveEquipmentNote()
-- (src/components/estimate-builder/equipment-pricing.ts): singular "unit"/"day"
-- at 1, plural otherwise, and trim_scale() so a clean integer renders "3" not
-- "3.00".
--
-- Idempotent (CREATE OR REPLACE). Run in the Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_template_to_estimate(p_estimate_id uuid, p_template_id uuid)
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
  v_name        text;
  v_desc        text;
  v_note        text;
  v_qty         numeric(10,2);
  v_unit_price  numeric(10,2);
  v_unit        text;
  v_code        text;
  v_total       numeric(10,2);
  -- #686: equipment "pieces × days" carry-through. v_pieces/v_days are unscoped
  -- numeric so trim_scale() in the re-derived note renders clean integers.
  v_mode        text;
  v_pieces      numeric;
  v_days        numeric;
  v_section_count_out integer := 0;
  v_line_item_count_out integer := 0;
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
      v_lib_id     := NULLIF(v_item->>'library_item_id', '')::uuid;
      v_name       := NULLIF(v_item->>'name', '');
      v_desc       := COALESCE(NULLIF(v_item->>'description', ''), '[unknown item]');
      v_note       := NULLIF(v_item->>'note', '');
      v_code       := NULLIF(v_item->>'code', '');
      v_unit       := NULLIF(v_item->>'unit', '');
      v_qty        := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 1);
      v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

      -- #686: equipment "pieces × days" carry-through. For a pieces_days row,
      -- quantity = pieces × days and the note is RE-DERIVED here (the stored note
      -- is ignored), matching deriveEquipmentNote(). Standard rows keep their
      -- stored note and quantity unchanged.
      v_mode := COALESCE(NULLIF(v_item->>'pricing_mode', ''), 'standard');
      IF v_mode = 'pieces_days' THEN
        v_pieces := COALESCE(NULLIF(v_item->>'pieces', '')::numeric, 1);
        v_days   := COALESCE(NULLIF(v_item->>'days', '')::numeric, 1);
        v_qty    := v_pieces * v_days;
        v_note   := trim_scale(v_pieces)::text
                      || ' ' || CASE WHEN v_pieces = 1 THEN 'unit' ELSE 'units' END
                      || ' for ' || trim_scale(v_days)::text
                      || ' ' || CASE WHEN v_days = 1 THEN 'day' ELSE 'days' END;
      ELSE
        v_mode   := 'standard';
        v_pieces := NULL;
        v_days   := NULL;
      END IF;

      v_total      := round((v_qty * v_unit_price)::numeric, 2);

      INSERT INTO estimate_line_items (
        organization_id, estimate_id, section_id, library_item_id,
        name, description, note, code, quantity, unit, unit_price, total, sort_order,
        pricing_mode, pieces, days
      ) VALUES (
        v_estimate.organization_id, p_estimate_id, v_new_section_id,
        v_lib_id,
        v_name, v_desc, v_note, v_code, v_qty, v_unit, v_unit_price, v_total,
        COALESCE((v_item->>'sort_order')::integer, v_item_idx),
        v_mode, v_pieces, v_days
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
        v_lib_id     := NULLIF(v_item->>'library_item_id', '')::uuid;
        v_name       := NULLIF(v_item->>'name', '');
        v_desc       := COALESCE(NULLIF(v_item->>'description', ''), '[unknown item]');
        v_note       := NULLIF(v_item->>'note', '');
        v_code       := NULLIF(v_item->>'code', '');
        v_unit       := NULLIF(v_item->>'unit', '');
        v_qty        := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 1);
        v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

        -- #686: equipment "pieces × days" carry-through (subsection items).
        v_mode := COALESCE(NULLIF(v_item->>'pricing_mode', ''), 'standard');
        IF v_mode = 'pieces_days' THEN
          v_pieces := COALESCE(NULLIF(v_item->>'pieces', '')::numeric, 1);
          v_days   := COALESCE(NULLIF(v_item->>'days', '')::numeric, 1);
          v_qty    := v_pieces * v_days;
          v_note   := trim_scale(v_pieces)::text
                        || ' ' || CASE WHEN v_pieces = 1 THEN 'unit' ELSE 'units' END
                        || ' for ' || trim_scale(v_days)::text
                        || ' ' || CASE WHEN v_days = 1 THEN 'day' ELSE 'days' END;
        ELSE
          v_mode   := 'standard';
          v_pieces := NULL;
          v_days   := NULL;
        END IF;

        v_total      := round((v_qty * v_unit_price)::numeric, 2);

        INSERT INTO estimate_line_items (
          organization_id, estimate_id, section_id, library_item_id,
          name, description, note, code, quantity, unit, unit_price, total, sort_order,
          pricing_mode, pieces, days
        ) VALUES (
          v_estimate.organization_id, p_estimate_id, v_new_subsection_id,
          v_lib_id,
          v_name, v_desc, v_note, v_code, v_qty, v_unit, v_unit_price, v_total,
          COALESCE((v_item->>'sort_order')::integer, v_item_idx),
          v_mode, v_pieces, v_days
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
    'line_item_count', v_line_item_count_out
  );
END;
$function$
;

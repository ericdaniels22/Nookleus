-- ============================================================================
-- Build 86: #684 — Equipment pricing on Invoices + estimate→invoice carry-through
-- ============================================================================
--
-- Two parts, both additive/safe:
--
-- 1. The three "pieces × days" columns on invoice_line_items, mirroring what
--    build85 added to estimate_line_items (#682). The shared line-item editor
--    is now wired for Invoices too, so an equipment row can be edited directly
--    on an Invoice exactly as on an Estimate — and the auto-save PUT persists
--    pricing_mode/pieces/days. Per the #679/#682 data-model decision this mode
--    is an input affordance plus a derived note, NOT a second pricing formula:
--    pieces × days collapses into the existing `quantity`
--    (`quantity = pieces × days`), so `amount = quantity × unit_price` and every
--    downstream consumer (subtotals, PDF, QB sync) stays equipment-ignorant.
--      - pricing_mode — 'standard' (default) or 'pieces_days'. NOT NULL with a
--        constant default, so existing rows backfill atomically (Postgres 11+
--        treats a constant default as metadata-only — no table rewrite).
--      - pieces — the piece count. NULL in standard mode.
--      - days   — the number of days. NULL in standard mode.
--    A CHECK constraint pins pricing_mode to the two known values (matching the
--    build85 estimate-side constraint).
--
-- 2. convert_estimate_to_invoice now carries pricing_mode/pieces/days from the
--    estimate line item to the new invoice line item, so a converted equipment
--    row stays in pieces × days mode (the pieces/days inputs survive, not just
--    the derived note/quantity/total). A standard row carries
--    pricing_mode='standard' + NULL pieces/days, i.e. unchanged behavior.
--
-- MIGRATION DISCIPLINE (#684): this CREATE OR REPLACE was authored against the
-- LATEST LIVE body — the build84 conversion-and-note fix — verified
-- executable-line-identical to prod via pg_get_functiondef before writing, so a
-- stale base can't silently revert #382's note carry-over (the build82b
-- mistake). The ONLY changes from build84 are the 3 equipment columns threaded
-- into the line-item loop's SELECT and INSERT; everything else — the #382 note
-- carry-over, the #575 Overhead/Profit recompute, the #67f any-status convert —
-- is byte-for-byte unchanged.
--
-- All statements are idempotent. Run in the Supabase SQL Editor.
-- ============================================================================

-- ── Part 1: equipment columns on invoice_line_items ─────────────────────────

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'standard';
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS pieces numeric;
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS days numeric;

-- Pin pricing_mode to the known values.
ALTER TABLE invoice_line_items
  DROP CONSTRAINT IF EXISTS invoice_line_items_pricing_mode_check;
ALTER TABLE invoice_line_items
  ADD CONSTRAINT invoice_line_items_pricing_mode_check
  CHECK (pricing_mode IN ('standard', 'pieces_days'));

-- ── Part 2: carry the mode through estimate→invoice conversion ──────────────

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
  v_overhead_amt numeric(10,2) := 0;
  v_profit_amt   numeric(10,2) := 0;
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
  IF v_estimate.converted_to_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'estimate_already_converted:%', v_estimate.converted_to_invoice_id
      USING ERRCODE = 'P0001';
  END IF;

  v_org_id := v_estimate.organization_id;
  v_job_id := v_estimate.job_id;

  SELECT t.invoice_number, t.sequence_number
    INTO v_inv_number, v_inv_seq
    FROM generate_invoice_number(v_job_id) t;

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
    markup_type, markup_value,
    overhead_type, overhead_value, profit_type, profit_value,
    discount_type, discount_value, tax_rate,
    converted_from_estimate_id, created_by
  ) VALUES (
    v_org_id, v_job_id, v_inv_number, v_inv_seq, v_estimate.title,
    'draft', CURRENT_DATE, v_due_date,
    v_estimate.opening_statement, v_estimate.closing_statement,
    v_estimate.markup_type, v_estimate.markup_value,
    v_estimate.overhead_type, v_estimate.overhead_value,
    v_estimate.profit_type, v_estimate.profit_value,
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

  -- #684: carry pricing_mode/pieces/days alongside the existing fields so a
  -- converted equipment row stays in pieces × days mode. quantity (= pieces ×
  -- days), the derived note (#382), and total → amount already carry over, so a
  -- read-only/paid invoice keeps the correct note + total either way; these
  -- three add back the editable raw inputs.
  FOR v_item IN
    SELECT id, section_id, library_item_id, name, description, note, code,
           quantity, unit, unit_price, total, sort_order,
           pricing_mode, pieces, days
      FROM estimate_line_items
     WHERE estimate_id = p_estimate_id
     ORDER BY sort_order
  LOOP
    v_old_section_id := v_item.section_id;
    INSERT INTO invoice_line_items (
      organization_id, invoice_id, section_id, library_item_id,
      name, description, note, code, quantity, unit, unit_price, amount, sort_order,
      pricing_mode, pieces, days
    ) VALUES (
      v_org_id, v_new_invoice_id,
      (v_section_map->>(v_old_section_id::text))::uuid,
      v_item.library_item_id,
      v_item.name, v_item.description, v_item.note, v_item.code, v_item.quantity, v_item.unit,
      v_item.unit_price, v_item.total, v_item.sort_order,
      v_item.pricing_mode, v_item.pieces, v_item.days
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

  -- #575: Overhead and Profit are each computed off the RAW subtotal and
  -- rounded to cents independently, then summed into markup_amount — matching
  -- the shared pricing waterfall (#566).
  v_overhead_amt := CASE v_estimate.overhead_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.overhead_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.overhead_value::numeric, 2)
    ELSE 0
  END;
  v_profit_amt := CASE v_estimate.profit_type
    WHEN 'percent' THEN round((v_subtotal * v_estimate.profit_value / 100)::numeric, 2)
    WHEN 'amount'  THEN round(v_estimate.profit_value::numeric, 2)
    ELSE 0
  END;
  v_markup_amt := round((v_overhead_amt + v_profit_amt)::numeric, 2);
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
    overhead_amount = v_overhead_amt,
    profit_amount = v_profit_amt,
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

GRANT EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid) TO authenticated;

-- ============================================================================
-- End of build86 migration.
-- ============================================================================

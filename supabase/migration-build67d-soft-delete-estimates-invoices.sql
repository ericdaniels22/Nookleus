-- Build 67d: Soft-delete + 30-day trash for estimates and invoices.
--
-- Mirror of build66's jobs pattern. Adds:
--   - estimates.deleted_at, estimates.delete_reason
--   - invoices.deleted_at,  invoices.delete_reason
--   - composite indexes on (organization_id, deleted_at) for both tables
--   - convert-linkage FKs switched to ON DELETE SET NULL (so independently
--     hard-purging one side never blocks the other side's purge)
--   - 6 new contract_events.event_type values
--   - convert_estimate_to_invoice RPC source-lookup deleted_at IS NULL guard
--
-- Lazy purge (>30 days) and the hard-delete itself are handled in the API
-- layer (mirrors src/app/api/jobs/trash/route.ts), since they need to delete
-- canonical PDFs from Storage in addition to cascading SQL rows.
--
-- Live constraint state captured at draft time (Task 1 pre-flight):
-- contract_events_event_type_check listed 17 values as of 67c2 wrap.
-- Both convert-linkage FKs were NO ACTION.

-- 1. New columns.
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delete_reason text;

-- 2. Composite indexes for the two list halves the UI needs:
--   WHERE organization_id = $1 AND deleted_at IS NULL      -- active list
--   WHERE organization_id = $1 AND deleted_at IS NOT NULL  -- trash list
CREATE INDEX IF NOT EXISTS idx_estimates_org_deleted_at
  ON estimates (organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_invoices_org_deleted_at
  ON invoices (organization_id, deleted_at);

-- 3. Convert-linkage FKs: NO ACTION → SET NULL.
-- Postgres lacks ALTER FK; drop + recreate is the only path. Both directions
-- of the linkage need this so a hard-purge of one side leaves the other side's
-- back-pointer NULL instead of failing the delete.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_converted_from_estimate_id_fkey;
ALTER TABLE invoices ADD CONSTRAINT invoices_converted_from_estimate_id_fkey
  FOREIGN KEY (converted_from_estimate_id) REFERENCES estimates(id) ON DELETE SET NULL;

-- Estimates side: actual constraint name is fk_estimates_converted_to_invoice
-- (diverges from plan template — confirmed by Task 1 pre-flight capture).
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS fk_estimates_converted_to_invoice;
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_converted_to_invoice_id_fkey;  -- belt-and-suspenders if a previous attempt landed a partial state
ALTER TABLE estimates ADD CONSTRAINT estimates_converted_to_invoice_id_fkey
  FOREIGN KEY (converted_to_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

-- 4. Widen contract_events.event_type CHECK.
-- Live list captured 2026-05-05 via pg_get_constraintdef:
--   17 existing values + 6 new ones for trash audit.
ALTER TABLE contract_events DROP CONSTRAINT contract_events_event_type_check;
ALTER TABLE contract_events ADD CONSTRAINT contract_events_event_type_check
  CHECK (event_type IN (
    'created','sent','email_delivered','email_opened','link_viewed',
    'signed','reminder_sent','voided','expired','paid','payment_failed',
    'refunded','partially_refunded','dispute_opened','dispute_closed',
    'estimate_sent','invoice_sent',
    'estimate_trashed','estimate_restored','estimate_purged',
    'invoice_trashed','invoice_restored','invoice_purged'
  ));

-- 5. convert_estimate_to_invoice RPC: filter trashed sources.
-- The RPC is defined in build67b. We CREATE OR REPLACE the body verbatim
-- with one extra `AND deleted_at IS NULL` on the source SELECT so trashed
-- estimates can never be silently converted from server code paths.
--
-- Live body captured 2026-05-05 via pg_get_functiondef. The source-estimate
-- SELECT (FOR UPDATE) gains AND deleted_at IS NULL so a trashed estimate
-- raises estimate_not_found rather than proceeding.
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
      description, code, quantity, unit, unit_price, amount, sort_order
    ) VALUES (
      v_org_id, v_new_invoice_id,
      (v_section_map->>(v_old_section_id::text))::uuid,
      v_item.library_item_id,
      v_item.description, v_item.code, v_item.quantity, v_item.unit,
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
$function$
;

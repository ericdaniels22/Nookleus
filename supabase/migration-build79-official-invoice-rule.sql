-- ============================================
-- Build 79 Migration: #383 — Official-invoice rule
--
-- Establishes a single source of truth, in SQL, for which invoice statuses are
-- "official" (a real bill): sent / partial / paid count; draft / voided do not.
-- This mirrors the TypeScript rule in src/lib/invoice-status.ts.
--
-- The build38 QuickBooks enqueue triggers and the payment-driven status
-- recompute now CONSULT this function instead of hard-coding status lists. Only
-- function bodies change (CREATE OR REPLACE) — the trigger BINDINGS from build38
-- are untouched.
--
-- Behaviour is preserved for every real transition. Given the invoice state
-- machine (draft -> {sent, voided}; sent -> {partial, paid, voided}; ...), the
-- only non-official -> official transition that can occur is draft -> sent —
-- exactly the create gate's previous literal. Phrasing the gate as
-- "became official" (NOT official(OLD) AND official(NEW)) additionally hardens
-- it against any future/bulk path that flips a draft straight to partial/paid.
--
-- Run in Supabase SQL Editor. All statements are CREATE OR REPLACE.
-- ============================================

-- 1. The rule. sent / partial / paid are official (a real bill); draft / voided
--    are not. IMMUTABLE so PostgreSQL can inline it. Mirrors
--    src/lib/invoice-status.ts (OFFICIAL_INVOICE_STATUSES).
CREATE OR REPLACE FUNCTION is_official_invoice_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('sent', 'partial', 'paid');
$$;

-- 2. Payment-driven status recompute (build38) — now consults the rule.
--    Non-official statuses (draft / voided) remain terminal for this function.
CREATE OR REPLACE FUNCTION recompute_invoice_status(p_invoice_id uuid)
RETURNS text AS $$
DECLARE
  current_status text;
  total numeric(10,2);
  collected numeric(10,2);
  new_status text;
BEGIN
  SELECT status, total_amount INTO current_status, total
    FROM invoices WHERE id = p_invoice_id;
  IF current_status IS NULL THEN RETURN NULL; END IF;
  IF NOT is_official_invoice_status(current_status) THEN RETURN current_status; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO collected
    FROM payments WHERE invoice_id = p_invoice_id AND status = 'received';

  IF collected >= total AND total > 0 THEN
    new_status := 'paid';
  ELSIF collected > 0 THEN
    new_status := 'partial';
  ELSE
    new_status := 'sent';
  END IF;

  IF new_status <> current_status THEN
    UPDATE invoices SET status = new_status WHERE id = p_invoice_id;
  END IF;
  RETURN new_status;
END;
$$ LANGUAGE plpgsql;

-- 3. QuickBooks invoice enqueue (build38) — the gate that decides when an
--    invoice reaches accounting. It now consults the rule:
--      * a create is enqueued when an invoice BECOMES official (was not
--        official, now is) — i.e. the draft -> sent flip;
--      * post-sync edits enqueue an update while the invoice IS official.
CREATE OR REPLACE FUNCTION trg_qb_enqueue_invoice_update()
RETURNS trigger AS $$
DECLARE
  conn qb_connection;
  contact_row contacts;
  job_row jobs;
  customer_log_id uuid;
  sub_log_id uuid;
  dep_id uuid;
BEGIN
  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;

  -- Became official (draft -> sent): enqueue create, with cascading
  -- customer/sub_customer deps.
  IF NOT is_official_invoice_status(OLD.status) AND is_official_invoice_status(NEW.status) THEN
    SELECT * INTO job_row FROM jobs WHERE id = NEW.job_id;
    IF job_row.id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO contact_row FROM contacts WHERE id = job_row.contact_id;
    IF contact_row.id IS NULL THEN RETURN NEW; END IF;

    -- Ensure parent customer is synced or queued.
    IF contact_row.qb_customer_id IS NULL THEN
      SELECT id INTO customer_log_id FROM qb_sync_log
        WHERE entity_type = 'customer' AND entity_id = contact_row.id
          AND status IN ('queued', 'failed') ORDER BY created_at DESC LIMIT 1;
      IF customer_log_id IS NULL THEN
        INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
          VALUES ('customer', contact_row.id, 'create', 'queued')
          RETURNING id INTO customer_log_id;
      END IF;
    END IF;

    -- Ensure sub-customer is synced or queued.
    IF job_row.qb_subcustomer_id IS NULL THEN
      SELECT id INTO sub_log_id FROM qb_sync_log
        WHERE entity_type = 'sub_customer' AND entity_id = job_row.id
          AND status IN ('queued', 'failed') ORDER BY created_at DESC LIMIT 1;
      IF sub_log_id IS NULL THEN
        INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id)
          VALUES ('sub_customer', job_row.id, 'create', 'queued', customer_log_id)
          RETURNING id INTO sub_log_id;
      END IF;
    END IF;

    dep_id := sub_log_id;  -- may be NULL if sub already synced; that's fine.

    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id)
      VALUES ('invoice', NEW.id, 'create', 'queued', dep_id);
    RETURN NEW;
  END IF;

  -- Any-state → Voided: enqueue void, or coalesce with a queued create.
  IF OLD.status <> 'voided' AND NEW.status = 'voided' THEN
    -- Coalesce: if a queued 'create' exists for this invoice, delete it —
    -- the invoice never reached QB so there's nothing to void.
    DELETE FROM qb_sync_log
      WHERE entity_type = 'invoice' AND entity_id = NEW.id
        AND action = 'create' AND status = 'queued';
    IF NEW.qb_invoice_id IS NOT NULL THEN
      INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
        VALUES ('invoice', NEW.id, 'void', 'queued');
    END IF;
    RETURN NEW;
  END IF;

  -- Official-invoice edits after sync: enqueue update when any field changed.
  IF NEW.qb_invoice_id IS NOT NULL
     AND is_official_invoice_status(NEW.status)
     AND (
       NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.issued_date IS DISTINCT FROM OLD.issued_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.po_number IS DISTINCT FROM OLD.po_number
       OR NEW.memo IS DISTINCT FROM OLD.memo
       OR NEW.notes IS DISTINCT FROM OLD.notes
     )
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM qb_sync_log
      WHERE entity_type = 'invoice' AND entity_id = NEW.id
        AND action = 'update' AND status = 'queued'
    ) THEN
      INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
        VALUES ('invoice', NEW.id, 'update', 'queued');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Line-item CRUD on a synced invoice (build38) — now consults the rule:
--    only official invoices enqueue a QB update.
CREATE OR REPLACE FUNCTION trg_qb_enqueue_line_item_change()
RETURNS trigger AS $$
DECLARE
  inv invoices;
  target_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.invoice_id;
  ELSE
    target_id := NEW.invoice_id;
  END IF;
  SELECT * INTO inv FROM invoices WHERE id = target_id;
  IF inv.id IS NULL OR inv.qb_invoice_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF NOT is_official_invoice_status(inv.status) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'invoice' AND entity_id = inv.id
      AND action = 'update' AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
      VALUES ('invoice', inv.id, 'update', 'queued');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- End of build79 migration.
-- ============================================

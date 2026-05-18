-- issue #114 (PRD #109), full_name slice 5 — QuickBooks sync.
--
-- Purpose:   The `contacts` table is moving from split `first_name` /
--            `last_name` columns to a single `full_name`. The QuickBooks
--            contact-update enqueue trigger still watches the legacy columns
--            to decide whether a name change should re-trigger a customer
--            sync. This migration repoints that check at `full_name`.
--
-- Function:  trg_qb_enqueue_contact_update() — last defined in
--            migration-build54-qb-trigger-organization-id.sql. Only the
--            change-detection IS-NOT-DISTINCT block is altered: `first_name`
--            and `last_name` are replaced by `full_name`. Everything else
--            (the qb_customer_id guard, active-connection lookup, dedup, and
--            organization_id-carrying INSERT) is preserved verbatim.
--
-- Coexistence: the build-110 `contacts_sync_name` trigger keeps `full_name`
--            and the legacy columns mutually consistent, so watching
--            `full_name` alone still catches every name edit during the
--            transition. The legacy columns and that trigger are dropped in
--            the cleanup slice (#115).
--
-- Idempotent: CREATE OR REPLACE — safe to re-run.

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_contact_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  conn qb_connection;
BEGIN
  IF NEW.qb_customer_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.full_name IS NOT DISTINCT FROM OLD.full_name
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone
     AND NEW.email IS NOT DISTINCT FROM OLD.email
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
  THEN RETURN NEW; END IF;

  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'customer'
      AND entity_id = NEW.id
      AND action = 'update'
      AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
    VALUES ('customer', NEW.id, 'update', 'queued', NEW.organization_id);
  END IF;

  RETURN NEW;
END;
$function$;

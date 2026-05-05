-- ============================================================================
-- Build 67c2 — Send Estimates & Invoices via Email
-- Schema deltas:
--   - 4 template columns on payment_email_settings (NOT NULL DEFAULT '')
--   - last_sent_at + last_sent_to_email on estimates + invoices
--   - widen contract_events.event_type CHECK to include estimate_sent / invoice_sent
--   - backfill default templates on every existing payment_email_settings row
--   - INSERT default rows for any org missing one (defensive)
--   - AFTER INSERT trigger on organizations: seed payment_email_settings
--     for any future-created org (mirrors 67c1's seed_default_pdf_presets)
-- ============================================================================

BEGIN;

-- 1. payment_email_settings: 4 new template columns
ALTER TABLE payment_email_settings
  ADD COLUMN estimate_send_subject_template text NOT NULL DEFAULT '',
  ADD COLUMN estimate_send_body_template    text NOT NULL DEFAULT '',
  ADD COLUMN invoice_send_subject_template  text NOT NULL DEFAULT '',
  ADD COLUMN invoice_send_body_template     text NOT NULL DEFAULT '';

-- 2. Defensive: insert payment_email_settings rows for any org missing one.
-- 18a/18b made organization_id NOT NULL; if any org slipped through this fills.
INSERT INTO payment_email_settings (organization_id, send_from_email, send_from_name, provider)
SELECT o.id, '', 'Outgoing', 'resend'
  FROM organizations o
 WHERE NOT EXISTS (
   SELECT 1 FROM payment_email_settings pes WHERE pes.organization_id = o.id
 );

-- 3. Backfill the 4 new template columns on every row with sensible defaults.
UPDATE payment_email_settings SET
  estimate_send_subject_template = 'Estimate from {company_name} — {job_address}',
  estimate_send_body_template = E'<p>Hi {customer_first_name},</p>\n<p>Attached is the estimate for the work at {job_address}. Please review and let us know if you have any questions.</p>\n<p>Thanks,<br>{company_name}</p>',
  invoice_send_subject_template = 'Invoice from {company_name} — {job_address}',
  invoice_send_body_template = E'<p>Hi {customer_first_name},</p>\n<p>Attached is the invoice for the work at {job_address}. Payment instructions are in the attached PDF.</p>\n<p>Thanks,<br>{company_name}</p>'
WHERE estimate_send_subject_template = '';

-- 4. estimates: last_sent_at + last_sent_to_email
ALTER TABLE estimates
  ADD COLUMN last_sent_at      timestamptz,
  ADD COLUMN last_sent_to_email text;

-- 5. invoices: last_sent_at + last_sent_to_email
ALTER TABLE invoices
  ADD COLUMN last_sent_at      timestamptz,
  ADD COLUMN last_sent_to_email text;

-- 6. Widen contract_events.event_type CHECK.
-- Live CHECK list captured via pg_get_constraintdef on 2026-05-04: 15 values
-- (note 'signed' is included — was missing from the plan's example list).
ALTER TABLE contract_events DROP CONSTRAINT contract_events_event_type_check;
ALTER TABLE contract_events ADD CONSTRAINT contract_events_event_type_check
  CHECK (event_type IN (
    'created','sent','email_delivered','email_opened','link_viewed',
    'signed','reminder_sent','voided','expired','paid','payment_failed',
    'refunded','partially_refunded','dispute_opened','dispute_closed',
    'estimate_sent','invoice_sent'
  ));

-- 7. AFTER INSERT trigger on organizations: seed payment_email_settings
-- for any future org. Mirrors the 67c1 seed_default_pdf_presets pattern.
-- Defensive WHERE NOT EXISTS guard belt-and-suspenders against re-fire.
CREATE OR REPLACE FUNCTION public.seed_default_payment_email_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO payment_email_settings (
    organization_id,
    send_from_email,
    send_from_name,
    provider,
    estimate_send_subject_template,
    estimate_send_body_template,
    invoice_send_subject_template,
    invoice_send_body_template
  )
  SELECT
    NEW.id,
    '',
    'Outgoing',
    'resend',
    'Estimate from {company_name} — {job_address}',
    E'<p>Hi {customer_first_name},</p>\n<p>Attached is the estimate for the work at {job_address}. Please review and let us know if you have any questions.</p>\n<p>Thanks,<br>{company_name}</p>',
    'Invoice from {company_name} — {job_address}',
    E'<p>Hi {customer_first_name},</p>\n<p>Attached is the invoice for the work at {job_address}. Payment instructions are in the attached PDF.</p>\n<p>Thanks,<br>{company_name}</p>'
  WHERE NOT EXISTS (
    SELECT 1 FROM payment_email_settings WHERE organization_id = NEW.id
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_seed_default_payment_email_settings
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION seed_default_payment_email_settings();

COMMIT;

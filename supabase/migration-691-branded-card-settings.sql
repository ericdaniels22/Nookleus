-- Migration 691 (parent epic #689) — Branded card on the initial
-- signing-request email (walking skeleton).
--
-- Adds the contractor-facing style knobs for the app-owned branded card
-- (ADR 0017) and migrates the signing-request body to a message-only default.
--
-- Three card-level style columns — shared across the contract email kinds as
-- each adopts the frame:
--   * button_label  — the action-button text (default "Review & sign")
--   * button_color  — the action-button background; a 6-digit hex the route
--                     validates and the card's auto-contrast reads to keep the
--                     label legible (default #1f2937, a professional dark tone
--                     that is freely changeable, incl. red — ADR 0017 §1)
--   * logo_visible  — whether the company logo leads the card, or a company
--                     wordmark + a more prominent Nookleus mark do instead
--
-- And a recovery column:
--   * signing_request_body_template_archived — a one-time snapshot of the
--     prior body taken before the reset below. A safety net, NOT a supported
--     rollback path (ADR 0017 §7).
--
-- Build-order note: the body no longer carries the {{signing_link}} anchor or
-- a CTA — the app injects the signing link into the card's action button and
-- assembles the frame AROUND the (sanitized) body. So the new default is just
-- a greeting + short description; the link/button live in the frame.

ALTER TABLE public.contract_email_settings
  ADD COLUMN IF NOT EXISTS button_label text NOT NULL DEFAULT 'Review & sign';
ALTER TABLE public.contract_email_settings
  ADD COLUMN IF NOT EXISTS button_color text NOT NULL DEFAULT '#1f2937';
ALTER TABLE public.contract_email_settings
  ADD COLUMN IF NOT EXISTS logo_visible boolean NOT NULL DEFAULT true;
ALTER TABLE public.contract_email_settings
  ADD COLUMN IF NOT EXISTS signing_request_body_template_archived text;

-- Archive the current body once. Idempotent: only fills the archive while it
-- is still NULL, so a re-run never overwrites the saved original with the
-- already-reset body.
UPDATE public.contract_email_settings
   SET signing_request_body_template_archived = signing_request_body_template
 WHERE signing_request_body_template_archived IS NULL;

-- Reset any body still carrying the legacy {{signing_link}} anchor to the
-- message-only default. A body already migrated (no token) is left untouched,
-- so this is safe to re-run and won't clobber a hand-edited message-only body.
UPDATE public.contract_email_settings
   SET signing_request_body_template =
     '<p>Hi {{customer_name}},</p><p>Please review and sign {{document_title}} at your convenience.</p><p>Thanks,<br>{{company_name}}</p>'
 WHERE signing_request_body_template LIKE '%{{signing_link}}%';

-- ROLLBACK ---
-- UPDATE public.contract_email_settings
--    SET signing_request_body_template = signing_request_body_template_archived
--  WHERE signing_request_body_template_archived IS NOT NULL;
-- ALTER TABLE public.contract_email_settings DROP COLUMN IF EXISTS signing_request_body_template_archived;
-- ALTER TABLE public.contract_email_settings DROP COLUMN IF EXISTS logo_visible;
-- ALTER TABLE public.contract_email_settings DROP COLUMN IF EXISTS button_color;
-- ALTER TABLE public.contract_email_settings DROP COLUMN IF EXISTS button_label;

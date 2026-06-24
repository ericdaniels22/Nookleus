-- Migration 692 (parent epic #689) — Branded card on the reminder email.
--
-- #691 brought the app-owned branded card (ADR 0017) to the initial
-- signing-request email and added the shared card-level style knobs
-- (button_label / button_color / logo_visible). #692 threads that same frame
-- into the reminder paths — the hourly cron, the manual Remind button, and
-- resend — so a reminder now arrives as the branded card with the action
-- button + signing link, differing from the initial send only in its own
-- subject/message and the reminder headline/bell glyph.
--
-- This migration adds just the reminder's recovery column and migrates the
-- reminder body to a message-only default (the style knobs already exist from
-- #691 and are reused, not re-added):
--   * reminder_body_template_archived — a one-time snapshot of the prior
--     reminder body taken before the reset below. A safety net, NOT a
--     supported rollback path (ADR 0017 §7).
--
-- Build-order note: like the signing-request body, the reminder body no longer
-- carries the {{signing_link}} anchor or a CTA — the app injects the signing
-- link into the card's action button and assembles the frame AROUND the
-- (sanitized) body. So the new default is just a greeting + short nudge; the
-- link/button live in the frame.

ALTER TABLE public.contract_email_settings
  ADD COLUMN IF NOT EXISTS reminder_body_template_archived text;

-- Archive the current reminder body once. Idempotent: only fills the archive
-- while it is still NULL, so a re-run never overwrites the saved original with
-- the already-reset body.
UPDATE public.contract_email_settings
   SET reminder_body_template_archived = reminder_body_template
 WHERE reminder_body_template_archived IS NULL;

-- Reset any reminder body still carrying the legacy {{signing_link}} anchor to
-- the message-only default. A body already migrated (no token) is left
-- untouched, so this is safe to re-run and won't clobber a hand-edited
-- message-only body.
UPDATE public.contract_email_settings
   SET reminder_body_template =
     '<p>Hi {{customer_name}},</p><p>Just a friendly reminder to review and sign {{document_title}} when you have a moment.</p><p>Thanks,<br>{{company_name}}</p>'
 WHERE reminder_body_template LIKE '%{{signing_link}}%';

-- ROLLBACK ---
-- UPDATE public.contract_email_settings
--    SET reminder_body_template = reminder_body_template_archived
--  WHERE reminder_body_template_archived IS NOT NULL;
-- ALTER TABLE public.contract_email_settings DROP COLUMN IF EXISTS reminder_body_template_archived;

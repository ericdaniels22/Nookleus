-- Migration 693 (parent epic #689) — Branded card on the two finalize-time
-- emails: the post-sign confirmation to the customer and the internal staff
-- notification.
--
-- #691 brought the app-owned branded card (ADR 0017) to the initial
-- signing-request email and added the shared card-level style knobs
-- (button_label / button_color / logo_visible); #692 threaded the same frame
-- into the reminder paths. #693 finishes the set: finalize now assembles both
-- signed-time emails as the branded card. The confirmation renders a done-state
-- "signed ✓" receipt with NO action button (a null action URL), the signed PDF
-- still attached; the internal notification carries an app-fixed "View
-- contract" button to the internal platform view.
--
-- This migration adds just the two recovery columns and migrates both bodies to
-- their message-only defaults (the style knobs already exist from #691 and are
-- reused, not re-added):
--   * signed_confirmation_body_template_archived          — one-time snapshot of
--     the prior customer confirmation body.
--   * signed_confirmation_internal_body_template_archived — one-time snapshot of
--     the prior internal notification body.
-- Both are safety nets, NOT a supported rollback path (ADR 0017 §7).
--
-- Build-order note: unlike the signing-request / reminder bodies, neither
-- confirmation body ever carried the {{signing_link}} anchor, so there is no
-- token to key the reset on. Instead the reset fires only where the body still
-- equals the build33 seeded default — a body a contractor has hand-edited is
-- left untouched, so this is safe to re-run and won't clobber a customized
-- message. The frame now owns the headline, glyph, sender line, footer, and the
-- internal "View contract" button, so the new defaults are the bare personal
-- note; the chrome lives in the frame.

ALTER TABLE public.contract_email_settings
  ADD COLUMN IF NOT EXISTS signed_confirmation_body_template_archived text;
ALTER TABLE public.contract_email_settings
  ADD COLUMN IF NOT EXISTS signed_confirmation_internal_body_template_archived text;

-- Archive the current bodies once. Idempotent: only fills each archive while it
-- is still NULL, so a re-run never overwrites a saved original with the
-- already-reset body.
UPDATE public.contract_email_settings
   SET signed_confirmation_body_template_archived = signed_confirmation_body_template
 WHERE signed_confirmation_body_template_archived IS NULL;

UPDATE public.contract_email_settings
   SET signed_confirmation_internal_body_template_archived = signed_confirmation_internal_body_template
 WHERE signed_confirmation_internal_body_template_archived IS NULL;

-- Reset the customer confirmation body to the message-only default, but only
-- where it still equals the build33 seeded default. A hand-edited body is left
-- untouched, so this is safe to re-run.
UPDATE public.contract_email_settings
   SET signed_confirmation_body_template =
     '<p>Hi {{customer_name}},</p><p>Thanks for signing {{document_title}}. A signed copy is attached for your records.</p><p>Thanks,<br>{{company_name}}</p>'
 WHERE signed_confirmation_body_template =
     '<p>Hi {{customer_name}},</p><p>Thanks for signing <strong>{{document_title}}</strong>. A signed copy is attached for your records.</p><p>{{company_name}}<br>{{company_phone}}</p>';

-- Reset the internal notification body to the message-only default, same
-- seeded-default guard.
UPDATE public.contract_email_settings
   SET signed_confirmation_internal_body_template =
     '<p>{{customer_name}} signed {{document_title}}.</p><p>A signed copy is attached.</p>'
 WHERE signed_confirmation_internal_body_template =
     '<p>{{customer_name}} signed <strong>{{document_title}}</strong>.</p><p>A signed copy is attached.</p>';

-- ROLLBACK ---
-- UPDATE public.contract_email_settings
--    SET signed_confirmation_body_template = signed_confirmation_body_template_archived
--  WHERE signed_confirmation_body_template_archived IS NOT NULL;
-- UPDATE public.contract_email_settings
--    SET signed_confirmation_internal_body_template = signed_confirmation_internal_body_template_archived
--  WHERE signed_confirmation_internal_body_template_archived IS NOT NULL;
-- ALTER TABLE public.contract_email_settings DROP COLUMN IF EXISTS signed_confirmation_internal_body_template_archived;
-- ALTER TABLE public.contract_email_settings DROP COLUMN IF EXISTS signed_confirmation_body_template_archived;

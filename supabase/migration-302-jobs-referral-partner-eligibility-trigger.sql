-- issue #302 (PRD #297, slice D) — server-side eligibility for the
-- Referral Partner FK on `jobs`.
--
-- Slice B (#298) added eligibility enforcement to PATCH /api/jobs/[id]
-- via `eligibilityFor()` in src/lib/referral-partners/eligibility.ts.
-- Slice D wires the same FK into the intake form, which writes the row
-- with a direct supabase-js INSERT — there is no app-server endpoint in
-- that path. This trigger is the defense-in-depth backstop: it enforces
-- the ADR-0002 rule at the database, so any client that tries to attach
-- a non-Active or trashed Referral Partner is rejected regardless of
-- which route the write came through.
--
-- Rule (mirrors `eligibilityFor()`):
--   1. The partner must exist.
--   2. The partner must not be trashed (`deleted_at IS NULL`).
--   3. The partner's Lifecycle status must be 'green' (Active).
--   4. The partner must belong to the same Organization as the Job.
--
-- A NULL FK clears the attribution and is always allowed (mirrors the
-- "clearing the FK" path on PATCH /api/jobs/[id]).
--
-- The exception text starts with `RP-INELIGIBLE:` so the API layer (and
-- any future client error mapping) can recognize it and turn it into an
-- HTTP 422 with a clear reason. supabase-js surfaces the raw message on
-- the PostgrestError; the intake form's submit catch block falls back to
-- a generic toast today, which is acceptable until the message-mapping
-- pass lands alongside the next intake-form refactor.

CREATE OR REPLACE FUNCTION public.enforce_referral_partner_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  partner_row record;
BEGIN
  -- Clearing the FK or no change to the FK: nothing to validate.
  IF NEW.referral_partner_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.referral_partner_id IS NOT DISTINCT FROM OLD.referral_partner_id THEN
    RETURN NEW;
  END IF;

  SELECT id, status, deleted_at, organization_id
    INTO partner_row
    FROM public.referral_partners
   WHERE id = NEW.referral_partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RP-INELIGIBLE: Referral Partner not found (id=%)', NEW.referral_partner_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF partner_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'RP-INELIGIBLE: Referral Partner is trashed (id=%)', NEW.referral_partner_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF partner_row.status <> 'green' THEN
    RAISE EXCEPTION 'RP-INELIGIBLE: Referral Partner Lifecycle status must be green (id=%, status=%)',
      NEW.referral_partner_id, partner_row.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF partner_row.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'RP-INELIGIBLE: Referral Partner belongs to a different Organization (id=%)',
      NEW.referral_partner_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_referral_partner_eligibility ON public.jobs;

CREATE TRIGGER trg_jobs_referral_partner_eligibility
  BEFORE INSERT OR UPDATE OF referral_partner_id, organization_id
  ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_referral_partner_eligibility();

-- ROLLBACK ---
-- DROP TRIGGER IF EXISTS trg_jobs_referral_partner_eligibility ON public.jobs;
-- DROP FUNCTION IF EXISTS public.enforce_referral_partner_eligibility();

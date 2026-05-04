-- ============================================================================
-- Build 67c1 — Task 22
-- New-org default-preset onboarding hook.
--
-- Context: T1's seed (migration-build67c1-pdf-presets-and-bucket.sql) only
-- covered orgs that existed at apply-time (AAA + TestCo). New orgs created
-- after T1 would have zero presets and break Export PDF (the route returns
-- 400 "preset not found (and no default seeded)" when there's no default).
--
-- Pre-flight (2026-05-04 evening) confirmed via SELECT:
--   - There is NO application code path for org creation today. Both prod
--     orgs were seeded inline on 2026-04-22 in the multi-tenant rollout.
--   - The handle_new_user trigger (rebuilt in build64) only creates a
--     user_profiles row, not an organization.
--   - There are no existing triggers on the organizations table.
--
-- Implementation choice: AFTER INSERT trigger on organizations. Fires for
-- ANY future org creation regardless of mechanism (admin SQL, future signup
-- flow, future workspace-create UI). Same shape as handle_new_user — clean
-- Postgres pattern, no application coupling.
--
-- Defensive WHERE NOT EXISTS guards mirror T1's seed pattern; an AFTER
-- INSERT trigger sees a brand-new NEW.id so the guards are belt-and-
-- suspenders, but they make the trigger safe to re-fire if the schema
-- ever evolves to re-seed via this path.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_default_pdf_presets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO pdf_presets (organization_id, name, document_type, document_title, is_default)
  SELECT NEW.id, 'Estimate (default)', 'estimate', 'Estimate', true
  WHERE NOT EXISTS (
    SELECT 1 FROM pdf_presets
     WHERE organization_id = NEW.id
       AND document_type = 'estimate'
       AND is_default = true
  );

  INSERT INTO pdf_presets (organization_id, name, document_type, document_title, is_default)
  SELECT NEW.id, 'Invoice (default)', 'invoice', 'Invoice', true
  WHERE NOT EXISTS (
    SELECT 1 FROM pdf_presets
     WHERE organization_id = NEW.id
       AND document_type = 'invoice'
       AND is_default = true
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_seed_default_pdf_presets
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION seed_default_pdf_presets();

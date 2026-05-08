-- Build 14j (Task 0) — Prep form_config for append-only versioning.
--
-- Purpose:   The pre-existing unique index `form_config_org_key` on
--            `(organization_id)` collapsed each tenant to a single row,
--            which silently broke the existing POST /api/settings/intake-form
--            insert path after the first save (latent bug introduced by
--            build46) and made the original 14f append-only history design
--            unworkable. 14j's version-history feature requires multiple
--            rows per org, one per saved version.
-- Depends on: build46 (which created the singleton index this drops).
-- Revert:    drop index form_config_org_version_key; recreate
--            create unique index form_config_org_key on public.form_config(organization_id);
--            (only safe if zero org has >1 row — and after this migration
--            ships, multiple rows per org are expected.)
--
-- Pre-flight: confirm zero duplicates on (organization_id, version) before
-- applying:
--   select organization_id, version, count(*) from form_config
--   group by 1,2 having count(*) > 1;
-- Verified empty 2026-04-30 prior to apply.

drop index if exists form_config_org_key;
create unique index form_config_org_version_key on public.form_config (organization_id, version);

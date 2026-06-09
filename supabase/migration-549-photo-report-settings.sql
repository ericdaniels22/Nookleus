-- migration-549 (issue #549, ADR 0014): per-report Report Settings + Cover Page.
--
-- A Photo Report becomes a per-document SNAPSHOT of how it looks, the same model
-- as billing PDFs (ADR 0012): it carries its own copy of the Report Settings
-- (photos-per-page + the six detail toggles) and the Cover Page config (which
-- identifying blocks show + a chosen cover photo). A new report seeds these from
-- the Organization's Report layout default at creation; thereafter editing the
-- Organization default never rewrites a report that already exists.
--
-- All three columns are READ-TOLERANT for pre-0014 rows (the resolver in
-- src/lib/photo-report-settings.ts decides the fallbacks):
--   - report_settings NULL  -> the report reads as the Organization default
--   - cover_config    NULL  -> every cover block reads as shown ("all on")
--   - cover_photo_id  NULL  -> the cover photo falls back to the Job's cover photo
-- so no backfill is needed and the columns are added nullable with no default.
--
-- report_settings JSONB shape (every field optional, read-tolerant):
--   { photosPerPage: 2|3|4,
--     sectionTitlePages, photoNumbers, capturedBy, location, dateCaptured,
--     photoTags: boolean }
-- cover_config JSONB shape (every field optional, defaults to shown when absent):
--   { logo, customer, propertyAddress, pointOfContact, insurance: boolean }
--
-- cover_photo_id references photos(id) ON DELETE SET NULL, mirroring the Job's
-- cover photo (migration-build77): deleting the referenced photo silently
-- reverts the report to no per-report cover (falling back to the Job's) rather
-- than blocking the delete or leaving a dangling id.
--
-- The Organization's Report layout default lives in the existing key/value
-- company_settings table (keys in REPORT_DEFAULT_SETTING_KEYS), so it needs no
-- schema change — its rows are written on demand by the settings UI.

ALTER TABLE public.photo_reports
  ADD COLUMN IF NOT EXISTS report_settings jsonb,
  ADD COLUMN IF NOT EXISTS cover_config jsonb,
  ADD COLUMN IF NOT EXISTS cover_photo_id uuid
    REFERENCES public.photos(id) ON DELETE SET NULL;

-- ROLLBACK ---
-- ALTER TABLE public.photo_reports
--   DROP COLUMN IF EXISTS report_settings,
--   DROP COLUMN IF EXISTS cover_config,
--   DROP COLUMN IF EXISTS cover_photo_id;

-- Issue #447 #3 — drop the dead photo_report_templates columns.
--
-- The Photo Report Rework (#398–#406) replaced the old template model: a template
-- is now just a name + Sections (heading + boilerplate write-up). The pre-rework
-- knobs — audience, cover_page, photos_per_page — were deliberately left in place
-- by migration-354 because live code still read them. That code is gone now
-- (#405/#406 removed the consuming Settings UI and PDF wiring; the create flow
-- seeds Sections via buildInitialSections, and the generator drives
-- photos-per-page from Company Settings' report_photos_per_page, never the
-- template). With no remaining readers, the columns are dead weight — dropped here.
--
-- Idempotent: DROP COLUMN IF EXISTS; re-running is a no-op.

ALTER TABLE photo_report_templates
  DROP COLUMN IF EXISTS audience,
  DROP COLUMN IF EXISTS cover_page,
  DROP COLUMN IF EXISTS photos_per_page;

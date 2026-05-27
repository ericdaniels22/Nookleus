-- migration-332-drop-photo-report-defaults-keys.sql
--
-- PRD #326 — Photo Report Rework, Slice 6 (#332).
--
-- The photo-report-defaults settings tab is collapsed to a single knob
-- (photos-per-page). The other three values are dropped from the schema.
--
-- The PRD's slice description says "drop columns from photo_report_defaults",
-- but there is no such table in this codebase — the four settings are stored
-- as key/value rows in `company_settings` (id, organization_id, key, value).
-- The schema-correct equivalent of "drop the columns" is therefore to DELETE
-- the rows holding the retired keys.
--
-- The retired keys:
--   - default_report_template   (template picker the rework abandons)
--   - report_preparer_name      (preparer auto-fill on new reports)
--   - report_footer_text        (custom footer textarea)
--
-- `photo_report_templates` (a separate table) is intentionally NOT touched —
-- ADR 0003 keeps it as dead data in the schema for now.
--
-- Idempotent: a DELETE of rows that don't exist is a no-op. As of writing
-- no Organization had saved values under these keys, so the migration is
-- defensive cleanup that keeps the slice's intent provable in SQL.

delete from public.company_settings
 where key in (
   'default_report_template',
   'report_preparer_name',
   'report_footer_text'
 );

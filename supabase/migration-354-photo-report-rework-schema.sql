-- Issue #398 — Photo Report Rework, slice 1: schema foundation.
-- See docs/adr/0009-photo-reports-are-an-in-job-narrative-document.md.
--
-- Adds the two new photo_reports columns the rework needs, and nothing else.
-- Both are nullable, so every existing report is untouched and keeps opening
-- and generating exactly as before:
--
--   * report_number — the per-Job report number ("Report #1, #2, ..."). Left
--     NULL here; the numbering logic that assigns it lands in slice 2a (#400).
--   * deleted_at    — soft-delete timestamp for the recoverable trash. NULL
--     means "not deleted" (the only state until the trash UI lands in #402).
--
-- Deliberately NOT in this migration: dropping the "dead" columns
-- (photo_report_templates.cover_page / photos_per_page / audience and
-- photos.thumbnail_path). Each is still read by live code today, so those drops
-- move to the slices that delete the consuming code (#405/#406 for the template
-- columns) or to a standalone thumbnail_path cleanup — ADR 0008 already defers
-- the latter: "Dropping the column is a separate cleanup".
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; re-running is a no-op.

ALTER TABLE photo_reports
  ADD COLUMN IF NOT EXISTS report_number integer,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

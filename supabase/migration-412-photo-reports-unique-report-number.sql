-- Issue #447 #1 — enforce unique per-Job Photo Report numbers among active reports.
--
-- `report_number` is a human-facing per-Job label ("Report #1, #2, ..."), assigned
-- in #400 by reading the Job's current max and inserting max+1. With no DB-side
-- serialization, two near-simultaneous "Create report" clicks on the same Job could
-- read the same max and mint the same number. This partial unique index turns that
-- race into a unique_violation (23505) on insert, which createPhotoReportDraft
-- catches and retries with the next free number.
--
-- Partial (WHERE deleted_at IS NULL) so the constraint covers only active reports:
-- a trashed report keeps its number out of the index, matching the max-over-all
-- numbering that never reuses a number (#400) and avoiding a conflict with any
-- cosmetic duplicate this very bug already produced where one copy was later
-- trashed. `report_number IS NOT NULL` skips legacy pre-#400 rows.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS; re-running is a no-op.
--
-- NOTE: if a Job already holds duplicate *active* report_numbers (from the pre-fix
-- race), this index will fail to build until the duplicates are resolved — trash
-- or renumber one copy. They are cosmetic and rare; resolve by hand if the build
-- errors.

CREATE UNIQUE INDEX IF NOT EXISTS photo_reports_job_report_number_key
  ON photo_reports(job_id, report_number)
  WHERE deleted_at IS NULL AND report_number IS NOT NULL;

-- migration-411-drop-photos-thumbnail-path.sql
--
-- Issue #411 / ADR 0008 — Drop the dead photos.thumbnail_path column.
--
-- The column has existed since the photo system shipped but was never written:
-- there is no thumbnail pipeline, so every row's photos.thumbnail_path is NULL.
-- ADR 0008 (resize grid photos at the storage layer) records that grid previews
-- come from Supabase's render/image endpoint, not a stored thumbnail, and
-- explicitly defers dropping this column to "a separate cleanup" — this is it.
-- #398 (PR #409) left it in place because live code still read it; that code has
-- now stopped reading it (the cover-photo resolver, job purge, and the photo
-- bulk-delete route all dropped the column in this same change).
--
-- Scope: photos.thumbnail_path ONLY. expenses.thumbnail_path is a real, in-use
-- column on a different table (receipt thumbnails) and is NOT touched here.
--
-- Idempotent: IF EXISTS makes a re-run a no-op.

ALTER TABLE public.photos DROP COLUMN IF EXISTS thumbnail_path;

-- migration-850-drop-photos-taken-by-default.sql
--
-- Issue #850 — Drop the vestigial `photos.taken_by` default (extends #808/#832).
--
-- `photos.taken_by` still carried `text NOT NULL DEFAULT 'Eric'`, so any INSERT
-- that omitted the column silently credited Eric. Both upload paths already
-- stamp the resolved author explicitly, so the default was merely vestigial:
--
--   * web upload (photo-upload.tsx) sets `taken_by: author`, where `author`
--     comes from resolvePhotoAuthor (user_profiles.full_name -> account email
--     -> 'unknown') — the same resolver the annotator uses for
--     photo_annotations.created_by (#808), so the two always agree.
--   * mobile upload (lib/mobile/upload-queue.ts) sets `taken_by: this.deps.takenBy`,
--     a required non-null field supplied by the capture surface.
--
-- NOT NULL is intentionally KEPT — every Photo must carry an author. With no
-- default, an INSERT that forgets taken_by fails the NOT NULL constraint loudly
-- instead of silently re-attributing the Photo to 'Eric'.
--
-- No backfill: existing rows keep whatever taken_by they already hold (per the
-- issue, historical attribution is left as-is).
--
-- Idempotent: `DROP DEFAULT` on a column that has no default is a no-op in
-- Postgres, so this is safe to re-run. Run in the Supabase SQL Editor.

alter table public.photos
  alter column taken_by drop default;

-- ROLLBACK ---
-- alter table public.photos alter column taken_by set default 'Eric';

-- migration-808-drop-annotation-created-by-default.sql
--
-- Issue #808 — Attribute Annotations to the signed-in user.
--
-- `photo_annotations.created_by` defaulted to the literal 'Eric', so every
-- first-time annotation save was attributed to Eric regardless of who was
-- signed in. The annotator now stamps the column explicitly with the resolved
-- author (resolvePhotoAuthor: user_profiles.full_name -> account email ->
-- 'unknown'), matching exactly how the photo upload surface sets
-- photos.taken_by.
--
-- Dropping the default makes the new behavior provable and safe: with no
-- default, an INSERT that forgets created_by fails the surviving NOT NULL
-- constraint loudly, instead of silently re-attributing the row to 'Eric'.
--
-- NOT NULL is intentionally KEPT — every annotation must carry an author.
--
-- No backfill: existing rows keep whatever created_by they already hold (per
-- the issue, historical attribution is left as-is). Re-saving an existing
-- annotation never rewrites created_by — the app issues an UPDATE of
-- annotation_data only.
--
-- Idempotent: `DROP DEFAULT` on a column that has no default is a no-op in
-- Postgres, so this is safe to re-run. Run in the Supabase SQL Editor.

alter table public.photo_annotations
  alter column created_by drop default;

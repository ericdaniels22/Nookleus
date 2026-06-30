-- migration-832-drop-template-created-by-defaults.sql
--
-- Issue #832 — Attribute Report Templates to the signed-in user (extends #808).
--
-- Three photo-domain tables still carried `created_by text NOT NULL DEFAULT
-- 'Eric'`, so any INSERT that omitted the column silently credited Eric:
--
--   * photo_report_templates — the template builder never set created_by, so
--     EVERY template created by anyone was attributed to Eric. The builder now
--     stamps the resolved signed-in user (resolvePhotoAuthor:
--     user_profiles.full_name -> account email -> 'unknown') on create, the
--     same way the photo upload and annotator surfaces do.
--   * photo_reports — already stamped explicitly (created_by: preparerName,
--     resolved the same way in the create route), so its default was merely
--     vestigial; dropped for consistency.
--   * photo_tags — has no application write path at all today; dropping the
--     default forces any future tag seeder to attribute explicitly rather than
--     silently crediting 'Eric'.
--
-- NOT NULL is intentionally KEPT on all three — every row must carry an author.
-- With no default, an INSERT that forgets created_by fails the NOT NULL
-- constraint loudly instead of silently re-attributing the row to 'Eric'.
--
-- Editing a template never rewrites created_by — the app issues an UPDATE of
-- { name, sections } only.
--
-- No backfill: existing rows keep whatever created_by they already hold (per
-- the issue, historical attribution is left as-is).
--
-- Idempotent: `DROP DEFAULT` on a column that has no default is a no-op in
-- Postgres, so this is safe to re-run. Run in the Supabase SQL Editor.

alter table public.photo_report_templates
  alter column created_by drop default;

alter table public.photo_reports
  alter column created_by drop default;

alter table public.photo_tags
  alter column created_by drop default;

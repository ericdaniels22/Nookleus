-- issue #692 (parent epic #689) — Reminder branded-card settings smoke test.
--
-- Purpose:   Self-checking script for migration-692. NOT part of the migration.
--            Wrapped in begin; ... rollback; so the database is unchanged on a
--            clean run. Every assertion raises on failure; a clean run prints
--            only NOTICE lines.
--
-- Preconditions: migration-691 AND migration-692 have been applied.
--
-- Run:       psql -f supabase/migration-692-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. contract_email_settings gains reminder_body_template_archived.
--   2. The migrated singleton: the reminder body no longer carries
--      {{signing_link}} and the prior reminder body is preserved in the
--      archive column.
--   3. The documented ROLLBACK restores the reminder body from the archive.

begin;

-- ---------------------------------------------------------------------------
-- 1. The new archive column exists.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contract_email_settings'
       and column_name = 'reminder_body_template_archived'
  ) then
    raise exception 'm692 smoke: missing column reminder_body_template_archived';
  end if;
  raise notice 'm692 smoke: reminder_body_template_archived present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The migrated singleton: reminder body is message-only; prior body archived.
-- ---------------------------------------------------------------------------
do $$
declare
  v_body    text;
  v_archive text;
  v_n       int;
begin
  select count(*) into v_n from public.contract_email_settings;
  if v_n = 0 then
    raise notice 'm692 smoke: no settings row to check (skipping body/archive assertions)';
    return;
  end if;
  select reminder_body_template, reminder_body_template_archived
    into v_body, v_archive
    from public.contract_email_settings order by updated_at limit 1;
  if v_body like '%{{signing_link}}%' then
    raise exception 'm692 smoke: reminder body still carries {{signing_link}}';
  end if;
  if v_archive is null then
    raise exception 'm692 smoke: prior reminder body was not archived';
  end if;
  raise notice 'm692 smoke: reminder body migrated message-only, prior body preserved in archive';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The documented ROLLBACK restores the reminder body from the archive.
-- ---------------------------------------------------------------------------
do $$
declare
  v_body    text;
  v_archive text;
begin
  select reminder_body_template_archived
    into v_archive
    from public.contract_email_settings order by updated_at limit 1;
  if v_archive is null then
    raise notice 'm692 smoke: no archive to test rollback (skipping)';
    return;
  end if;
  update public.contract_email_settings
     set reminder_body_template = reminder_body_template_archived
   where reminder_body_template_archived is not null;
  select reminder_body_template
    into v_body
    from public.contract_email_settings order by updated_at limit 1;
  if v_body <> v_archive then
    raise exception 'm692 smoke: ROLLBACK did not restore the archived reminder body';
  end if;
  raise notice 'm692 smoke: ROLLBACK restores reminder body from archive';
end $$;

rollback;

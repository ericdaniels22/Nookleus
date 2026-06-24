-- issue #691 (parent epic #689) — Branded-card settings smoke test.
--
-- Purpose:   Self-checking script for migration-691. NOT part of the migration.
--            Wrapped in begin; ... rollback; so the database is unchanged on a
--            clean run. Every assertion raises on failure; a clean run prints
--            only NOTICE lines.
--
-- Preconditions: migration-691 has been applied.
--
-- Run:       psql -f supabase/migration-691-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. contract_email_settings gains button_label / button_color /
--      logo_visible / signing_request_body_template_archived.
--   2. A fresh row picks up the column defaults: "Review & sign", #1f2937, true.
--   3. The migrated singleton: the body no longer carries {{signing_link}} and
--      the prior body is preserved in the archive column.
--   4. The documented ROLLBACK restores the body from the archive.

begin;

-- ---------------------------------------------------------------------------
-- 1. The four new columns exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(col, ', ')
    into v_missing
  from unnest(array[
    'button_label', 'button_color', 'logo_visible',
    'signing_request_body_template_archived'
  ]) as col
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contract_email_settings'
       and column_name = col
  );
  if v_missing is not null then
    raise exception 'm691 smoke: missing column(s): %', v_missing;
  end if;
  raise notice 'm691 smoke: all four branded-card columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Column defaults apply to a fresh row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id    uuid;
  v_label text;
  v_color text;
  v_logo  boolean;
begin
  insert into public.contract_email_settings default values returning id into v_id;
  select button_label, button_color, logo_visible
    into v_label, v_color, v_logo
    from public.contract_email_settings where id = v_id;
  if v_label <> 'Review & sign' then
    raise exception 'm691 smoke: button_label default % (expected "Review & sign")', v_label;
  end if;
  if v_color <> '#1f2937' then
    raise exception 'm691 smoke: button_color default % (expected #1f2937)', v_color;
  end if;
  if v_logo is not true then
    raise exception 'm691 smoke: logo_visible default % (expected true)', v_logo;
  end if;
  delete from public.contract_email_settings where id = v_id;
  raise notice 'm691 smoke: column defaults — label/color/logo_visible correct';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The migrated singleton: body is message-only; prior body archived.
-- ---------------------------------------------------------------------------
do $$
declare
  v_body    text;
  v_archive text;
  v_n       int;
begin
  select count(*) into v_n from public.contract_email_settings;
  if v_n = 0 then
    raise notice 'm691 smoke: no settings row to check (skipping body/archive assertions)';
    return;
  end if;
  select signing_request_body_template, signing_request_body_template_archived
    into v_body, v_archive
    from public.contract_email_settings order by updated_at limit 1;
  if v_body like '%{{signing_link}}%' then
    raise exception 'm691 smoke: signing-request body still carries {{signing_link}}';
  end if;
  if v_archive is null then
    raise exception 'm691 smoke: prior signing-request body was not archived';
  end if;
  raise notice 'm691 smoke: body migrated message-only, prior body preserved in archive';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The documented ROLLBACK restores the body from the archive.
-- ---------------------------------------------------------------------------
do $$
declare
  v_body    text;
  v_archive text;
begin
  select signing_request_body_template_archived
    into v_archive
    from public.contract_email_settings order by updated_at limit 1;
  if v_archive is null then
    raise notice 'm691 smoke: no archive to test rollback (skipping)';
    return;
  end if;
  update public.contract_email_settings
     set signing_request_body_template = signing_request_body_template_archived
   where signing_request_body_template_archived is not null;
  select signing_request_body_template
    into v_body
    from public.contract_email_settings order by updated_at limit 1;
  if v_body <> v_archive then
    raise exception 'm691 smoke: ROLLBACK did not restore the archived body';
  end if;
  raise notice 'm691 smoke: ROLLBACK restores body from archive';
end $$;

rollback;

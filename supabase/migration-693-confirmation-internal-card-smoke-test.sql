-- issue #693 (parent epic #689) — Confirmation + internal branded-card smoke test.
--
-- Purpose:   Self-checking script for migration-693-confirmation-internal-card.
--            NOT part of the migration. Wrapped in begin; ... rollback; so the
--            database is unchanged on a clean run. Every assertion raises on
--            failure; a clean run prints only NOTICE lines.
--
-- Preconditions: migration-691 AND migration-693-confirmation-internal-card
--                have been applied.
--
-- Run:       psql -f supabase/migration-693-confirmation-internal-card-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. contract_email_settings gains both archive columns.
--   2. The migrated singleton: neither confirmation body is still the build33
--      seeded default, and each prior body is preserved in its archive column.
--   3. The documented ROLLBACK restores both bodies from their archives.

begin;

-- ---------------------------------------------------------------------------
-- 1. Both new archive columns exist.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contract_email_settings'
       and column_name = 'signed_confirmation_body_template_archived'
  ) then
    raise exception 'm693 smoke: missing column signed_confirmation_body_template_archived';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contract_email_settings'
       and column_name = 'signed_confirmation_internal_body_template_archived'
  ) then
    raise exception 'm693 smoke: missing column signed_confirmation_internal_body_template_archived';
  end if;
  raise notice 'm693 smoke: both archive columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The migrated singleton: bodies moved off the seeded default; priors archived.
-- ---------------------------------------------------------------------------
do $$
declare
  v_body     text;
  v_internal text;
  v_arch_c   text;
  v_arch_i   text;
  v_n        int;
begin
  select count(*) into v_n from public.contract_email_settings;
  if v_n = 0 then
    raise notice 'm693 smoke: no settings row to check (skipping body/archive assertions)';
    return;
  end if;
  select signed_confirmation_body_template,
         signed_confirmation_internal_body_template,
         signed_confirmation_body_template_archived,
         signed_confirmation_internal_body_template_archived
    into v_body, v_internal, v_arch_c, v_arch_i
    from public.contract_email_settings order by updated_at limit 1;

  if v_body =
     '<p>Hi {{customer_name}},</p><p>Thanks for signing <strong>{{document_title}}</strong>. A signed copy is attached for your records.</p><p>{{company_name}}<br>{{company_phone}}</p>' then
    raise exception 'm693 smoke: customer confirmation body still the pre-#693 seeded default';
  end if;
  if v_internal =
     '<p>{{customer_name}} signed <strong>{{document_title}}</strong>.</p><p>A signed copy is attached.</p>' then
    raise exception 'm693 smoke: internal notification body still the pre-#693 seeded default';
  end if;
  if v_arch_c is null then
    raise exception 'm693 smoke: prior customer confirmation body was not archived';
  end if;
  if v_arch_i is null then
    raise exception 'm693 smoke: prior internal notification body was not archived';
  end if;
  raise notice 'm693 smoke: both bodies migrated off seeded default, priors preserved in archive';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The documented ROLLBACK restores both bodies from their archives.
-- ---------------------------------------------------------------------------
do $$
declare
  v_body     text;
  v_internal text;
  v_arch_c   text;
  v_arch_i   text;
begin
  select signed_confirmation_body_template_archived,
         signed_confirmation_internal_body_template_archived
    into v_arch_c, v_arch_i
    from public.contract_email_settings order by updated_at limit 1;
  if v_arch_c is null and v_arch_i is null then
    raise notice 'm693 smoke: no archive to test rollback (skipping)';
    return;
  end if;
  update public.contract_email_settings
     set signed_confirmation_body_template = signed_confirmation_body_template_archived
   where signed_confirmation_body_template_archived is not null;
  update public.contract_email_settings
     set signed_confirmation_internal_body_template = signed_confirmation_internal_body_template_archived
   where signed_confirmation_internal_body_template_archived is not null;
  select signed_confirmation_body_template,
         signed_confirmation_internal_body_template
    into v_body, v_internal
    from public.contract_email_settings order by updated_at limit 1;
  if v_body <> v_arch_c then
    raise exception 'm693 smoke: ROLLBACK did not restore the archived customer confirmation body';
  end if;
  if v_internal <> v_arch_i then
    raise exception 'm693 smoke: ROLLBACK did not restore the archived internal notification body';
  end if;
  raise notice 'm693 smoke: ROLLBACK restores both bodies from archive';
end $$;

rollback;

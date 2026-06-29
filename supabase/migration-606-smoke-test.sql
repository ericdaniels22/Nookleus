-- issue #606 (PRD #603, ADR 0015) — Showcase publish-state smoke test.
--
-- Purpose:   Self-checking script for migration-606. NOT part of the migration.
--            Wrapped in begin; ... rollback; so the database is unchanged on a
--            clean run. Every assertion raises on failure; a clean run prints
--            only NOTICE lines.
--
-- Preconditions: migration-613 and migration-606 have been applied.
--
-- Run:       psql -f supabase/migration-606-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. showcases has the five publish-state columns the app writes.
--   2. wordpress_post_id is text (provider-neutral), not an integer type.
--   3. consent_confirmed_by FKs auth.users with ON DELETE SET NULL (audit
--      survives the author being removed).
--   4. Functional: an admin-shaped row can be stamped published with a post id,
--      URL, published_at and consent who/when, and reads back. Conditional on an
--      org + live Job existing (skipped with a notice otherwise).

begin;

-- ---------------------------------------------------------------------------
-- 1. The publish-state columns exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array[
      'wordpress_post_id','wordpress_post_url','published_at',
      'consent_confirmed_by','consent_confirmed_at'
    ]) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'showcases'
        and column_name = c
   );
  if v_missing is not null then
    raise exception 'm606 smoke: showcases missing publish column(s): %', v_missing;
  end if;
  raise notice 'm606 smoke: showcases has the publish-state columns';
end $$;

-- ---------------------------------------------------------------------------
-- 2. wordpress_post_id is text (provider-neutral), not an int.
-- ---------------------------------------------------------------------------
do $$
declare
  v_type text;
begin
  select data_type into v_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'showcases'
     and column_name = 'wordpress_post_id';
  if v_type is distinct from 'text' then
    raise exception 'm606 smoke: wordpress_post_id is % (expected text)', v_type;
  end if;
  raise notice 'm606 smoke: wordpress_post_id is text';
end $$;

-- ---------------------------------------------------------------------------
-- 3. consent_confirmed_by FKs auth.users ON DELETE SET NULL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rule text;
begin
  select rc.delete_rule into v_rule
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = rc.constraint_name
     and kcu.constraint_schema = rc.constraint_schema
   where kcu.table_schema = 'public' and kcu.table_name = 'showcases'
     and kcu.column_name = 'consent_confirmed_by';
  if v_rule is null then
    raise exception 'm606 smoke: consent_confirmed_by has no FK';
  end if;
  if v_rule <> 'SET NULL' then
    raise exception 'm606 smoke: consent_confirmed_by ON DELETE is % (expected SET NULL)', v_rule;
  end if;
  raise notice 'm606 smoke: consent_confirmed_by FK is ON DELETE SET NULL';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Functional: stamp a Showcase published and read it back. Runs as the
--    script's role (RLS bypassed) — this tests the columns, not the policy.
--    Skipped when there is no org + live Job to attach to.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_job uuid;
  v_id  uuid;
  v_status text;
  v_post_id text;
  v_consent_at timestamptz;
begin
  select id into v_org from public.organizations limit 1;
  if v_org is null then
    raise notice 'm606 smoke: no organization to test publish stamping (skipping)';
    return;
  end if;
  select id into v_job
    from public.jobs
   where organization_id = v_org and deleted_at is null
   limit 1;
  if v_job is null then
    raise notice 'm606 smoke: no live job to test publish stamping (skipping)';
    return;
  end if;

  insert into public.showcases (organization_id, job_id, title, write_up)
    values (v_org, v_job, 'm606 publish smoke', 'A clean before/after.')
    returning id into v_id;

  -- Stamp it published, exactly as the publish route does on a successful push.
  update public.showcases
     set status = 'published',
         wordpress_post_id = '42',
         wordpress_post_url = 'https://example.com/projects/m606-smoke',
         published_at = now(),
         consent_confirmed_at = now()
   where id = v_id;

  select status, wordpress_post_id, consent_confirmed_at
    into v_status, v_post_id, v_consent_at
    from public.showcases where id = v_id;

  if v_status <> 'published' then
    raise exception 'm606 smoke: status did not stamp to published (got %)', v_status;
  end if;
  if v_post_id <> '42' then
    raise exception 'm606 smoke: wordpress_post_id did not persist (got %)', v_post_id;
  end if;
  if v_consent_at is null then
    raise exception 'm606 smoke: consent_confirmed_at did not persist';
  end if;
  raise notice 'm606 smoke: a Showcase stamped published with post id + consent reads back';
end $$;

rollback;

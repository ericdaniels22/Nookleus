-- issue #613 (PRD #603, ADR 0015) — showcases smoke test.
--
-- Purpose:   Self-checking script for migration-613. NOT part of the migration.
--            Wrapped in begin; ... rollback; so the database is unchanged on a
--            clean run. Every assertion raises on failure; a clean run prints
--            only NOTICE lines.
--
-- Preconditions: migration-613 has been applied.
--
-- Run:       psql -f supabase/migration-613-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. nookleus.is_admin_of(uuid) exists.
--   2. The showcases table exists with the columns the app reads.
--   3. RLS is enabled and the admin-only policy is present.
--   4. The one-live-per-Job index exists and is PARTIAL (deleted_at IS NULL).
--   5. Functional: a Job may hold at most one LIVE Showcase, but trashing it
--      frees the slot (the "delete & start over" recovery). Conditional on the
--      DB having at least one org + live Job (skipped with a notice otherwise).
--
-- Note on RLS: the admin-only read/write predicate is best exercised by a live,
-- rolled-back adversarial probe with JWT claims set (see the team's RLS-probe
-- recipe); this script pins the structural guarantees that make that gate exist.

begin;

-- ---------------------------------------------------------------------------
-- 1. The admin-of-org helper exists.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'nookleus' and p.proname = 'is_admin_of'
  ) then
    raise exception 'm613 smoke: missing function nookleus.is_admin_of';
  end if;
  raise notice 'm613 smoke: nookleus.is_admin_of present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The table and the columns the app reads.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array[
      'id','organization_id','job_id','title','write_up','photo_ids',
      'status','created_by','created_at','updated_at','deleted_at'
    ]) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'showcases'
        and column_name = c
   );
  if v_missing is not null then
    raise exception 'm613 smoke: showcases missing column(s): %', v_missing;
  end if;
  raise notice 'm613 smoke: showcases table has the expected columns';
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS enabled and the admin-only policy present.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'showcases' and rowsecurity
  ) then
    raise exception 'm613 smoke: RLS not enabled on showcases';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'showcases'
       and policyname = 'showcases_admin_only'
  ) then
    raise exception 'm613 smoke: missing policy showcases_admin_only';
  end if;
  raise notice 'm613 smoke: RLS enabled, admin-only policy present';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The one-live-per-Job index exists and is PARTIAL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_pred text;
begin
  select pg_get_expr(i.indpred, i.indrelid) into v_pred
    from pg_class c
    join pg_index i on i.indexrelid = c.oid
   where c.relname = 'showcases_one_live_per_job';
  if v_pred is null then
    raise exception 'm613 smoke: showcases_one_live_per_job missing or not partial';
  end if;
  if v_pred !~* 'deleted_at' then
    raise exception 'm613 smoke: one-live-per-Job index predicate is not on deleted_at: %', v_pred;
  end if;
  raise notice 'm613 smoke: one-live-per-Job partial unique index present (WHERE %)', v_pred;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Functional: at most one LIVE Showcase per Job; trashing frees the slot.
--    Runs as the script's role (RLS bypassed), so this tests the index, not the
--    policy. Skipped when there is no org + live Job to attach to.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_job uuid;
begin
  select id into v_org from public.organizations limit 1;
  if v_org is null then
    raise notice 'm613 smoke: no organization to test the unique index (skipping)';
    return;
  end if;
  select id into v_job
    from public.jobs
   where organization_id = v_org and deleted_at is null
   limit 1;
  if v_job is null then
    raise notice 'm613 smoke: no live job to test the unique index (skipping)';
    return;
  end if;

  -- First live Showcase: succeeds.
  insert into public.showcases (organization_id, job_id, title)
    values (v_org, v_job, 'smoke #1');

  -- Second LIVE Showcase for the same Job: must be blocked.
  begin
    insert into public.showcases (organization_id, job_id, title)
      values (v_org, v_job, 'smoke #2');
    raise exception 'm613 smoke: a second LIVE showcase for one Job was allowed';
  exception when unique_violation then
    raise notice 'm613 smoke: second live showcase blocked (one-per-Job holds)';
  end;

  -- Trash the first, then a new live Showcase is allowed again.
  update public.showcases
     set deleted_at = now()
   where organization_id = v_org and job_id = v_job and deleted_at is null;
  insert into public.showcases (organization_id, job_id, title)
    values (v_org, v_job, 'smoke #3 after trash');
  raise notice 'm613 smoke: trashing the live showcase freed the per-Job slot';
end $$;

rollback;

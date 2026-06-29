-- issue #607 (parent PRD #603) — Insights metrics store smoke test.
--
-- Purpose:   Self-checking script that verifies migration-607's schema
--            invariants and RLS. NOT part of the migration. Wrapped in
--            begin; ... rollback; so the database is unchanged on a clean run.
--            Every assertion raises on failure; a clean run prints only NOTICE
--            lines.
--
-- Preconditions: migration-607 has been applied. The admin-allow section needs
--            a real auth.users row and skips itself if the database has none;
--            every other section runs unconditionally.
--
-- Run:       psql -f supabase/migration-607-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. Table exists with every expected column.
--   2. value rejects a negative measurement and accepts 0 / positive.
--   3. Idempotent upsert on (organization_id, source, metric_date, metric):
--      re-upserting the same measurement overwrites it in place (one row, value
--      advanced 12 → 15), and a plain second INSERT for that key is rejected.
--   4. LONG / NARROW shape: the same (org, day) with a different metric, or a
--      different source, is a SEPARATE row — never a collision.
--   5. RLS is enabled and carries an admin-only org-isolation policy.
--   6. RLS behaviour: a cross-Organization INSERT is denied.
--   7. RLS behaviour: a non-admin member is denied read+write; an admin member
--      sees and can write the row (skipped if no auth.users row exists).

begin;

-- ---------------------------------------------------------------------------
-- 1. Table and key columns exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg('insight_metric.' || col, ', ')
    into v_missing
  from unnest(array[
    'id', 'organization_id', 'source', 'metric_date', 'metric', 'value',
    'created_at', 'updated_at'
  ]) as col
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'insight_metric'
       and column_name = col
  );

  if v_missing is not null then
    raise exception 'migration-607 smoke: missing column(s): %', v_missing;
  end if;
  raise notice 'migration-607 smoke: table + columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. value non-negative check.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm607 smoke', 'm607-smoke-' || replace(v_org_id::text, '-', ''));

  -- A negative measurement is rejected.
  begin
    insert into public.insight_metric (organization_id, source, metric_date, metric, value)
      values (v_org_id, 'business_profile', date '2026-06-25', 'calls', -1);
    raise exception 'm607 smoke: value accepted a negative measurement';
  exception when check_violation then null;
  end;

  -- 0 (a real zero-count day) and a positive count are both valid.
  insert into public.insight_metric (organization_id, source, metric_date, metric, value)
    values (v_org_id, 'business_profile', date '2026-06-25', 'calls', 0);
  insert into public.insight_metric (organization_id, source, metric_date, metric, value)
    values (v_org_id, 'search_console', date '2026-06-25', 'impressions', 1200);
  raise notice 'm607 smoke: value — rejects negative, accepts 0 and positive';

  delete from public.insight_metric where organization_id = v_org_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Idempotent upsert on (organization_id, source, metric_date, metric).
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid := gen_random_uuid();
  v_count  bigint;
  v_value  numeric;
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm607 upsert', 'm607-upsert-' || replace(v_org_id::text, '-', ''));

  -- First pull: Google reports 12 calls for the day.
  insert into public.insight_metric (organization_id, source, metric_date, metric, value)
    values (v_org_id, 'business_profile', date '2026-06-25', 'calls', 12);

  -- Second pull re-covers the same day; Google has since revised it to 15.
  -- Re-upsert on the conflict target.
  insert into public.insight_metric (organization_id, source, metric_date, metric, value)
    values (v_org_id, 'business_profile', date '2026-06-25', 'calls', 15)
  on conflict (organization_id, source, metric_date, metric) do update set
    value = excluded.value;

  select count(*), max(value) into v_count, v_value
    from public.insight_metric where organization_id = v_org_id;

  if v_count <> 1 then
    raise exception 'm607 smoke: re-upsert duplicated the measurement (% rows, expected 1)', v_count;
  end if;
  if v_value <> 15 then
    raise exception 'm607 smoke: re-upsert did not overwrite value in place (got %, expected 15)', v_value;
  end if;

  -- A plain second INSERT (no on conflict) for the same key must be rejected.
  begin
    insert into public.insight_metric (organization_id, source, metric_date, metric, value)
      values (v_org_id, 'business_profile', date '2026-06-25', 'calls', 99);
    raise exception 'm607 smoke: uniq_insight_metric allowed a duplicate (org, source, day, metric)';
  exception when unique_violation then null;
  end;
  raise notice 'm607 smoke: idempotent upsert — one row, value overwritten, duplicate rejected';

  delete from public.insight_metric where organization_id = v_org_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Long / narrow shape — same (org, day), different metric OR different source
--    is a separate row, not a conflict.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid := gen_random_uuid();
  v_count  bigint;
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm607 narrow', 'm607-narrow-' || replace(v_org_id::text, '-', ''));

  -- Same org + same day. Four rows that differ only by source or metric — all
  -- must coexist (one row per number, per day).
  insert into public.insight_metric (organization_id, source, metric_date, metric, value) values
    (v_org_id, 'business_profile', date '2026-06-25', 'calls',        12),
    (v_org_id, 'business_profile', date '2026-06-25', 'website_clicks', 40),
    (v_org_id, 'search_console',   date '2026-06-25', 'clicks',        88),
    (v_org_id, 'search_console',   date '2026-06-25', 'impressions', 1200);

  select count(*) into v_count
    from public.insight_metric where organization_id = v_org_id;
  if v_count <> 4 then
    raise exception 'm607 smoke: long/narrow shape collapsed rows (% of 4)', v_count;
  end if;
  raise notice 'm607 smoke: long/narrow — same day keeps each (source, metric) as its own row';

  delete from public.insight_metric where organization_id = v_org_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS enabled + admin-only org-isolation policy present.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rls_on boolean;
  v_policy text;
begin
  select relrowsecurity into v_rls_on
    from pg_class where oid = 'public.insight_metric'::regclass;
  if not coalesce(v_rls_on, false) then
    raise exception 'm607 smoke: RLS is not enabled on insight_metric';
  end if;

  select string_agg(polname, ', ')
    into v_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'insight_metric'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%active_organization_id%'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%admin%';

  if v_policy is null then
    raise exception 'm607 smoke: insight_metric has no admin-only org-isolation RLS policy';
  end if;
  raise notice 'm607 smoke: RLS on; admin-only org-isolation policy present (%)', v_policy;
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS behaviour — a cross-Organization INSERT is denied. The caller is active
--    in org B with a synthetic identity (no membership anywhere); the proposed
--    row belongs to org A. Both the org match and the admin EXISTS fail, so the
--    WITH CHECK denies it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a   uuid := '60700000-0000-0000-0000-0000000000a1';
  v_org_b   uuid := '60700000-0000-0000-0000-0000000000b1';
  v_blocked boolean := false;
begin
  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm607 rls A', 'm607-rls-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm607 rls B', 'm607-rls-b-' || replace(v_org_b::text, '-', ''));

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"60700000-0000-0000-0000-0000000000f1","active_organization_id":"60700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
  begin
    insert into public.insight_metric (organization_id, source, metric_date, metric, value)
      values (v_org_a, 'business_profile', date '2026-06-25', 'calls', 5);
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'm607 smoke: cross-org INSERT into another Organization was NOT denied';
  end if;
  raise notice 'm607 smoke: RLS — cross-org INSERT denied';
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS behaviour — admin-only access. A non-admin member of the org is denied
--    both read and write; promoting them to admin lets them see and insert. The
--    membership EXISTS + auth.uid() need a real auth.users row, so this section
--    skips itself when the database has none.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org    uuid := '60700000-0000-0000-0000-0000000000a2';
  v_user   uuid;
  v_count  bigint;
  v_denied boolean := false;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm607 smoke: admin-only RLS skipped — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug)
    values (v_org, 'm607 admin', 'm607-admin-' || replace(v_org::text, '-', ''));

  -- Seed one metric under owner bypass.
  insert into public.insight_metric (organization_id, source, metric_date, metric, value)
    values (v_org, 'business_profile', date '2026-06-25', 'calls', 7);

  -- The caller is a NON-admin member of the org.
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org, 'crew_member');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);

  -- Non-admin: sees nothing.
  select count(*) into v_count from public.insight_metric;
  if v_count <> 0 then
    reset role;
    raise exception 'm607 smoke: non-admin member saw % insight_metric rows (expected 0)', v_count;
  end if;
  -- Non-admin: cannot insert.
  begin
    insert into public.insight_metric (organization_id, source, metric_date, metric, value)
      values (v_org, 'business_profile', date '2026-06-25', 'website_clicks', 3);
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'm607 smoke: non-admin member was allowed to INSERT an insight_metric';
  end if;

  -- Promote to admin: now visible.
  update public.user_organizations set role = 'admin'
    where user_id = v_user and organization_id = v_org;

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);
  select count(*) into v_count from public.insight_metric;
  reset role;

  if v_count <> 1 then
    raise exception 'm607 smoke: admin member saw % insight_metric rows (expected 1)', v_count;
  end if;
  raise notice 'm607 smoke: RLS — non-admin denied read+write, admin sees the row';
end $$;

rollback;

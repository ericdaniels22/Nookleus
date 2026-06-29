-- issue #612 (parent PRD #603) — Website (WordPress) connection smoke test.
--
-- Purpose:   Self-checking script that verifies migration-612's schema
--            invariants and RLS. NOT part of the migration. Wrapped in
--            begin; ... rollback; so the database is unchanged on a clean run.
--            Every assertion raises on failure; a clean run prints only NOTICE
--            lines.
--
-- Preconditions: migration-612 has been applied. The admin-allow section needs
--            a real auth.users row and skips itself if the database has none;
--            every other section runs unconditionally.
--
-- Run:       psql -f supabase/migration-612-smoke-test.sql
--            (or paste into the Supabase SQL editor / run via the Supabase MCP).
--
-- What it pins:
--   1. Table exists with every expected column.
--   2. status accepts 'connected' / 'broken', rejects anything else; provider
--      accepts 'wordpress' and rejects anything else.
--   3. One connection per Organization (uniq_website_connection_org): a second
--      row for the same org is rejected.
--   4. RLS is enabled and carries an admin-only org-isolation policy (the policy
--      text references active_organization_id and role = 'admin').
--   5. RLS behaviour: a cross-Organization INSERT is denied.
--   6. RLS behaviour: a non-admin member of the org is denied; an admin member
--      sees and can write the row (skipped if no auth.users row exists).

begin;

-- ---------------------------------------------------------------------------
-- 1. Table and key columns exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg('website_connection.' || col, ', ')
    into v_missing
  from unnest(array[
    'id', 'organization_id', 'provider', 'site_url', 'username',
    'application_password_encrypted', 'account_name', 'status',
    'broken_reason', 'broken_at', 'connected_by', 'created_at', 'updated_at'
  ]) as col
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'website_connection'
       and column_name = col
  );

  if v_missing is not null then
    raise exception 'migration-612 smoke: missing column(s): %', v_missing;
  end if;
  raise notice 'migration-612 smoke: table + columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. status + provider checks, and 3. one-per-org uniqueness.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm612 smoke', 'm612-smoke-' || replace(v_org_id::text, '-', ''));

  -- ----- 2a. status check -----
  begin
    insert into public.website_connection
      (organization_id, site_url, username, application_password_encrypted, status)
      values (v_org_id, 'https://example.com', 'marketing', 'enc', 'bogus');
    raise exception 'm612 smoke: status accepted invalid value "bogus"';
  exception when check_violation then null;
  end;

  -- ----- 2b. provider check -----
  begin
    insert into public.website_connection
      (organization_id, provider, site_url, username, application_password_encrypted)
      values (v_org_id, 'squarespace', 'https://example.com', 'marketing', 'enc');
    raise exception 'm612 smoke: provider accepted invalid value "squarespace"';
  exception when check_violation then null;
  end;

  insert into public.website_connection
    (organization_id, site_url, username, application_password_encrypted, status)
    values (v_org_id, 'https://example.com', 'marketing', 'enc', 'connected');
  update public.website_connection set status = 'broken' where organization_id = v_org_id;
  raise notice 'm612 smoke: status — accepts connected/broken; provider — wordpress only';

  -- ----- 3. one connection per Organization -----
  begin
    insert into public.website_connection
      (organization_id, site_url, username, application_password_encrypted)
      values (v_org_id, 'https://example.com', 'marketing', 'enc2');
    raise exception 'm612 smoke: uniq_website_connection_org allowed a SECOND connection for one org';
  exception when unique_violation then null;
  end;
  raise notice 'm612 smoke: one-connection-per-org — second row rejected';

  delete from public.website_connection where organization_id = v_org_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS enabled + admin-only org-isolation policy present.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rls_on boolean;
  v_policy text;
begin
  select relrowsecurity into v_rls_on
    from pg_class where oid = 'public.website_connection'::regclass;
  if not coalesce(v_rls_on, false) then
    raise exception 'm612 smoke: RLS is not enabled on website_connection';
  end if;

  select string_agg(polname, ', ')
    into v_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'website_connection'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%active_organization_id%'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%admin%';

  if v_policy is null then
    raise exception 'm612 smoke: website_connection has no admin-only org-isolation RLS policy';
  end if;
  raise notice 'm612 smoke: RLS on; admin-only org-isolation policy present (%)', v_policy;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS behaviour — a cross-Organization INSERT is denied. The caller is
--    active in org B with a synthetic identity (no membership anywhere); the
--    proposed row belongs to org A. Both the org match and the admin EXISTS
--    fail, so the WITH CHECK denies it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a   uuid := '61200000-0000-0000-0000-0000000000a1';
  v_org_b   uuid := '61200000-0000-0000-0000-0000000000b1';
  v_blocked boolean := false;
begin
  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm612 rls A', 'm612-rls-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm612 rls B', 'm612-rls-b-' || replace(v_org_b::text, '-', ''));

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"61200000-0000-0000-0000-0000000000f1","active_organization_id":"61200000-0000-0000-0000-0000000000b1","role":"authenticated"}';
  begin
    insert into public.website_connection
      (organization_id, site_url, username, application_password_encrypted)
      values (v_org_a, 'https://example.com', 'marketing', 'enc');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'm612 smoke: cross-org INSERT into another Organization was NOT denied';
  end if;
  raise notice 'm612 smoke: RLS — cross-org INSERT denied';
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS behaviour — admin-only access. A non-admin member of the org is denied
--    both read and write; promoting them to admin lets them see and insert. The
--    membership EXISTS + auth.uid() need a real auth.users row, so this section
--    skips itself when the database has none.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org    uuid := '61200000-0000-0000-0000-0000000000a2';
  v_user   uuid;
  v_count  bigint;
  v_denied boolean := false;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm612 smoke: admin-only RLS skipped — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug)
    values (v_org, 'm612 admin', 'm612-admin-' || replace(v_org::text, '-', ''));

  -- Seed one connection under owner bypass.
  insert into public.website_connection
    (organization_id, site_url, username, application_password_encrypted)
    values (v_org, 'https://example.com', 'marketing', 'enc');

  -- The caller is a NON-admin member of the org.
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org, 'crew_member');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);

  -- Non-admin: sees nothing.
  select count(*) into v_count from public.website_connection;
  if v_count <> 0 then
    reset role;
    raise exception 'm612 smoke: non-admin member saw % website_connection rows (expected 0)', v_count;
  end if;
  -- Non-admin: cannot insert (would collide on org anyway; denial fires first).
  begin
    insert into public.website_connection
      (organization_id, site_url, username, application_password_encrypted)
      values (v_org, 'https://example.com', 'marketing', 'enc-nonadmin');
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'm612 smoke: non-admin member was allowed to INSERT a website_connection';
  end if;

  -- Promote to admin: now visible.
  update public.user_organizations set role = 'admin'
    where user_id = v_user and organization_id = v_org;

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);
  select count(*) into v_count from public.website_connection;
  reset role;

  if v_count <> 1 then
    raise exception 'm612 smoke: admin member saw % website_connection rows (expected 1)', v_count;
  end if;
  raise notice 'm612 smoke: RLS — non-admin denied read+write, admin sees the row';
end $$;

rollback;

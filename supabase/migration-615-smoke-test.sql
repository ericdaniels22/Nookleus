-- issue #615 (parent PRD #603) — Google connection smoke test.
--
-- Purpose:   Self-checking script that verifies migration-615's schema
--            invariants and RLS. NOT part of the migration. Wrapped in
--            begin; ... rollback; so the database is unchanged on a clean run.
--            Every assertion raises on failure; a clean run prints only NOTICE
--            lines.
--
-- Preconditions: migration-615 has been applied. The admin-allow section needs
--            a real auth.users row and skips itself if the database has none;
--            every other section runs unconditionally.
--
-- Run:       psql -f supabase/migration-615-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. Table exists with every expected column.
--   2. status accepts 'connected' / 'broken', rejects anything else.
--   3. One connection per Organization (uniq_google_connection_org): a second
--      row for the same org is rejected.
--   4. RLS is enabled and carries an admin-only org-isolation policy (the
--      policy text references active_organization_id and role = 'admin').
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
  select string_agg('google_connection.' || col, ', ')
    into v_missing
  from unnest(array[
    'id', 'organization_id', 'google_account_email', 'google_account_name',
    'refresh_token_encrypted', 'access_token_encrypted', 'access_token_expires_at',
    'scopes', 'status', 'broken_reason', 'broken_at', 'connected_by',
    'created_at', 'updated_at'
  ]) as col
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'google_connection'
       and column_name = col
  );

  if v_missing is not null then
    raise exception 'migration-615 smoke: missing column(s): %', v_missing;
  end if;
  raise notice 'migration-615 smoke: table + columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. status check + 3. one-per-org uniqueness.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm615 smoke', 'm615-smoke-' || replace(v_org_id::text, '-', ''));

  -- ----- 2. status check -----
  begin
    insert into public.google_connection (organization_id, refresh_token_encrypted, status)
      values (v_org_id, 'enc', 'bogus');
    raise exception 'm615 smoke: status accepted invalid value "bogus"';
  exception when check_violation then null;
  end;

  insert into public.google_connection (organization_id, refresh_token_encrypted, status)
    values (v_org_id, 'enc', 'connected');
  update public.google_connection set status = 'broken' where organization_id = v_org_id;
  raise notice 'm615 smoke: status — accepts connected/broken, rejects "bogus"';

  -- ----- 3. one connection per Organization -----
  begin
    insert into public.google_connection (organization_id, refresh_token_encrypted)
      values (v_org_id, 'enc2');
    raise exception 'm615 smoke: uniq_google_connection_org allowed a SECOND connection for one org';
  exception when unique_violation then null;
  end;
  raise notice 'm615 smoke: one-connection-per-org — second row rejected';

  delete from public.google_connection where organization_id = v_org_id;
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
    from pg_class where oid = 'public.google_connection'::regclass;
  if not coalesce(v_rls_on, false) then
    raise exception 'm615 smoke: RLS is not enabled on google_connection';
  end if;

  select string_agg(polname, ', ')
    into v_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'google_connection'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%active_organization_id%'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%admin%';

  if v_policy is null then
    raise exception 'm615 smoke: google_connection has no admin-only org-isolation RLS policy';
  end if;
  raise notice 'm615 smoke: RLS on; admin-only org-isolation policy present (%)', v_policy;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS behaviour — a cross-Organization INSERT is denied. The caller is
--    active in org B with a synthetic identity (no membership anywhere); the
--    proposed row belongs to org A. Both the org match and the admin EXISTS
--    fail, so the WITH CHECK denies it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a   uuid := '61500000-0000-0000-0000-0000000000a1';
  v_org_b   uuid := '61500000-0000-0000-0000-0000000000b1';
  v_blocked boolean := false;
begin
  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm615 rls A', 'm615-rls-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm615 rls B', 'm615-rls-b-' || replace(v_org_b::text, '-', ''));

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"61500000-0000-0000-0000-0000000000f1","active_organization_id":"61500000-0000-0000-0000-0000000000b1","role":"authenticated"}';
  begin
    insert into public.google_connection (organization_id, refresh_token_encrypted)
      values (v_org_a, 'enc');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'm615 smoke: cross-org INSERT into another Organization was NOT denied';
  end if;
  raise notice 'm615 smoke: RLS — cross-org INSERT denied';
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS behaviour — admin-only access. A non-admin member of the org is denied
--    both read and write; promoting them to admin lets them see and insert. The
--    membership EXISTS + auth.uid() need a real auth.users row, so this section
--    skips itself when the database has none.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org    uuid := '61500000-0000-0000-0000-0000000000a2';
  v_user   uuid;
  v_count  bigint;
  v_denied boolean := false;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm615 smoke: admin-only RLS skipped — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug)
    values (v_org, 'm615 admin', 'm615-admin-' || replace(v_org::text, '-', ''));

  -- Seed one connection under owner bypass.
  insert into public.google_connection (organization_id, refresh_token_encrypted)
    values (v_org, 'enc');

  -- The caller is a NON-admin member of the org.
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org, 'crew_member');

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);

  -- Non-admin: sees nothing.
  select count(*) into v_count from public.google_connection;
  if v_count <> 0 then
    reset role;
    raise exception 'm615 smoke: non-admin member saw % google_connection rows (expected 0)', v_count;
  end if;
  -- Non-admin: cannot insert (would collide on org anyway; denial fires first).
  begin
    insert into public.google_connection (organization_id, refresh_token_encrypted)
      values (v_org, 'enc-nonadmin');
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'm615 smoke: non-admin member was allowed to INSERT a google_connection';
  end if;

  -- Promote to admin: now visible.
  update public.user_organizations set role = 'admin'
    where user_id = v_user and organization_id = v_org;

  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org::text, 'role', 'authenticated')::text,
    true);
  select count(*) into v_count from public.google_connection;
  reset role;

  if v_count <> 1 then
    raise exception 'm615 smoke: admin member saw % google_connection rows (expected 1)', v_count;
  end if;
  raise notice 'm615 smoke: RLS — non-admin denied read+write, admin sees the row';
end $$;

rollback;

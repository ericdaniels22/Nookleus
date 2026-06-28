-- issue #705 (parent epic #699) — view_timesheets permission-defaults smoke test.
--
-- Purpose:   Self-checking script for migration-693. NOT part of the migration.
--            Wrapped in begin; ... rollback; so the database is unchanged on a
--            clean run. Every assertion raises on failure; a clean run prints
--            only NOTICE lines.
--
-- Preconditions: migration-662 and migration-693 have been applied.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project, or
--            psql -f supabase/migration-693-smoke-test.sql.
--
-- What it pins — the database mirror matches TS `ROLE_DEFAULTS` for the keys in
-- play, and the backfill is idempotent:
--   1. set_default_permissions parity. For admin / crew_lead / crew_member /
--      custom, the function grants view_timesheets per #705 § Permission
--      (ON, ON, OFF, OFF) — the same admin+crew_lead distribution as view_phone.
--   2. No collateral drift. The same call leaves track_time (ON/ON/ON/OFF) and
--      view_phone (ON/ON/OFF/OFF) exactly as migration-662/306 set them — adding
--      view_timesheets did not disturb a neighbouring key's grant for any role.
--   3. Backfill correctness + idempotency. The migration's backfill INSERT grants
--      view_timesheets ON for admin/crew_lead, OFF otherwise, on a membership
--      that had no row; re-running it does NOT overwrite a hand-toggled grant
--      (the DO NOTHING respects manual edits).
--
-- Fixed UUID prefix `46` keeps these seeds distinct from migration-140 (`40`),
-- migration-222 (`41`), and migration-307 (`42`).

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass (no `set role authenticated`): the function and
--    the backfill run as the privileged migration runner, so this matches how
--    migration-693 actually executes. Two Organizations:
--      Org A (..a1) — exercises set_default_permissions() directly.
--      Org B (..b1) — exercises the backfill INSERT on fresh, row-less members.
--    Each Org gets one membership per role: admin, crew_lead, crew_member, custom.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('46000000-0000-0000-0000-0000000000a1', 'smoke-693-org-a', 'smoke-693-org-a'),
  ('46000000-0000-0000-0000-0000000000b1', 'smoke-693-org-b', 'smoke-693-org-b');

insert into auth.users (id, email, role, aud, instance_id)
values
  -- Org A
  ('46000000-0000-0000-0000-0000000000a2', 'smoke-693-a-admin@example.invalid',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('46000000-0000-0000-0000-0000000000a3', 'smoke-693-a-lead@example.invalid',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('46000000-0000-0000-0000-0000000000a4', 'smoke-693-a-member@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('46000000-0000-0000-0000-0000000000a5', 'smoke-693-a-custom@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  -- Org B
  ('46000000-0000-0000-0000-0000000000b2', 'smoke-693-b-admin@example.invalid',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('46000000-0000-0000-0000-0000000000b3', 'smoke-693-b-lead@example.invalid',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('46000000-0000-0000-0000-0000000000b4', 'smoke-693-b-member@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('46000000-0000-0000-0000-0000000000b5', 'smoke-693-b-custom@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

-- Memberships with fixed ids so the assertions can name them.
insert into public.user_organizations (id, user_id, organization_id, role)
values
  ('46000000-0000-0000-0000-0000000000aa', '46000000-0000-0000-0000-0000000000a2', '46000000-0000-0000-0000-0000000000a1', 'admin'),
  ('46000000-0000-0000-0000-0000000000ab', '46000000-0000-0000-0000-0000000000a3', '46000000-0000-0000-0000-0000000000a1', 'crew_lead'),
  ('46000000-0000-0000-0000-0000000000ac', '46000000-0000-0000-0000-0000000000a4', '46000000-0000-0000-0000-0000000000a1', 'crew_member'),
  ('46000000-0000-0000-0000-0000000000ad', '46000000-0000-0000-0000-0000000000a5', '46000000-0000-0000-0000-0000000000a1', 'custom'),
  ('46000000-0000-0000-0000-0000000000ba', '46000000-0000-0000-0000-0000000000b2', '46000000-0000-0000-0000-0000000000b1', 'admin'),
  ('46000000-0000-0000-0000-0000000000bb', '46000000-0000-0000-0000-0000000000b3', '46000000-0000-0000-0000-0000000000b1', 'crew_lead'),
  ('46000000-0000-0000-0000-0000000000bc', '46000000-0000-0000-0000-0000000000b4', '46000000-0000-0000-0000-0000000000b1', 'crew_member'),
  ('46000000-0000-0000-0000-0000000000bd', '46000000-0000-0000-0000-0000000000b5', '46000000-0000-0000-0000-0000000000b1', 'custom');

-- ---------------------------------------------------------------------------
-- 1. set_default_permissions parity — view_timesheets is ON for admin +
--    crew_lead, OFF for crew_member + custom (#705 § Permission). Mirrors TS
--    ROLE_DEFAULTS, which lists view_timesheets only under admin and crew_lead.
-- ---------------------------------------------------------------------------
do $$
declare
  v_grant boolean;
begin
  perform set_default_permissions('46000000-0000-0000-0000-0000000000aa', 'admin');
  perform set_default_permissions('46000000-0000-0000-0000-0000000000ab', 'crew_lead');
  perform set_default_permissions('46000000-0000-0000-0000-0000000000ac', 'crew_member');
  perform set_default_permissions('46000000-0000-0000-0000-0000000000ad', 'custom');

  -- admin → ON
  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000aa' and permission_key = 'view_timesheets';
  if v_grant is distinct from true then
    raise exception 'm693 smoke (1): admin view_timesheets expected ON, got %', v_grant;
  end if;

  -- crew_lead → ON
  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000ab' and permission_key = 'view_timesheets';
  if v_grant is distinct from true then
    raise exception 'm693 smoke (1): crew_lead view_timesheets expected ON, got %', v_grant;
  end if;

  -- crew_member → OFF (the key contrast with track_time, which is ON for crew_member)
  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000ac' and permission_key = 'view_timesheets';
  if v_grant is distinct from false then
    raise exception 'm693 smoke (1): crew_member view_timesheets expected OFF, got %', v_grant;
  end if;

  -- custom → OFF
  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000ad' and permission_key = 'view_timesheets';
  if v_grant is distinct from false then
    raise exception 'm693 smoke (1): custom view_timesheets expected OFF, got %', v_grant;
  end if;

  raise notice 'm693 smoke (1): set_default_permissions grants view_timesheets ON/ON/OFF/OFF (admin/lead/member/custom)';
end $$;

-- ---------------------------------------------------------------------------
-- 2. No collateral drift — the same call left track_time (ON/ON/ON/OFF) and
--    view_phone (ON/ON/OFF/OFF) exactly as migration-662/306 defined them.
--    Adding view_timesheets must not perturb a neighbouring key for any role.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_grant boolean;
  -- expected[role] = (track_time, view_phone)
  expected jsonb := jsonb_build_object(
    '46000000-0000-0000-0000-0000000000aa', jsonb_build_object('track_time', true,  'view_phone', true),
    '46000000-0000-0000-0000-0000000000ab', jsonb_build_object('track_time', true,  'view_phone', true),
    '46000000-0000-0000-0000-0000000000ac', jsonb_build_object('track_time', true,  'view_phone', false),
    '46000000-0000-0000-0000-0000000000ad', jsonb_build_object('track_time', false, 'view_phone', false)
  );
  key text;
begin
  for r in select * from jsonb_each(expected) loop
    foreach key in array array['track_time', 'view_phone'] loop
      select granted into v_grant from public.user_organization_permissions
       where user_organization_id = r.key::uuid and permission_key = key;
      if v_grant is distinct from (r.value ->> key)::boolean then
        raise exception 'm693 smoke (2): membership % key % expected %, got % (collateral drift)',
          r.key, key, (r.value ->> key), v_grant;
      end if;
    end loop;
  end loop;
  raise notice 'm693 smoke (2): track_time + view_phone grants unchanged — no collateral drift';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Backfill correctness + idempotency. Org B's memberships have NO
--    view_timesheets row yet (set_default_permissions was never called on
--    them). Run the migration's exact backfill INSERT: it must grant ON for
--    admin/crew_lead and OFF for crew_member/custom. Then hand-toggle admin's
--    grant OFF and re-run the backfill — the DO NOTHING must preserve the
--    manual edit (idempotent, non-destructive).
-- ---------------------------------------------------------------------------
do $$
declare
  v_grant boolean;
begin
  -- Pre-check: Org B has no view_timesheets rows (so we're truly testing backfill).
  if exists (
    select 1 from public.user_organization_permissions uop
      join public.user_organizations uo on uo.id = uop.user_organization_id
     where uo.organization_id = '46000000-0000-0000-0000-0000000000b1'
       and uop.permission_key = 'view_timesheets'
  ) then
    raise exception 'm693 smoke (3): Org B already had view_timesheets rows before backfill — test setup invalid';
  end if;

  -- ----- 3a. backfill grants per role (the migration's exact statement) -----
  insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
  select uo.id,
         'view_timesheets',
         case when uo.role in ('admin', 'crew_lead') then true else false end
    from public.user_organizations uo
   on conflict (user_organization_id, permission_key) do nothing;

  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000ba' and permission_key = 'view_timesheets';
  if v_grant is distinct from true then
    raise exception 'm693 smoke (3a): backfilled admin view_timesheets expected ON, got %', v_grant;
  end if;
  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000bb' and permission_key = 'view_timesheets';
  if v_grant is distinct from true then
    raise exception 'm693 smoke (3a): backfilled crew_lead view_timesheets expected ON, got %', v_grant;
  end if;
  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000bc' and permission_key = 'view_timesheets';
  if v_grant is distinct from false then
    raise exception 'm693 smoke (3a): backfilled crew_member view_timesheets expected OFF, got %', v_grant;
  end if;
  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000bd' and permission_key = 'view_timesheets';
  if v_grant is distinct from false then
    raise exception 'm693 smoke (3a): backfilled custom view_timesheets expected OFF, got %', v_grant;
  end if;

  -- ----- 3b. idempotency: a hand-toggle survives a re-run (DO NOTHING) -----
  update public.user_organization_permissions set granted = false
   where user_organization_id = '46000000-0000-0000-0000-0000000000ba' and permission_key = 'view_timesheets';

  insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
  select uo.id,
         'view_timesheets',
         case when uo.role in ('admin', 'crew_lead') then true else false end
    from public.user_organizations uo
   on conflict (user_organization_id, permission_key) do nothing;

  select granted into v_grant from public.user_organization_permissions
   where user_organization_id = '46000000-0000-0000-0000-0000000000ba' and permission_key = 'view_timesheets';
  if v_grant is distinct from false then
    raise exception 'm693 smoke (3b): backfill re-run OVERWROTE a hand-toggled grant (expected OFF preserved), got %', v_grant;
  end if;

  raise notice 'm693 smoke (3): backfill grants ON/ON/OFF/OFF and re-run preserves manual toggles (idempotent)';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Done. Roll back so the seed leaves no residue. A clean run prints only the
--    NOTICE lines above; a failed run aborts earlier with a labeled exception.
-- ---------------------------------------------------------------------------
rollback;

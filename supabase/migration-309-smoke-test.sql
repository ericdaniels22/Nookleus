-- issue #309 (PRD #304) — phone_opt_outs RLS smoke test.
--
-- Purpose:   Verify migration-309 enforces:
--              - org-scoped SELECT (cross-org caller sees nothing)
--              - admin-only UPDATE (non-admin cannot re-opt-in)
--              - UNIQUE (organization_id, outside_e164) prevents duplicates
--
-- Shape:     One transaction, rolled back at the end. Service-role seeds
--            two orgs / three users, then exercises the policies through
--            JWT-claim role switches in DO blocks.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project,
--            same as migration-308-smoke-test.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('a9000000-0000-0000-0000-000000000001', 'smoke-309-org-1', 'smoke-309-org-1'),
  ('a9000000-0000-0000-0000-000000000002', 'smoke-309-org-2', 'smoke-309-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('a9000000-0000-0000-0000-000000000010', 'smoke-309-admin1@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a9000000-0000-0000-0000-000000000011', 'smoke-309-crew1@example.invalid',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a9000000-0000-0000-0000-000000000020', 'smoke-309-admin2@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('a9000000-0000-0000-0000-000000000010', 'a9000000-0000-0000-0000-000000000001', 'admin'),
  ('a9000000-0000-0000-0000-000000000011', 'a9000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('a9000000-0000-0000-0000-000000000020', 'a9000000-0000-0000-0000-000000000002', 'admin');

-- Two opt-out rows: one per org, same outside_e164 (cross-org isolation
-- proves the UNIQUE is org-scoped, not global).
insert into public.phone_opt_outs (id, organization_id, outside_e164)
values
  ('a9000000-0000-0000-0000-0000000000f1', 'a9000000-0000-0000-0000-000000000001', '+15551112222'),
  ('a9000000-0000-0000-0000-0000000000f2', 'a9000000-0000-0000-0000-000000000002', '+15551112222');

-- ---------------------------------------------------------------------------
-- 1. UNIQUE (org, outside_e164) blocks a duplicate insert in the same org.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.phone_opt_outs (organization_id, outside_e164)
    values ('a9000000-0000-0000-0000-000000000001', '+15551112222');
    raise exception 'migration-309 smoke (case 1: UNIQUE): expected unique_violation';
  exception when unique_violation then
    raise notice 'migration-309 smoke (case 1: UNIQUE) — duplicate (org, outside) rejected as expected';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Cross-org SELECT — admin in org-2 cannot see org-1's opt-out row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a9000000-0000-0000-0000-000000000020","active_organization_id":"a9000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_count from public.phone_opt_outs
   where organization_id = 'a9000000-0000-0000-0000-000000000001';

  reset role;

  if v_count <> 0 then
    raise exception 'migration-309 smoke (case 2: cross-org SELECT): expected 0, got %', v_count;
  end if;
  raise notice 'migration-309 smoke (case 2: cross-org SELECT) — cross-org row hidden';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Same-org SELECT — crew_lead in org-1 CAN see org-1's opt-out row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a9000000-0000-0000-0000-000000000011","active_organization_id":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_count from public.phone_opt_outs;

  reset role;

  if v_count <> 1 then
    raise exception 'migration-309 smoke (case 3: same-org SELECT): expected 1, got %', v_count;
  end if;
  raise notice 'migration-309 smoke (case 3: same-org SELECT) — crew_lead can see same-org opt-out';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Admin-only UPDATE — admin in org-1 can re-opt-in.
-- ---------------------------------------------------------------------------
do $$
declare
  v_updated int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a9000000-0000-0000-0000-000000000010","active_organization_id":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';

  update public.phone_opt_outs
     set re_opted_in_at = now(),
         re_opted_in_note = 'fresh consent — confirmed by phone',
         re_opted_in_by_user_id = 'a9000000-0000-0000-0000-000000000010'
   where id = 'a9000000-0000-0000-0000-0000000000f1';
  get diagnostics v_updated = row_count;

  reset role;

  if v_updated <> 1 then
    raise exception 'migration-309 smoke (case 4: admin UPDATE): expected 1 row updated, got %', v_updated;
  end if;
  raise notice 'migration-309 smoke (case 4: admin UPDATE) — admin can re-opt-in';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Non-admin UPDATE — crew_lead in org-1 cannot mutate the re-opt-in fields.
--    Reset the row first (UPDATE will run but match 0 rows due to RLS).
-- ---------------------------------------------------------------------------
update public.phone_opt_outs
   set re_opted_in_at = null,
       re_opted_in_note = null,
       re_opted_in_by_user_id = null
 where id = 'a9000000-0000-0000-0000-0000000000f1';

do $$
declare
  v_updated int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a9000000-0000-0000-0000-000000000011","active_organization_id":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';

  update public.phone_opt_outs
     set re_opted_in_at = now()
   where id = 'a9000000-0000-0000-0000-0000000000f1';
  get diagnostics v_updated = row_count;

  reset role;

  if v_updated <> 0 then
    raise exception 'migration-309 smoke (case 5: crew_lead UPDATE blocked): expected 0 rows updated, got %', v_updated;
  end if;
  raise notice 'migration-309 smoke (case 5: crew_lead UPDATE blocked) — non-admin cannot re-opt-in';
end $$;

rollback;

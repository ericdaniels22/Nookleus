-- issue #312 (PRD #304, ADR 0005 + ADR 0006) — phone_calls access-matrix
-- smoke test.
--
-- Purpose:   Verify that the migration-312 phone_calls RLS policy encodes
--            every cell of the ADR 0005 read-path matrix at the database,
--            in the SAME shape migration-308-smoke-test.sql pins for
--            phone_messages. The phone-event-access TypeScript module has
--            the same matrix in code; the two are kept in sync by these
--            cases mirroring src/lib/phone/phone-event-access.test.ts.
--
--            Matrix exercised (phone_calls SELECT):
--              - Shared untagged          → every same-org member sees
--              - Shared Job-tagged        → every same-org member sees
--              - Personal untagged, owner → owner sees
--              - Personal untagged, other → hidden
--              - Personal Job-tagged, any → sees (Job-visible team)
--              - Cross-org caller         → never sees
--
-- Shape:     One transaction, rolled back at the end. Service-role seeds
--            two orgs, four users, two phone_numbers (Shared + Personal),
--            two conversations, one Job, four phone_calls covering the
--            matrix. Each assertion block sets the JWT claims, switches to
--            `authenticated`, runs a SELECT, and asserts the row-count.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass for orgs / users / memberships.
--      Org 1: smoke-312-org-1
--        User A — admin
--        User B — crew_lead (non-owner of any Personal number)
--        User C — crew_lead (owner of the Personal number)
--      Org 2: smoke-312-org-2
--        User D — admin
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('31200000-0000-0000-0000-000000000001', 'smoke-312-org-1', 'smoke-312-org-1'),
  ('31200000-0000-0000-0000-000000000002', 'smoke-312-org-2', 'smoke-312-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('31200000-0000-0000-0000-000000000010', 'smoke-312-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31200000-0000-0000-0000-000000000011', 'smoke-312-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31200000-0000-0000-0000-000000000012', 'smoke-312-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31200000-0000-0000-0000-000000000013', 'smoke-312-d@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('31200000-0000-0000-0000-000000000010', '31200000-0000-0000-0000-000000000001', 'admin'),
  ('31200000-0000-0000-0000-000000000011', '31200000-0000-0000-0000-000000000001', 'crew_lead'),
  ('31200000-0000-0000-0000-000000000012', '31200000-0000-0000-0000-000000000001', 'crew_lead'),
  ('31200000-0000-0000-0000-000000000013', '31200000-0000-0000-0000-000000000002', 'admin');

-- Two phone numbers in org-1: one Shared, one Personal owned by User C.
insert into public.phone_numbers
  (id, organization_id, twilio_sid, e164, kind, user_id)
values
  ('31200000-0000-0000-0000-0000000000a1', '31200000-0000-0000-0000-000000000001',
   'PN-smoke312-shared', '+15125550000', 'shared', null),
  ('31200000-0000-0000-0000-0000000000a2', '31200000-0000-0000-0000-000000000001',
   'PN-smoke312-personal', '+15125550001', 'personal',
   '31200000-0000-0000-0000-000000000012');

-- Two conversations — one on each number.
insert into public.phone_conversations
  (id, organization_id, phone_number_id, outside_e164)
values
  ('31200000-0000-0000-0000-0000000000b1', '31200000-0000-0000-0000-000000000001',
   '31200000-0000-0000-0000-0000000000a1', '+15551110001'),
  ('31200000-0000-0000-0000-0000000000b2', '31200000-0000-0000-0000-000000000001',
   '31200000-0000-0000-0000-0000000000a2', '+15551110002');

-- One Job in org-1 for the Job-tagged cases. Contact is a placeholder.
insert into public.contacts (id, full_name)
values ('31200000-0000-0000-0000-0000000000c1', 'smoke-312-contact');

insert into public.jobs
  (id, organization_id, contact_id, damage_type, property_address)
values
  ('31200000-0000-0000-0000-0000000000d1', '31200000-0000-0000-0000-000000000001',
   '31200000-0000-0000-0000-0000000000c1', 'water', '1 smoke st');

-- Four calls cover the matrix. twilio_call_sid carries the label so the
-- assertions can string_agg the visible set (mirrors phone_messages.body).
--   call1: Shared, untagged
--   call2: Shared, tagged (job d1)
--   call3: Personal (owner C), untagged
--   call4: Personal (owner C), tagged (job d1)
insert into public.phone_calls
  (id, organization_id, conversation_id, direction, from_e164, to_e164, twilio_call_sid, status, job_tag)
values
  ('31200000-0000-0000-0000-0000000000f1', '31200000-0000-0000-0000-000000000001',
   '31200000-0000-0000-0000-0000000000b1', 'in', '+15551110001', '+15125550000', 'shared-untagged', 'completed', null),
  ('31200000-0000-0000-0000-0000000000f2', '31200000-0000-0000-0000-000000000001',
   '31200000-0000-0000-0000-0000000000b1', 'in', '+15551110001', '+15125550000', 'shared-tagged', 'completed',
   '31200000-0000-0000-0000-0000000000d1'),
  ('31200000-0000-0000-0000-0000000000f3', '31200000-0000-0000-0000-000000000001',
   '31200000-0000-0000-0000-0000000000b2', 'in', '+15551110002', '+15125550001', 'personal-untagged', 'completed', null),
  ('31200000-0000-0000-0000-0000000000f4', '31200000-0000-0000-0000-000000000001',
   '31200000-0000-0000-0000-0000000000b2', 'in', '+15551110002', '+15125550001', 'personal-tagged', 'completed',
   '31200000-0000-0000-0000-0000000000d1');

-- ---------------------------------------------------------------------------
-- 1. User A (admin, org-1) — sees Shared-untagged, Shared-tagged,
--    Personal-tagged (Job-visible), but NOT Personal-untagged (admin
--    cannot read untagged Personal content per ADR 0005).
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_ids text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31200000-0000-0000-0000-000000000010","active_organization_id":"31200000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(twilio_call_sid, ',' order by twilio_call_sid)
    into v_count, v_ids
    from public.phone_calls;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-312 smoke (case 1: admin): expected 3 visible calls, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-312 smoke (case 1: admin): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-312 smoke (case 1: admin) — sees Shared+Personal-tagged, not Personal-untagged';
end $$;

-- ---------------------------------------------------------------------------
-- 2. User B (crew_lead, org-1, NOT owner of any Personal number) — sees
--    Shared-untagged, Shared-tagged, Personal-tagged, NOT Personal-untagged.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_ids text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31200000-0000-0000-0000-000000000011","active_organization_id":"31200000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(twilio_call_sid, ',' order by twilio_call_sid)
    into v_count, v_ids
    from public.phone_calls;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-312 smoke (case 2: crew_lead non-owner): expected 3 visible calls, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-312 smoke (case 2: crew_lead non-owner): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-312 smoke (case 2: crew_lead non-owner) — sees Shared+Personal-tagged, not Personal-untagged';
end $$;

-- ---------------------------------------------------------------------------
-- 3. User C (crew_lead, org-1, OWNER of Personal +15125550001) — sees all 4.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31200000-0000-0000-0000-000000000012","active_organization_id":"31200000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_count from public.phone_calls;

  reset role;

  if v_count <> 4 then
    raise exception 'migration-312 smoke (case 3: Personal owner): expected 4 visible calls, got %', v_count;
  end if;
  raise notice 'migration-312 smoke (case 3: Personal owner) — sees all 4 of own + Shared rows';
end $$;

-- ---------------------------------------------------------------------------
-- 4. User D (admin, org-2) — cross-org. Should see 0 calls.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31200000-0000-0000-0000-000000000013","active_organization_id":"31200000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_count from public.phone_calls;

  reset role;

  if v_count <> 0 then
    raise exception 'migration-312 smoke (case 4: cross-org admin): expected 0 visible calls, got %', v_count;
  end if;
  raise notice 'migration-312 smoke (case 4: cross-org admin) — sees nothing';
end $$;

-- ---------------------------------------------------------------------------
-- 5. phone_number_round_robin is locked to the Service role (RLS enabled,
--    no authenticated policy). An authenticated caller — even an org admin
--    — sees zero rows. Seed one cursor row under service-role bypass, then
--    assert User A reads none.
-- ---------------------------------------------------------------------------
insert into public.phone_number_round_robin (phone_number_id, organization_id, rotation_cursor)
values ('31200000-0000-0000-0000-0000000000a1', '31200000-0000-0000-0000-000000000001', 2);

do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31200000-0000-0000-0000-000000000010","active_organization_id":"31200000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_count from public.phone_number_round_robin;

  reset role;

  if v_count <> 0 then
    raise exception 'migration-312 smoke (case 5: round-robin lock): expected 0 rows visible to authenticated, got %', v_count;
  end if;
  raise notice 'migration-312 smoke (case 5: round-robin lock) — internal cursor table is Service-role only';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Done.
-- ---------------------------------------------------------------------------
rollback;

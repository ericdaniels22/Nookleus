-- issue #315 (PRD #304, ADR 0005) — phone_recordings access-matrix smoke test.
--
-- Purpose:   Verify that the migration-315 phone_recordings RLS policy encodes
--            every cell of the ADR 0005 read-path matrix at the database —
--            reached through the PARENT call — in the SAME shape
--            migration-313-smoke-test.sql pins for phone_voicemails. A
--            recording is visible exactly when its parent call is, so the
--            matrix is identical; the seed hangs one recording off each of the
--            four matrix-covering calls and asserts the same visible sets. This
--            is the load-bearing test that the RLS delegation (EXISTS over
--            phone_calls) inherits the lifted Job-tag visibility branch — so a
--            Job-tagged Personal recording stays team-visible.
--
--            Matrix exercised (phone_recordings SELECT, via parent call):
--              - Shared untagged          → every same-org member sees
--              - Shared Job-tagged        → every same-org member sees
--              - Personal untagged, owner → owner sees
--              - Personal untagged, other → hidden (incl. admin)
--              - Personal Job-tagged, any → sees (Job-visible team)
--              - Cross-org caller         → never sees
--
-- Shape:     One transaction, rolled back at the end. Service-role seeds two
--            orgs, four users, two phone_numbers (Shared + Personal), two
--            conversations, one Job, four phone_calls covering the matrix, and
--            one phone_recordings row per call. Each assertion block sets the
--            JWT claims, switches to `authenticated`, runs a SELECT, and
--            asserts the row-count + (where it discriminates) the visible set
--            via string_agg over twilio_recording_sid (the matrix label).
--
-- Run:       Via Supabase MCP `execute_sql` against the target project (with
--            migration-315 applied). Mirrors migration-313-smoke-test.sql.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass for orgs / users / memberships.
--      Org 1: smoke-315-org-1
--        User A — admin
--        User B — crew_lead (non-owner of any Personal number)
--        User C — crew_lead (owner of the Personal number)
--      Org 2: smoke-315-org-2
--        User D — admin
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('31500000-0000-0000-0000-000000000001', 'smoke-315-org-1', 'smoke-315-org-1'),
  ('31500000-0000-0000-0000-000000000002', 'smoke-315-org-2', 'smoke-315-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('31500000-0000-0000-0000-000000000010', 'smoke-315-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31500000-0000-0000-0000-000000000011', 'smoke-315-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31500000-0000-0000-0000-000000000012', 'smoke-315-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31500000-0000-0000-0000-000000000013', 'smoke-315-d@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('31500000-0000-0000-0000-000000000010', '31500000-0000-0000-0000-000000000001', 'admin'),
  ('31500000-0000-0000-0000-000000000011', '31500000-0000-0000-0000-000000000001', 'crew_lead'),
  ('31500000-0000-0000-0000-000000000012', '31500000-0000-0000-0000-000000000001', 'crew_lead'),
  ('31500000-0000-0000-0000-000000000013', '31500000-0000-0000-0000-000000000002', 'admin');

-- Two phone numbers in org-1: one Shared, one Personal owned by User C.
insert into public.phone_numbers
  (id, organization_id, twilio_sid, e164, kind, user_id)
values
  ('31500000-0000-0000-0000-0000000000a1', '31500000-0000-0000-0000-000000000001',
   'PN-smoke315-shared', '+15125550100', 'shared', null),
  ('31500000-0000-0000-0000-0000000000a2', '31500000-0000-0000-0000-000000000001',
   'PN-smoke315-personal', '+15125550101', 'personal',
   '31500000-0000-0000-0000-000000000012');

-- Two conversations — one on each number.
insert into public.phone_conversations
  (id, organization_id, phone_number_id, outside_e164)
values
  ('31500000-0000-0000-0000-0000000000b1', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000a1', '+15551110101'),
  ('31500000-0000-0000-0000-0000000000b2', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000a2', '+15551110102');

-- One Job in org-1 for the Job-tagged cases. Contact is a placeholder.
insert into public.contacts (id, organization_id, full_name)
values ('31500000-0000-0000-0000-0000000000c1',
        '31500000-0000-0000-0000-000000000001', 'smoke-315-contact');

insert into public.jobs
  (id, organization_id, contact_id, damage_type, property_address)
values
  ('31500000-0000-0000-0000-0000000000d1', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000c1', 'water', '1 smoke st');

-- Four calls cover the matrix.
--   call1: Shared, untagged
--   call2: Shared, tagged (job d1)
--   call3: Personal (owner C), untagged
--   call4: Personal (owner C), tagged (job d1)
insert into public.phone_calls
  (id, organization_id, conversation_id, direction, from_e164, to_e164, twilio_call_sid, status, job_tag)
values
  ('31500000-0000-0000-0000-0000000000f1', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000b1', 'in', '+15551110101', '+15125550100', 'CA-smoke315-1', 'completed', null),
  ('31500000-0000-0000-0000-0000000000f2', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000b1', 'in', '+15551110101', '+15125550100', 'CA-smoke315-2', 'completed',
   '31500000-0000-0000-0000-0000000000d1'),
  ('31500000-0000-0000-0000-0000000000f3', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000b2', 'in', '+15551110102', '+15125550101', 'CA-smoke315-3', 'completed', null),
  ('31500000-0000-0000-0000-0000000000f4', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000b2', 'in', '+15551110102', '+15125550101', 'CA-smoke315-4', 'completed',
   '31500000-0000-0000-0000-0000000000d1');

-- One recording per call. twilio_recording_sid carries the matrix label so the
-- assertions can string_agg the visible set (mirrors migration-313's transcript).
insert into public.phone_recordings
  (id, organization_id, phone_call_id, twilio_recording_sid, duration_seconds)
values
  ('31500000-0000-0000-0000-000000000091', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000f1', 'shared-untagged', 30),
  ('31500000-0000-0000-0000-000000000092', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000f2', 'shared-tagged', 30),
  ('31500000-0000-0000-0000-000000000093', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000f3', 'personal-untagged', 30),
  ('31500000-0000-0000-0000-000000000094', '31500000-0000-0000-0000-000000000001',
   '31500000-0000-0000-0000-0000000000f4', 'personal-tagged', 30);

-- ---------------------------------------------------------------------------
-- 1. User A (admin, org-1) — sees Shared-untagged, Shared-tagged,
--    Personal-tagged (Job-visible), but NOT Personal-untagged (admin cannot
--    read untagged Personal content per ADR 0005).
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_ids text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31500000-0000-0000-0000-000000000010","active_organization_id":"31500000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(twilio_recording_sid, ',' order by twilio_recording_sid)
    into v_count, v_ids
    from public.phone_recordings;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-315 smoke (case 1: admin): expected 3 visible recordings, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-315 smoke (case 1: admin): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-315 smoke (case 1: admin) — sees Shared+Personal-tagged, not Personal-untagged';
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
    '{"sub":"31500000-0000-0000-0000-000000000011","active_organization_id":"31500000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(twilio_recording_sid, ',' order by twilio_recording_sid)
    into v_count, v_ids
    from public.phone_recordings;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-315 smoke (case 2: crew_lead non-owner): expected 3 visible recordings, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-315 smoke (case 2: crew_lead non-owner): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-315 smoke (case 2: crew_lead non-owner) — sees Shared+Personal-tagged, not Personal-untagged';
end $$;

-- ---------------------------------------------------------------------------
-- 3. User C (crew_lead, org-1, OWNER of Personal +15125550101) — sees all 4.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31500000-0000-0000-0000-000000000012","active_organization_id":"31500000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_count from public.phone_recordings;

  reset role;

  if v_count <> 4 then
    raise exception 'migration-315 smoke (case 3: Personal owner): expected 4 visible recordings, got %', v_count;
  end if;
  raise notice 'migration-315 smoke (case 3: Personal owner) — sees all 4 of own + Shared rows';
end $$;

-- ---------------------------------------------------------------------------
-- 4. User D (admin, org-2) — cross-org. Should see 0 recordings.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31500000-0000-0000-0000-000000000013","active_organization_id":"31500000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_count from public.phone_recordings;

  reset role;

  if v_count <> 0 then
    raise exception 'migration-315 smoke (case 4: cross-org admin): expected 0 visible recordings, got %', v_count;
  end if;
  raise notice 'migration-315 smoke (case 4: cross-org admin) — sees nothing';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Done.
-- ---------------------------------------------------------------------------
rollback;

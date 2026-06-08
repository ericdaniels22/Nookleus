-- issue #313 (PRD #304, ADR 0005) — phone_voicemails access-matrix smoke
-- test.
--
-- Purpose:   Verify that the migration-313 phone_voicemails RLS policy
--            encodes every cell of the ADR 0005 read-path matrix at the
--            database — reached through the PARENT call — in the SAME shape
--            migration-312-smoke-test.sql pins for phone_calls. A voicemail
--            is visible exactly when its parent call is, so the matrix is
--            identical; the seed hangs one voicemail off each of the four
--            matrix-covering calls and asserts the same visible sets.
--
--            Matrix exercised (phone_voicemails SELECT, via parent call):
--              - Shared untagged          → every same-org member sees
--              - Shared Job-tagged        → every same-org member sees
--              - Personal untagged, owner → owner sees
--              - Personal untagged, other → hidden (incl. admin)
--              - Personal Job-tagged, any → sees (Job-visible team)
--              - Cross-org caller         → never sees
--
-- Shape:     One transaction, rolled back at the end. Service-role seeds two
--            orgs, four users, two phone_numbers (Shared + Personal), two
--            conversations, one Job, four phone_calls covering the matrix,
--            and one phone_voicemail per call. Each assertion block sets the
--            JWT claims, switches to `authenticated`, runs a SELECT, and
--            asserts the row-count + (where it discriminates) the visible
--            set via string_agg over the voicemail transcript label.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass for orgs / users / memberships.
--      Org 1: smoke-313-org-1
--        User A — admin
--        User B — crew_lead (non-owner of any Personal number)
--        User C — crew_lead (owner of the Personal number)
--      Org 2: smoke-313-org-2
--        User D — admin
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('31300000-0000-0000-0000-000000000001', 'smoke-313-org-1', 'smoke-313-org-1'),
  ('31300000-0000-0000-0000-000000000002', 'smoke-313-org-2', 'smoke-313-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('31300000-0000-0000-0000-000000000010', 'smoke-313-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31300000-0000-0000-0000-000000000011', 'smoke-313-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31300000-0000-0000-0000-000000000012', 'smoke-313-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('31300000-0000-0000-0000-000000000013', 'smoke-313-d@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('31300000-0000-0000-0000-000000000010', '31300000-0000-0000-0000-000000000001', 'admin'),
  ('31300000-0000-0000-0000-000000000011', '31300000-0000-0000-0000-000000000001', 'crew_lead'),
  ('31300000-0000-0000-0000-000000000012', '31300000-0000-0000-0000-000000000001', 'crew_lead'),
  ('31300000-0000-0000-0000-000000000013', '31300000-0000-0000-0000-000000000002', 'admin');

-- Two phone numbers in org-1: one Shared, one Personal owned by User C.
insert into public.phone_numbers
  (id, organization_id, twilio_sid, e164, kind, user_id)
values
  ('31300000-0000-0000-0000-0000000000a1', '31300000-0000-0000-0000-000000000001',
   'PN-smoke313-shared', '+15125550100', 'shared', null),
  ('31300000-0000-0000-0000-0000000000a2', '31300000-0000-0000-0000-000000000001',
   'PN-smoke313-personal', '+15125550101', 'personal',
   '31300000-0000-0000-0000-000000000012');

-- Two conversations — one on each number.
insert into public.phone_conversations
  (id, organization_id, phone_number_id, outside_e164)
values
  ('31300000-0000-0000-0000-0000000000b1', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000a1', '+15551110101'),
  ('31300000-0000-0000-0000-0000000000b2', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000a2', '+15551110102');

-- One Job in org-1 for the Job-tagged cases. Contact is a placeholder.
insert into public.contacts (id, organization_id, full_name)
values ('31300000-0000-0000-0000-0000000000c1',
        '31300000-0000-0000-0000-000000000001', 'smoke-313-contact');

insert into public.jobs
  (id, organization_id, contact_id, damage_type, property_address)
values
  ('31300000-0000-0000-0000-0000000000d1', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000c1', 'water', '1 smoke st');

-- Four calls cover the matrix.
--   call1: Shared, untagged
--   call2: Shared, tagged (job d1)
--   call3: Personal (owner C), untagged
--   call4: Personal (owner C), tagged (job d1)
insert into public.phone_calls
  (id, organization_id, conversation_id, direction, from_e164, to_e164, twilio_call_sid, status, job_tag)
values
  ('31300000-0000-0000-0000-0000000000f1', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000b1', 'in', '+15551110101', '+15125550100', 'CA-smoke313-1', 'no_answer', null),
  ('31300000-0000-0000-0000-0000000000f2', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000b1', 'in', '+15551110101', '+15125550100', 'CA-smoke313-2', 'no_answer',
   '31300000-0000-0000-0000-0000000000d1'),
  ('31300000-0000-0000-0000-0000000000f3', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000b2', 'in', '+15551110102', '+15125550101', 'CA-smoke313-3', 'no_answer', null),
  ('31300000-0000-0000-0000-0000000000f4', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000b2', 'in', '+15551110102', '+15125550101', 'CA-smoke313-4', 'no_answer',
   '31300000-0000-0000-0000-0000000000d1');

-- One voicemail per call. `transcript` carries the matrix label so the
-- assertions can string_agg the visible set (mirrors phone_calls.twilio_call_sid).
insert into public.phone_voicemails
  (id, organization_id, phone_call_id, twilio_recording_sid, transcript, transcript_status)
values
  ('31300000-0000-0000-0000-000000000091', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000f1', 'RE-smoke313-1', 'shared-untagged', 'ready'),
  ('31300000-0000-0000-0000-000000000092', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000f2', 'RE-smoke313-2', 'shared-tagged', 'ready'),
  ('31300000-0000-0000-0000-000000000093', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000f3', 'RE-smoke313-3', 'personal-untagged', 'ready'),
  ('31300000-0000-0000-0000-000000000094', '31300000-0000-0000-0000-000000000001',
   '31300000-0000-0000-0000-0000000000f4', 'RE-smoke313-4', 'personal-tagged', 'ready');

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
    '{"sub":"31300000-0000-0000-0000-000000000010","active_organization_id":"31300000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(transcript, ',' order by transcript)
    into v_count, v_ids
    from public.phone_voicemails;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-313 smoke (case 1: admin): expected 3 visible voicemails, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-313 smoke (case 1: admin): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-313 smoke (case 1: admin) — sees Shared+Personal-tagged, not Personal-untagged';
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
    '{"sub":"31300000-0000-0000-0000-000000000011","active_organization_id":"31300000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(transcript, ',' order by transcript)
    into v_count, v_ids
    from public.phone_voicemails;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-313 smoke (case 2: crew_lead non-owner): expected 3 visible voicemails, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-313 smoke (case 2: crew_lead non-owner): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-313 smoke (case 2: crew_lead non-owner) — sees Shared+Personal-tagged, not Personal-untagged';
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
    '{"sub":"31300000-0000-0000-0000-000000000012","active_organization_id":"31300000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_count from public.phone_voicemails;

  reset role;

  if v_count <> 4 then
    raise exception 'migration-313 smoke (case 3: Personal owner): expected 4 visible voicemails, got %', v_count;
  end if;
  raise notice 'migration-313 smoke (case 3: Personal owner) — sees all 4 of own + Shared rows';
end $$;

-- ---------------------------------------------------------------------------
-- 4. User D (admin, org-2) — cross-org. Should see 0 voicemails.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"31300000-0000-0000-0000-000000000013","active_organization_id":"31300000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_count from public.phone_voicemails;

  reset role;

  if v_count <> 0 then
    raise exception 'migration-313 smoke (case 4: cross-org admin): expected 0 visible voicemails, got %', v_count;
  end if;
  raise notice 'migration-313 smoke (case 4: cross-org admin) — sees nothing';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Done.
-- ---------------------------------------------------------------------------
rollback;

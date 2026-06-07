-- issue #308 (PRD #304, ADR 0003) — phone_conversations + phone_messages
-- access-matrix smoke test.
--
-- Purpose:   Verify that the migration-308 RLS policies encode every cell
--            of the ADR 0003 read-path matrix at the database. The
--            phone-event-access TypeScript module has the same matrix in
--            code; the two are kept in sync by this script's cases
--            mirroring src/lib/phone/phone-event-access.test.ts's
--            canRead suite.
--
--            Matrix exercised (phone_messages SELECT):
--              - Shared untagged          → every same-org member sees
--              - Shared Job-tagged        → every same-org member sees
--              - Personal untagged, owner → owner sees
--              - Personal untagged, other → hidden
--              - Personal Job-tagged, owner → owner sees
--              - Personal Job-tagged, other → sees (Job-visible team)
--              - Cross-org caller         → never sees
--
-- Shape:     One transaction, rolled back at the end. Service-role seeds
--            two orgs, three users, two phone_numbers (Shared + Personal),
--            two conversations, six messages covering the matrix. Each
--            assertion block sets the JWT claims, switches to
--            `authenticated`, runs a SELECT, and asserts the row-count
--            against expected.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass for orgs / users / memberships.
--      Org 1: smoke-308-org-1
--        User A — admin
--        User B — crew_lead (non-owner of any Personal number)
--        User C — crew_lead (owner of the Personal number)
--      Org 2: smoke-308-org-2
--        User D — admin
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('a8000000-0000-0000-0000-000000000001', 'smoke-308-org-1', 'smoke-308-org-1'),
  ('a8000000-0000-0000-0000-000000000002', 'smoke-308-org-2', 'smoke-308-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('a8000000-0000-0000-0000-000000000010', 'smoke-308-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a8000000-0000-0000-0000-000000000011', 'smoke-308-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a8000000-0000-0000-0000-000000000012', 'smoke-308-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a8000000-0000-0000-0000-000000000013', 'smoke-308-d@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('a8000000-0000-0000-0000-000000000010', 'a8000000-0000-0000-0000-000000000001', 'admin'),
  ('a8000000-0000-0000-0000-000000000011', 'a8000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('a8000000-0000-0000-0000-000000000012', 'a8000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('a8000000-0000-0000-0000-000000000013', 'a8000000-0000-0000-0000-000000000002', 'admin');

-- Two phone numbers in org-1: one Shared, one Personal owned by User C.
insert into public.phone_numbers
  (id, organization_id, twilio_sid, e164, kind, user_id)
values
  ('a8000000-0000-0000-0000-0000000000a1', 'a8000000-0000-0000-0000-000000000001',
   'PN-smoke-shared', '+15125550000', 'shared', null),
  ('a8000000-0000-0000-0000-0000000000a2', 'a8000000-0000-0000-0000-000000000001',
   'PN-smoke-personal', '+15125550001', 'personal',
   'a8000000-0000-0000-0000-000000000012');

-- Two conversations — one on each number.
insert into public.phone_conversations
  (id, organization_id, phone_number_id, outside_e164)
values
  ('a8000000-0000-0000-0000-0000000000b1', 'a8000000-0000-0000-0000-000000000001',
   'a8000000-0000-0000-0000-0000000000a1', '+15551110001'),
  ('a8000000-0000-0000-0000-0000000000b2', 'a8000000-0000-0000-0000-000000000001',
   'a8000000-0000-0000-0000-0000000000a2', '+15551110002');

-- One Job in org-1 for the Job-tagged cases. Contact is a placeholder.
insert into public.contacts (id, organization_id, full_name)
values ('a8000000-0000-0000-0000-0000000000c1',
        'a8000000-0000-0000-0000-000000000001', 'smoke-308-contact');

insert into public.jobs
  (id, organization_id, contact_id, damage_type, property_address)
values
  ('a8000000-0000-0000-0000-0000000000d1', 'a8000000-0000-0000-0000-000000000001',
   'a8000000-0000-0000-0000-0000000000c1', 'water', '1 smoke st');

-- Six messages cover the matrix.
--   m1: Shared, untagged
--   m2: Shared, tagged (job d1)
--   m3: Personal (owner C), untagged
--   m4: Personal (owner C), tagged (job d1)
--   m5: Personal (owner C), untagged — duplicate of m3 for the "other user"
--       cases (kept separate so a single failure does not cascade)
--   m6: Personal (owner C), tagged — duplicate of m4 for symmetry
insert into public.phone_messages
  (id, organization_id, conversation_id, direction, from_e164, to_e164, body, job_tag)
values
  ('a8000000-0000-0000-0000-0000000000e1', 'a8000000-0000-0000-0000-000000000001',
   'a8000000-0000-0000-0000-0000000000b1', 'in', '+15551110001', '+15125550000', 'shared-untagged', null),
  ('a8000000-0000-0000-0000-0000000000e2', 'a8000000-0000-0000-0000-000000000001',
   'a8000000-0000-0000-0000-0000000000b1', 'in', '+15551110001', '+15125550000', 'shared-tagged',
   'a8000000-0000-0000-0000-0000000000d1'),
  ('a8000000-0000-0000-0000-0000000000e3', 'a8000000-0000-0000-0000-000000000001',
   'a8000000-0000-0000-0000-0000000000b2', 'in', '+15551110002', '+15125550001', 'personal-untagged', null),
  ('a8000000-0000-0000-0000-0000000000e4', 'a8000000-0000-0000-0000-000000000001',
   'a8000000-0000-0000-0000-0000000000b2', 'in', '+15551110002', '+15125550001', 'personal-tagged',
   'a8000000-0000-0000-0000-0000000000d1');

-- ---------------------------------------------------------------------------
-- 1. User A (admin, org-1) — should see Shared-untagged, Shared-tagged,
--    Personal-tagged (Job-visible), but NOT Personal-untagged (admin
--    cannot read untagged Personal content per ADR 0003).
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_ids text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a8000000-0000-0000-0000-000000000010","active_organization_id":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(body, ',' order by body)
    into v_count, v_ids
    from public.phone_messages;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-308 smoke (case 1: admin): expected 3 visible messages, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-308 smoke (case 1: admin): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-308 smoke (case 1: admin) — admin sees Shared+Personal-tagged, not Personal-untagged';
end $$;

-- ---------------------------------------------------------------------------
-- 2. User B (crew_lead, org-1, NOT owner of any Personal number) — should
--    see Shared-untagged, Shared-tagged, Personal-tagged (Job-visible),
--    but NOT Personal-untagged.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_ids text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a8000000-0000-0000-0000-000000000011","active_organization_id":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(body, ',' order by body)
    into v_count, v_ids
    from public.phone_messages;

  reset role;

  if v_count <> 3 then
    raise exception 'migration-308 smoke (case 2: crew_lead non-owner): expected 3 visible messages, got % (%)', v_count, v_ids;
  end if;
  if v_ids <> 'personal-tagged,shared-tagged,shared-untagged' then
    raise exception 'migration-308 smoke (case 2: crew_lead non-owner): wrong rows visible — got %', v_ids;
  end if;
  raise notice 'migration-308 smoke (case 2: crew_lead non-owner) — sees Shared+Personal-tagged, not Personal-untagged';
end $$;

-- ---------------------------------------------------------------------------
-- 3. User C (crew_lead, org-1, OWNER of Personal +15125550001) — should
--    see all 4 messages.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a8000000-0000-0000-0000-000000000012","active_organization_id":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_count from public.phone_messages;

  reset role;

  if v_count <> 4 then
    raise exception 'migration-308 smoke (case 3: Personal owner): expected 4 visible messages, got %', v_count;
  end if;
  raise notice 'migration-308 smoke (case 3: Personal owner) — sees all 4 of own + Shared rows';
end $$;

-- ---------------------------------------------------------------------------
-- 4. User D (admin, org-2) — cross-org. Should see 0 messages.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a8000000-0000-0000-0000-000000000013","active_organization_id":"a8000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_count from public.phone_messages;

  reset role;

  if v_count <> 0 then
    raise exception 'migration-308 smoke (case 4: cross-org admin): expected 0 visible messages, got %', v_count;
  end if;
  raise notice 'migration-308 smoke (case 4: cross-org admin) — sees nothing';
end $$;

-- ---------------------------------------------------------------------------
-- 5. phone_conversations: User B (non-owner) should see only the Shared
--    conversation, NOT the Personal one (untagged content branch). User C
--    (owner) should see both. User D (cross-org) should see none.
-- ---------------------------------------------------------------------------
do $$
declare
  v_b int;
  v_c int;
  v_d int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a8000000-0000-0000-0000-000000000011","active_organization_id":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) into v_b from public.phone_conversations;
  reset role;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a8000000-0000-0000-0000-000000000012","active_organization_id":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) into v_c from public.phone_conversations;
  reset role;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a8000000-0000-0000-0000-000000000013","active_organization_id":"a8000000-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) into v_d from public.phone_conversations;
  reset role;

  if v_b <> 1 then
    raise exception 'migration-308 smoke (case 5b: B): expected 1 conversation, got %', v_b;
  end if;
  if v_c <> 2 then
    raise exception 'migration-308 smoke (case 5c: C owner): expected 2 conversations, got %', v_c;
  end if;
  if v_d <> 0 then
    raise exception 'migration-308 smoke (case 5d: cross-org D): expected 0 conversations, got %', v_d;
  end if;
  raise notice 'migration-308 smoke (case 5) — phone_conversations RLS pins Shared vs Personal-owner vs cross-org';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Done.
-- ---------------------------------------------------------------------------
rollback;

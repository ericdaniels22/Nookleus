-- issue #311 (PRD #304, ADR 0005) — Job-page Messages (N) section RLS smoke.
--
-- Purpose:   Slice 7 adds NO schema or RLS migration — the Job Messages
--            section reads through GET /api/phone/messages?jobId=, which
--            runs `select … from phone_messages where job_tag = :jobId`
--            on the User client (RLS). This smoke pins that the EXISTING
--            migration-308 phone_messages_select policy makes that exact
--            query return the right rows for the slice-7 acceptance case:
--
--              "a Job-tagged message on a Personal number appears for any
--               teammate who can see the Job"
--
--            migration-308-smoke covers the full ADR-0005 matrix cell-by
--            -cell; this script is narrower and query-shaped: it filters by
--            job_tag exactly as the route does and asserts the section sees
--            every Job-tagged message ACROSS numbers (Shared + Personal),
--            for a NON-owner teammate — the scenario the section depends on
--            but cannot itself prove (the section's own tests mock the
--            route; only the database enforces cross-number visibility).
--
--            NOTE: view_phone is a route-wrapper gate (withRequestContext),
--            not an RLS predicate — so it is intentionally NOT modelled
--            here. This script verifies only the row-level visibility the
--            route's user-client SELECT is subject to.
--
-- Shape:     One transaction, rolled back at the end. Service-role seeds
--            one org (+ a cross-org), three users, a Shared and a Personal
--            number, a conversation on each, two Jobs, and four messages.
--            Each assertion sets JWT claims, switches to `authenticated`,
--            runs the route's job_tag-filtered SELECT, and asserts.
--
-- Run:       Read-only — via Supabase MCP `execute_sql` against any project
--            that has the phone schema. BEGIN/ROLLBACK, no migration, no
--            committed writes.
--
-- Status (2026-06-07): NOT YET RUNNABLE against prod (rzzprgidqbnqcdupmpfe).
--            The phone core schema is staged but undeployed there — only
--            migration-306 (view_phone) and migration-309 (phone_opt_outs)
--            are applied; migration-307 (phone_numbers) and migration-308
--            (phone_conversations/phone_messages, + the RLS this exercises)
--            are not. Run this once 307+308 land on the target project. The
--            RLS contract itself is already proven by migration-308-smoke
--            -test.sql case 2 (a crew_lead non-owner sees a Personal-number
--            Job-tagged message, not an untagged one) — slice 7 adds NO new
--            policy, so this script only re-pins it through the section's
--            exact job_tag-filtered query shape.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed.
--      Org 1: smoke-311-org-1
--        User A — admin, OWNER of the Personal number
--        User B — crew_lead, NON-owner teammate (the "can see the Job" case)
--      Org 2: smoke-311-org-2
--        User D — admin (cross-org)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('a9000000-0000-0000-0000-000000000001', 'smoke-311-org-1', 'smoke-311-org-1'),
  ('a9000000-0000-0000-0000-000000000002', 'smoke-311-org-2', 'smoke-311-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('a9000000-0000-0000-0000-000000000010', 'smoke-311-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a9000000-0000-0000-0000-000000000011', 'smoke-311-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a9000000-0000-0000-0000-000000000013', 'smoke-311-d@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('a9000000-0000-0000-0000-000000000010', 'a9000000-0000-0000-0000-000000000001', 'admin'),
  ('a9000000-0000-0000-0000-000000000011', 'a9000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('a9000000-0000-0000-0000-000000000013', 'a9000000-0000-0000-0000-000000000002', 'admin');

-- A Shared number and a Personal number owned by User A.
insert into public.phone_numbers
  (id, organization_id, twilio_sid, e164, kind, user_id)
values
  ('a9000000-0000-0000-0000-0000000000a1', 'a9000000-0000-0000-0000-000000000001',
   'PN-smoke311-shared', '+15125550100', 'shared', null),
  ('a9000000-0000-0000-0000-0000000000a2', 'a9000000-0000-0000-0000-000000000001',
   'PN-smoke311-personal', '+15125550101', 'personal',
   'a9000000-0000-0000-0000-000000000010');

-- One conversation on each number.
insert into public.phone_conversations
  (id, organization_id, phone_number_id, outside_e164)
values
  ('a9000000-0000-0000-0000-0000000000b1', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000a1', '+15551110101'),
  ('a9000000-0000-0000-0000-0000000000b2', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000a2', '+15551110102');

-- Two Jobs: d1 is "this job" (the section's jobId); d2 is a decoy.
insert into public.contacts (id, full_name)
values ('a9000000-0000-0000-0000-0000000000c1', 'smoke-311-contact');

insert into public.jobs
  (id, organization_id, contact_id, damage_type, property_address)
values
  ('a9000000-0000-0000-0000-0000000000d1', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000c1', 'water', '1 smoke st'),
  ('a9000000-0000-0000-0000-0000000000d2', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000c1', 'water', '2 smoke st');

-- Four messages:
--   m1: Shared,   tagged d1  → in the section
--   m2: Personal, tagged d1  → in the section (the headline case: Personal,
--                              owned by A, must surface for non-owner B)
--   m3: Personal, untagged   → NOT in the section (no job_tag) and owner-only
--   m4: Shared,   tagged d2  → NOT in the section (different Job)
insert into public.phone_messages
  (id, organization_id, conversation_id, direction, from_e164, to_e164, body, job_tag)
values
  ('a9000000-0000-0000-0000-0000000000e1', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000b1', 'in', '+15551110101', '+15125550100', 'shared-job1',
   'a9000000-0000-0000-0000-0000000000d1'),
  ('a9000000-0000-0000-0000-0000000000e2', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000b2', 'in', '+15551110102', '+15125550101', 'personal-job1',
   'a9000000-0000-0000-0000-0000000000d1'),
  ('a9000000-0000-0000-0000-0000000000e3', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000b2', 'in', '+15551110102', '+15125550101', 'personal-untagged', null),
  ('a9000000-0000-0000-0000-0000000000e4', 'a9000000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000b1', 'in', '+15551110101', '+15125550100', 'shared-job2',
   'a9000000-0000-0000-0000-0000000000d2');

-- ---------------------------------------------------------------------------
-- 1. The headline case. User B (crew_lead, NON-owner of the Personal
--    number) runs the section's query — `where job_tag = d1` — and must see
--    BOTH the Shared and the Personal Job-tagged messages, and ONLY those.
--    The Personal message is owned by A; B sees it solely because it is
--    tagged to a Job B can see.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_bodies text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a9000000-0000-0000-0000-000000000011","active_organization_id":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), string_agg(body, ',' order by body)
    into v_count, v_bodies
    from public.phone_messages
   where job_tag = 'a9000000-0000-0000-0000-0000000000d1';

  reset role;

  if v_count <> 2 then
    raise exception 'migration-311 smoke (case 1: non-owner teammate): expected 2 Job-tagged messages, got % (%)', v_count, v_bodies;
  end if;
  if v_bodies <> 'personal-job1,shared-job1' then
    raise exception 'migration-311 smoke (case 1: non-owner teammate): wrong rows — expected personal-job1,shared-job1 got %', v_bodies;
  end if;
  raise notice 'migration-311 smoke (case 1) — non-owner teammate sees the Job''s messages across Shared + Personal numbers';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sanity: User A (owner of the Personal number) sees the same two
--    Job-tagged messages via the section's query.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a9000000-0000-0000-0000-000000000010","active_organization_id":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_count
    from public.phone_messages
   where job_tag = 'a9000000-0000-0000-0000-0000000000d1';

  reset role;

  if v_count <> 2 then
    raise exception 'migration-311 smoke (case 2: Personal owner): expected 2 Job-tagged messages, got %', v_count;
  end if;
  raise notice 'migration-311 smoke (case 2) — Personal-number owner sees the same Job-tagged set';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cross-org: User D (admin, org-2) runs the same query and sees nothing —
--    org isolation holds even when filtering by another org's job_tag.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"a9000000-0000-0000-0000-000000000013","active_organization_id":"a9000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_count
    from public.phone_messages
   where job_tag = 'a9000000-0000-0000-0000-0000000000d1';

  reset role;

  if v_count <> 0 then
    raise exception 'migration-311 smoke (case 3: cross-org): expected 0 Job-tagged messages, got %', v_count;
  end if;
  raise notice 'migration-311 smoke (case 3) — cross-org caller sees none of the Job''s messages';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Done — nothing committed.
-- ---------------------------------------------------------------------------
rollback;

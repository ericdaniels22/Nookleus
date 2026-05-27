-- issue #307 (PRD #304, ADR 0003) — phone_numbers RLS smoke test.
--
-- Purpose:   Verify that migration-307 produced the expected post-state.
--            Pins the AC bullet "admin in org A cannot see numbers in org B
--            (covered by an RLS smoke-test SQL script in the spirit of
--            `supabase/migration-186-smoke-test.sql`)" and the surrounding
--            admin-only Shared INSERT cell from ADR 0003 § Permission.
--
-- Shape:     One transaction, rolled back at the end. Seeds 2 orgs + 3
--            users (admin org1, crew_lead org1, admin org2) under
--            service-role bypass, then walks the kind-CHECK and the RLS
--            matrix under `role authenticated`:
--              kind CHECK — Shared with user_id NOT NULL → rejected;
--                           Personal with user_id NULL → rejected.
--              INSERT     — admin org1 inserts Shared in own org → allowed;
--                           crew_lead org1 inserts Shared → denied;
--                           crew_lead org1 inserts Personal-self → allowed;
--                           crew_lead org1 inserts Personal-other → denied;
--                           admin org2 inserts in org1 → denied (cross-org).
--              SELECT     — admin org1 sees Shared(org1) + own Personal
--                           only; not Personal-of-other in same org, not
--                           anything in org2.
--                           admin org2 sees only its own Personal.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project.
--            Once applied to prod, this script remains as the documented
--            test of the policy. Not run by CI.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass for orgs / users / memberships. Fixed UUIDs
--    so assertions can name them. The prefix `42` keeps these IDs distinct
--    from migration-140's `40` and migration-222's `41` seeds.
--      Org 1: smoke-307-org-1
--        User A — admin
--        User B — crew_lead
--      Org 2: smoke-307-org-2
--        User C — admin
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('42000000-0000-0000-0000-000000000001', 'smoke-307-org-1', 'smoke-307-org-1'),
  ('42000000-0000-0000-0000-000000000002', 'smoke-307-org-2', 'smoke-307-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('42000000-0000-0000-0000-000000000010', 'smoke-307-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('42000000-0000-0000-0000-000000000011', 'smoke-307-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('42000000-0000-0000-0000-000000000012', 'smoke-307-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('42000000-0000-0000-0000-000000000010', '42000000-0000-0000-0000-000000000001', 'admin'),
  ('42000000-0000-0000-0000-000000000011', '42000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('42000000-0000-0000-0000-000000000012', '42000000-0000-0000-0000-000000000002', 'admin');

-- ---------------------------------------------------------------------------
-- 1. kind-CHECK assertions (service-role bypass; no RLS in this section).
--    A Shared row with user_id set, or a Personal row missing user_id, must
--    be rejected at the constraint layer regardless of who is inserting.
-- ---------------------------------------------------------------------------

-- kind-CHECK case A: Shared with user_id NOT NULL → CHECK violation.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.phone_numbers
      (id, organization_id, twilio_sid, e164, kind, user_id)
    values
      ('42000000-0000-0000-0000-000000000200', '42000000-0000-0000-0000-000000000001',
       'PN-bad-shared', '+15550000200', 'shared',
       '42000000-0000-0000-0000-000000000010');
  exception
    when check_violation then v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'migration-307 smoke (kind-CHECK A): Shared row with user_id should be rejected by CHECK, but it was accepted';
  end if;
  raise notice 'migration-307 smoke (kind-CHECK A): Shared+user_id correctly rejected';
end $$;

-- kind-CHECK case B: Personal with user_id NULL → CHECK violation.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.phone_numbers
      (id, organization_id, twilio_sid, e164, kind, user_id)
    values
      ('42000000-0000-0000-0000-000000000201', '42000000-0000-0000-0000-000000000001',
       'PN-bad-personal', '+15550000201', 'personal', null);
  exception
    when check_violation then v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'migration-307 smoke (kind-CHECK B): Personal row without user_id should be rejected by CHECK, but it was accepted';
  end if;
  raise notice 'migration-307 smoke (kind-CHECK B): Personal-without-owner correctly rejected';
end $$;

-- ---------------------------------------------------------------------------
-- 2. INSERT RLS — five cases of the admin-only Shared / owner-only Personal
--    matrix. Each block sets request.jwt.claims, switches to the
--    authenticated role, attempts an INSERT, catches RLS denial as
--    insufficient_privilege (SQLSTATE 42501), then resets role and asserts
--    the expected outcome.
-- ---------------------------------------------------------------------------

-- Case 1: admin User A in org1 inserts Shared in own org → allowed.
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000010","active_organization_id":"42000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.phone_numbers
      (id, organization_id, twilio_sid, e164, kind, user_id, label, monthly_cost_cents)
    values
      ('42000000-0000-0000-0000-000000000101', '42000000-0000-0000-0000-000000000001',
       'PN-shared-a', '+15550000101', 'shared', null, 'admin shared', 115);
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if v_blocked then
    raise exception 'migration-307 smoke (case 1): admin INSERT of Shared row should be allowed, but RLS blocked it';
  end if;
  raise notice 'migration-307 smoke (case 1): admin Shared INSERT correctly allowed';
end $$;

-- Case 2 — TRACER BULLET. Non-admin (crew_lead User B in org1) attempts to
-- insert a Shared row in own org → denied (admin-only Shared INSERT).
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000011","active_organization_id":"42000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.phone_numbers
      (id, organization_id, twilio_sid, e164, kind, user_id)
    values
      ('42000000-0000-0000-0000-000000000102', '42000000-0000-0000-0000-000000000001',
       'PN-shared-b-attempt', '+15550000102', 'shared', null);
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if not v_blocked then
    raise exception 'migration-307 smoke (case 2): non-admin INSERT of Shared row should have been blocked by RLS, but it succeeded';
  end if;
  raise notice 'migration-307 smoke (case 2): non-admin Shared INSERT correctly denied';
end $$;

-- Case 3: non-admin User B inserts Personal owned by themselves → allowed.
-- Personal numbers don't land via slice 3 UI, but the policy must already
-- support the slice-13 path so the matrix is complete from day one.
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000011","active_organization_id":"42000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.phone_numbers
      (id, organization_id, twilio_sid, e164, kind, user_id)
    values
      ('42000000-0000-0000-0000-000000000103', '42000000-0000-0000-0000-000000000001',
       'PN-personal-b-self', '+15550000103', 'personal',
       '42000000-0000-0000-0000-000000000011');
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if v_blocked then
    raise exception 'migration-307 smoke (case 3): non-admin INSERT of Personal-owned-by-self should be allowed, but RLS blocked it';
  end if;
  raise notice 'migration-307 smoke (case 3): non-admin Personal-self INSERT correctly allowed';
end $$;

-- Case 4: non-admin User B inserts Personal owned by ANOTHER user → denied.
-- Neither branch of WITH CHECK passes: User B isn't an admin (Shared branch
-- fails) and user_id != auth.uid() (Personal branch fails).
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000011","active_organization_id":"42000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.phone_numbers
      (id, organization_id, twilio_sid, e164, kind, user_id)
    values
      ('42000000-0000-0000-0000-000000000104', '42000000-0000-0000-0000-000000000001',
       'PN-personal-other', '+15550000104', 'personal',
       '42000000-0000-0000-0000-000000000010');
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if not v_blocked then
    raise exception 'migration-307 smoke (case 4): non-admin INSERT of Personal-owned-by-other should have been blocked by RLS, but it succeeded';
  end if;
  raise notice 'migration-307 smoke (case 4): non-admin Personal-other INSERT correctly denied';
end $$;

-- Case 5: cross-Organization caller. User C is admin of org2; the JWT
-- claims active_organization_id = org2; but the proposed row has
-- organization_id = org1. WITH CHECK requires organization_id =
-- nookleus.active_organization_id(), so the mismatch causes denial
-- regardless of role.
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000012","active_organization_id":"42000000-0000-0000-0000-000000000002","role":"authenticated"}';

  begin
    insert into public.phone_numbers
      (id, organization_id, twilio_sid, e164, kind, user_id)
    values
      ('42000000-0000-0000-0000-000000000105', '42000000-0000-0000-0000-000000000001',
       'PN-cross-org', '+15550000105', 'shared', null);
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if not v_blocked then
    raise exception 'migration-307 smoke (case 5): cross-org admin INSERT into another org should have been blocked, but it succeeded';
  end if;
  raise notice 'migration-307 smoke (case 5): cross-org admin INSERT correctly denied';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Seed two additional rows under service-role bypass to exercise SELECT
--    RLS in section 4: a Personal-by-B in org1 and a Personal-by-C in org2.
--    The Shared-org1 row already exists from case 1; cases 2/4/5 were
--    denied (no residue); case 3 inserted Personal-by-B in org1.
-- ---------------------------------------------------------------------------
insert into public.phone_numbers
  (id, organization_id, twilio_sid, e164, kind, user_id, label, monthly_cost_cents)
values
  ('42000000-0000-0000-0000-000000000106', '42000000-0000-0000-0000-000000000002',
   'PN-personal-c', '+15550000106', 'personal',
   '42000000-0000-0000-0000-000000000012', 'C personal', 115);

-- ---------------------------------------------------------------------------
-- 4. SELECT RLS — admin in org A cannot see numbers in org B (the AC
--    bullet's exact wording), and Personal-of-other in same org is hidden.
-- ---------------------------------------------------------------------------

-- 4a. As admin User A (org1): sees Shared-org1 (..101); does NOT see
--     Personal-by-B in same org (..103) or Personal-by-C in org2 (..106).
--     The "admin cannot read another user's Personal mailbox" rule from
--     ADR 0003 holds at the User-client RLS layer.
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000010","active_organization_id":"42000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), array_agg(id order by id)
    into v_count, v_ids
    from public.phone_numbers;

  reset role;

  if v_count <> 1 then
    raise exception 'migration-307 smoke (4a): admin A expected to see 1 row (Shared-org1), got % — ids=%', v_count, v_ids;
  end if;
  if v_ids[1] <> '42000000-0000-0000-0000-000000000101'::uuid then
    raise exception 'migration-307 smoke (4a): admin A row id wrong — expected Shared (..101), got %', v_ids;
  end if;
  raise notice 'migration-307 smoke (4a): admin A correctly sees only Shared-org1';
end $$;

-- 4b. As crew_lead User B (org1): sees Shared-org1 (..101) + own Personal
--     (..103). Confirms the Shared branch shows up for non-admins too.
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000011","active_organization_id":"42000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), array_agg(id order by id)
    into v_count, v_ids
    from public.phone_numbers;

  reset role;

  if v_count <> 2 then
    raise exception 'migration-307 smoke (4b): crew_lead B expected to see 2 rows (Shared + own Personal), got % — ids=%', v_count, v_ids;
  end if;
  if not (v_ids @> array['42000000-0000-0000-0000-000000000101'::uuid, '42000000-0000-0000-0000-000000000103'::uuid]) then
    raise exception 'migration-307 smoke (4b): crew_lead B row ids wrong — expected Shared (..101) + Personal-B (..103), got %', v_ids;
  end if;
  raise notice 'migration-307 smoke (4b): crew_lead B correctly sees Shared + own Personal';
end $$;

-- 4c. As admin User C (org2): sees only own Personal (..106) in own org.
--     This is the AC bullet's exact "admin in org A cannot see numbers in
--     org B" case viewed from the other side — org1 is invisible to C.
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"42000000-0000-0000-0000-000000000012","active_organization_id":"42000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*), array_agg(id order by id)
    into v_count, v_ids
    from public.phone_numbers;

  reset role;

  if v_count <> 1 then
    raise exception 'migration-307 smoke (4c): admin C (org2) expected to see only Personal-C, got % — ids=%', v_count, v_ids;
  end if;
  if v_ids[1] <> '42000000-0000-0000-0000-000000000106'::uuid then
    raise exception 'migration-307 smoke (4c): admin C row id wrong — expected Personal-C (..106), got %', v_ids;
  end if;
  raise notice 'migration-307 smoke (4c): admin C correctly sees only own org';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Done. Rolling back so the seed leaves no residue. A clean run prints
--    only the NOTICE lines above; a failed run aborts earlier with a
--    clearly-labeled exception.
-- ---------------------------------------------------------------------------
rollback;

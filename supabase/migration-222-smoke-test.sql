-- issue #222 (PRD #220, ADR 0001) — admin-only Shared INSERT RLS — migration smoke test.
--
-- Purpose:   Verify that the tightened `email_accounts_shared_or_personal`
--            INSERT policy enforces every cell of ADR-0001's create matrix at
--            the database. The migration adds an admin-EXISTS clause to the
--            existing WITH CHECK; this smoke test exercises the 5 cases
--            enumerated in issue #222 against authenticated-role sessions.
--
-- Shape:     One transaction, rolled back at the end. The script:
--              1. Re-applies the tightened policy inside the transaction
--                 (idempotent — DROP IF EXISTS, then CREATE). This lets the
--                 smoke test run against either the pre-migration policy or
--                 the post-migration policy without conflict; the rollback
--                 restores whatever was in place before.
--              2. Seeds 2 orgs and 3 users (admin of org1, crew_lead of
--                 org1, admin of org2) under service-role bypass.
--              3. Runs 5 assertion blocks under `role authenticated`, each
--                 attempting an INSERT and asserting allow vs. deny. RLS
--                 violations surface as `insufficient_privilege` exceptions
--                 (SQLSTATE 42501); each block catches that and treats it
--                 as the expected outcome.
--
-- Run:       Via Supabase MCP `execute_sql` with the project_id of the
--            target project. Once the migration has been applied to prod,
--            this script remains in the repo as the documented test of the
--            policy. It is NOT run by CI.

begin;

-- ---------------------------------------------------------------------------
-- 0. Apply the tightened policy inside the transaction. Idempotent via
--    DROP IF EXISTS; the rollback at the end restores whatever was there
--    (the old policy if run pre-migration, the new policy if run post-
--    migration with the same shape).
-- ---------------------------------------------------------------------------
drop policy if exists email_accounts_shared_or_personal on public.email_accounts;

create policy email_accounts_shared_or_personal on public.email_accounts
  for all to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      (user_id is null and nookleus.is_member_of(organization_id))
      or user_id = auth.uid()
    )
  )
  with check (
    organization_id = nookleus.active_organization_id()
    and (
      (
        user_id is null
        and nookleus.is_member_of(organization_id)
        and exists (
          select 1
            from public.user_organizations uo
           where uo.user_id = auth.uid()
             and uo.organization_id = email_accounts.organization_id
             and uo.role = 'admin'
        )
      )
      or user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 1. Seed. Service-role bypass for orgs / users / memberships. Fixed UUIDs
--    so assertions can name them.
--      Org 1: smoke-org-1
--        User A — admin
--        User B — crew_lead (non-admin, send_email-equivalent at app layer)
--      Org 2: smoke-org-2
--        User C — admin
--    Used by the 5 cases below.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('41000000-0000-0000-0000-000000000001', 'smoke-222-org-1', 'smoke-222-org-1'),
  ('41000000-0000-0000-0000-000000000002', 'smoke-222-org-2', 'smoke-222-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('41000000-0000-0000-0000-000000000010', 'smoke-222-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('41000000-0000-0000-0000-000000000011', 'smoke-222-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('41000000-0000-0000-0000-000000000012', 'smoke-222-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('41000000-0000-0000-0000-000000000010', '41000000-0000-0000-0000-000000000001', 'admin'),
  ('41000000-0000-0000-0000-000000000011', '41000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('41000000-0000-0000-0000-000000000012', '41000000-0000-0000-0000-000000000002', 'admin');

-- ---------------------------------------------------------------------------
-- 2. Cases 1–5. Each block sets request.jwt.claims, switches to the
--    authenticated role, attempts an INSERT, catches RLS denial as
--    insufficient_privilege (SQLSTATE 42501), then resets role and
--    asserts the expected outcome. Each block uses a unique row id so
--    the inserts from earlier cases (allowed ones) don't collide with
--    later assertion attempts. The transaction is rolled back at the
--    end, so allowed inserts leave no residue.
-- ---------------------------------------------------------------------------

-- Case 1: Admin (User A in org1) inserts a Shared row (user_id IS NULL) in
-- their own organization → allowed. This is the canonical "admin creates
-- team@ mailbox" path the policy must continue to support.
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"41000000-0000-0000-0000-000000000010","active_organization_id":"41000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.email_accounts
      (id, label, email_address, username, encrypted_password, organization_id, user_id)
    values
      ('41000000-0000-0000-0000-000000000101', 'admin-shared', 'team-1@smoke-222.invalid',
       'team-1@smoke-222.invalid', 'x',
       '41000000-0000-0000-0000-000000000001', null);
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if v_blocked then
    raise exception 'migration-222 smoke (case 1): admin INSERT of Shared row should be allowed, but RLS blocked it';
  end if;
  raise notice 'migration-222 smoke (case 1): admin Shared INSERT correctly allowed';
end $$;

-- Case 2 — TRACER BULLET. Non-admin (crew_lead, User B in org1) attempts to
-- insert a Shared row (user_id IS NULL) in their own organization → denied
-- by the new admin-EXISTS branch. The old migration-140 policy allowed this;
-- this is the gap closed by #222.
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"41000000-0000-0000-0000-000000000011","active_organization_id":"41000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.email_accounts
      (id, label, email_address, username, encrypted_password, organization_id, user_id)
    values
      ('41000000-0000-0000-0000-000000000102', 'crew_lead-shared-attempt', 'team-2@smoke-222.invalid',
       'team-2@smoke-222.invalid', 'x',
       '41000000-0000-0000-0000-000000000001', null);
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if not v_blocked then
    raise exception 'migration-222 smoke (case 2): non-admin INSERT of Shared row should have been blocked by RLS, but it succeeded';
  end if;
  raise notice 'migration-222 smoke (case 2): non-admin Shared INSERT correctly denied';
end $$;

-- Case 3: Non-admin (crew_lead, User B in org1) inserts a Personal row
-- owned by themselves (user_id = auth.uid()) → allowed. The
-- "user_id = auth.uid()" branch of WITH CHECK is unchanged from migration-140.
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"41000000-0000-0000-0000-000000000011","active_organization_id":"41000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.email_accounts
      (id, label, email_address, username, encrypted_password, organization_id, user_id)
    values
      ('41000000-0000-0000-0000-000000000103', 'crew_lead-personal-self', 'b-self@smoke-222.invalid',
       'b-self@smoke-222.invalid', 'x',
       '41000000-0000-0000-0000-000000000001',
       '41000000-0000-0000-0000-000000000011');
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if v_blocked then
    raise exception 'migration-222 smoke (case 3): non-admin INSERT of Personal-owned-by-self should be allowed, but RLS blocked it';
  end if;
  raise notice 'migration-222 smoke (case 3): non-admin Personal-self INSERT correctly allowed';
end $$;

-- Case 4: Non-admin (crew_lead, User B in org1) attempts to insert a
-- Personal row owned by ANOTHER user (user_id = User A, the org admin) →
-- denied. Neither branch of WITH CHECK passes: User B isn't an admin
-- (Shared branch fails) and user_id != auth.uid() (Personal branch fails).
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"41000000-0000-0000-0000-000000000011","active_organization_id":"41000000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.email_accounts
      (id, label, email_address, username, encrypted_password, organization_id, user_id)
    values
      ('41000000-0000-0000-0000-000000000104', 'crew_lead-personal-other', 'a-by-b@smoke-222.invalid',
       'a-by-b@smoke-222.invalid', 'x',
       '41000000-0000-0000-0000-000000000001',
       '41000000-0000-0000-0000-000000000010');
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if not v_blocked then
    raise exception 'migration-222 smoke (case 4): non-admin INSERT of Personal-owned-by-other should have been blocked by RLS, but it succeeded';
  end if;
  raise notice 'migration-222 smoke (case 4): non-admin Personal-other INSERT correctly denied';
end $$;

-- Case 5: Cross-Organization caller. User C is admin of org2; the JWT
-- claims active_organization_id = org2; but the proposed row has
-- organization_id = org1. WITH CHECK requires organization_id =
-- nookleus.active_organization_id(), so the mismatch causes denial
-- regardless of role. This case is unchanged from migration-140 — we
-- include it for completeness of the create matrix.
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"41000000-0000-0000-0000-000000000012","active_organization_id":"41000000-0000-0000-0000-000000000002","role":"authenticated"}';

  begin
    insert into public.email_accounts
      (id, label, email_address, username, encrypted_password, organization_id, user_id)
    values
      ('41000000-0000-0000-0000-000000000105', 'cross-org-attempt', 'cross@smoke-222.invalid',
       'cross@smoke-222.invalid', 'x',
       '41000000-0000-0000-0000-000000000001', null);
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if not v_blocked then
    raise exception 'migration-222 smoke (case 5): cross-Organization INSERT should have been blocked by RLS, but it succeeded';
  end if;
  raise notice 'migration-222 smoke (case 5): cross-Organization INSERT correctly denied';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Done. A clean run prints no NOTICE lines after this ROLLBACK; a failed
--    run aborted earlier with a clearly-labeled exception.
-- ---------------------------------------------------------------------------
rollback;

-- issue #956 (ADR 0028) — bot_senders table — migration smoke test.
--
-- Purpose:   Verify the bot_senders registry enforces, at the database:
--              • per-tenant RLS isolation (a caller sees/writes only its org)
--              • the (organization_id, display_name, address) UNIQUE identity
--                — including that ONE address with TWO display names is two
--                distinct senders (ADR 0028; issue #956 AC #1)
--              • the provenance CHECK (auto | manual)
--
-- Shape:     One transaction, rolled back at the end. Seeds 2 orgs + 2 members
--            under service-role bypass, then runs assertion blocks under
--            `role authenticated`. RLS denials surface as insufficient_privilege
--            (SQLSTATE 42501); constraint violations as unique_violation (23505)
--            / check_violation (23514). Each block catches the expected error
--            and asserts allow-vs-deny.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project AFTER the
--            migration has been applied. Not run by CI.

begin;

-- ---------------------------------------------------------------------------
-- 1. Seed. Service-role bypass. Fixed UUIDs so assertions can name them.
--      Org 1: smoke-956-org-1 — User A (member)
--      Org 2: smoke-956-org-2 — User B (member)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('95600000-0000-0000-0000-000000000001', 'smoke-956-org-1', 'smoke-956-org-1'),
  ('95600000-0000-0000-0000-000000000002', 'smoke-956-org-2', 'smoke-956-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('95600000-0000-0000-0000-000000000010', 'smoke-956-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('95600000-0000-0000-0000-000000000011', 'smoke-956-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('95600000-0000-0000-0000-000000000010', '95600000-0000-0000-0000-000000000001', 'admin'),
  ('95600000-0000-0000-0000-000000000011', '95600000-0000-0000-0000-000000000002', 'admin');

-- ---------------------------------------------------------------------------
-- Case 1 — TRACER BULLET. User A (member of org1, active org1) inserts a bot
-- sender in org1 → allowed. Canonical happy path.
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"95600000-0000-0000-0000-000000000010","active_organization_id":"95600000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.bot_senders (id, organization_id, display_name, address, provenance)
    values ('95600000-0000-0000-0000-000000000101', '95600000-0000-0000-0000-000000000001',
            'vercel[bot]', 'notifications@github.com', 'auto');
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if v_blocked then
    raise exception 'migration-956 smoke (case 1): in-org INSERT should be allowed, but RLS blocked it';
  end if;
  raise notice 'migration-956 smoke (case 1): in-org INSERT correctly allowed';
end $$;

-- ---------------------------------------------------------------------------
-- Case 2. Re-insert the SAME (org, display_name, address) identity → UNIQUE
-- violation. Guards against duplicate bot-sender rows from repeated detection.
-- ---------------------------------------------------------------------------
do $$
declare
  v_dup boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"95600000-0000-0000-0000-000000000010","active_organization_id":"95600000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.bot_senders (id, organization_id, display_name, address, provenance)
    values ('95600000-0000-0000-0000-000000000102', '95600000-0000-0000-0000-000000000001',
            'vercel[bot]', 'notifications@github.com', 'auto');
  exception
    when unique_violation then v_dup := true;
  end;

  reset role;

  if not v_dup then
    raise exception 'migration-956 smoke (case 2): duplicate identity should violate UNIQUE, but it inserted';
  end if;
  raise notice 'migration-956 smoke (case 2): duplicate identity correctly rejected';
end $$;

-- ---------------------------------------------------------------------------
-- Case 3 — AC #1 at the DB. Same org, SAME address, DIFFERENT display_name →
-- allowed. vercel[bot] and "GitHub CI" both @notifications@github.com are two
-- distinct senders.
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"95600000-0000-0000-0000-000000000010","active_organization_id":"95600000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.bot_senders (id, organization_id, display_name, address, provenance)
    values ('95600000-0000-0000-0000-000000000103', '95600000-0000-0000-0000-000000000001',
            'GitHub CI', 'notifications@github.com', 'auto');
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if v_blocked then
    raise exception 'migration-956 smoke (case 3): same-address different-name should be allowed, but it was blocked';
  end if;
  raise notice 'migration-956 smoke (case 3): same-address different-name correctly allowed (two senders)';
end $$;

-- ---------------------------------------------------------------------------
-- Case 4. Cross-org WRITE. User B (active org2) attempts to insert a row with
-- organization_id = org1 → RLS denied (WITH CHECK requires org = active org).
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"95600000-0000-0000-0000-000000000011","active_organization_id":"95600000-0000-0000-0000-000000000002","role":"authenticated"}';

  begin
    insert into public.bot_senders (id, organization_id, display_name, address, provenance)
    values ('95600000-0000-0000-0000-000000000104', '95600000-0000-0000-0000-000000000001',
            'intruder[bot]', 'x@evil.invalid', 'auto');
  exception
    when insufficient_privilege then v_blocked := true;
  end;

  reset role;

  if not v_blocked then
    raise exception 'migration-956 smoke (case 4): cross-org INSERT should be blocked by RLS, but it succeeded';
  end if;
  raise notice 'migration-956 smoke (case 4): cross-org INSERT correctly denied';
end $$;

-- ---------------------------------------------------------------------------
-- Case 5. Cross-org READ. User B (active org2) cannot SELECT org1's rows.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"95600000-0000-0000-0000-000000000011","active_organization_id":"95600000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_count from public.bot_senders
   where organization_id = '95600000-0000-0000-0000-000000000001';

  reset role;

  if v_count <> 0 then
    raise exception 'migration-956 smoke (case 5): org2 caller saw % org1 bot_senders rows; RLS read isolation broken', v_count;
  end if;
  raise notice 'migration-956 smoke (case 5): cross-org READ correctly isolated';
end $$;

-- ---------------------------------------------------------------------------
-- Case 6. provenance CHECK. An out-of-vocabulary provenance → check_violation.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"95600000-0000-0000-0000-000000000010","active_organization_id":"95600000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.bot_senders (id, organization_id, display_name, address, provenance)
    values ('95600000-0000-0000-0000-000000000106', '95600000-0000-0000-0000-000000000001',
            'weird', 'w@example.invalid', 'imported');
  exception
    when check_violation then v_bad := true;
  end;

  reset role;

  if not v_bad then
    raise exception 'migration-956 smoke (case 6): invalid provenance should violate CHECK, but it inserted';
  end if;
  raise notice 'migration-956 smoke (case 6): invalid provenance correctly rejected';
end $$;

-- ---------------------------------------------------------------------------
-- Done. Clean run prints the case NOTICEs then rolls back (no residue).
-- ---------------------------------------------------------------------------
rollback;

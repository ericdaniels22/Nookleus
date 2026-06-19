-- issue #671 (feature #667) — device_tokens RLS smoke test.
--
-- Purpose:   Verify migration-660 enforces user-scoped own-rows on real prod
--            RLS infra:
--              - a member SELECTs only their own device tokens, never another's
--              - a member can INSERT their OWN device address
--              - a member CANNOT INSERT a row stamped with another user_id
--              - a member's UPDATE/DELETE never touches another member's row
--
-- Shape:     One transaction, rolled back at the end. Service-role seeds two
--            orgs / two users, then exercises the policies through JWT-claim
--            role switches in DO blocks.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project AFTER
--            migration-660 is applied, same as migration-309-smoke-test.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed: two members of the same org, each with one registered device.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('b6600000-0000-0000-0000-000000000001', 'smoke-660-org-1', 'smoke-660-org-1');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('b6600000-0000-0000-0000-000000000010', 'smoke-660-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b6600000-0000-0000-0000-000000000011', 'smoke-660-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('b6600000-0000-0000-0000-000000000010', 'b6600000-0000-0000-0000-000000000001', 'crew_lead'),
  ('b6600000-0000-0000-0000-000000000011', 'b6600000-0000-0000-0000-000000000001', 'crew_lead');

insert into public.device_tokens (id, user_id, organization_id, token)
values
  ('b6600000-0000-0000-0000-0000000000f1', 'b6600000-0000-0000-0000-000000000010', 'b6600000-0000-0000-0000-000000000001', 'smoke-660-token-a'),
  ('b6600000-0000-0000-0000-0000000000f2', 'b6600000-0000-0000-0000-000000000011', 'b6600000-0000-0000-0000-000000000001', 'smoke-660-token-b');

-- ---------------------------------------------------------------------------
-- 1. SELECT isolation — member A sees only their own token, not member B's.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_token text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b6600000-0000-0000-0000-000000000010","active_organization_id":"b6600000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), max(token) into v_count, v_token from public.device_tokens;

  reset role;

  if v_count <> 1 or v_token <> 'smoke-660-token-a' then
    raise exception 'migration-660 smoke (case 1: SELECT isolation): expected only own token, got count=% token=%', v_count, v_token;
  end if;
  raise notice 'migration-660 smoke (case 1: SELECT isolation) — member sees only their own device token';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Own-row INSERT — member A can register a new device of their own.
-- ---------------------------------------------------------------------------
do $$
declare
  v_inserted int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b6600000-0000-0000-0000-000000000010","active_organization_id":"b6600000-0000-0000-0000-000000000001","role":"authenticated"}';

  insert into public.device_tokens (user_id, organization_id, token)
  values ('b6600000-0000-0000-0000-000000000010', 'b6600000-0000-0000-0000-000000000001', 'smoke-660-token-a2');
  get diagnostics v_inserted = row_count;

  reset role;

  if v_inserted <> 1 then
    raise exception 'migration-660 smoke (case 2: own INSERT): expected 1 row inserted, got %', v_inserted;
  end if;
  raise notice 'migration-660 smoke (case 2: own INSERT) — member can register their own device';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Forged INSERT — member A cannot register a device under member B's
--    user_id (the WITH CHECK rejects it with insufficient_privilege).
-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b6600000-0000-0000-0000-000000000010","active_organization_id":"b6600000-0000-0000-0000-000000000001","role":"authenticated"}';

  begin
    insert into public.device_tokens (user_id, organization_id, token)
    values ('b6600000-0000-0000-0000-000000000011', 'b6600000-0000-0000-0000-000000000001', 'smoke-660-forge');
    reset role;
    raise exception 'migration-660 smoke (case 3: forged INSERT): expected RLS rejection';
  exception when insufficient_privilege then
    reset role;
    raise notice 'migration-660 smoke (case 3: forged INSERT) — cannot register under another member''s user_id';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Cross-member mutation — member A's UPDATE/DELETE never touches B's row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_updated int;
  v_deleted int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b6600000-0000-0000-0000-000000000010","active_organization_id":"b6600000-0000-0000-0000-000000000001","role":"authenticated"}';

  update public.device_tokens set platform = 'ios'
   where id = 'b6600000-0000-0000-0000-0000000000f2';
  get diagnostics v_updated = row_count;

  delete from public.device_tokens
   where id = 'b6600000-0000-0000-0000-0000000000f2';
  get diagnostics v_deleted = row_count;

  reset role;

  if v_updated <> 0 or v_deleted <> 0 then
    raise exception 'migration-660 smoke (case 4: cross-member mutation): expected 0/0, got update=% delete=%', v_updated, v_deleted;
  end if;
  raise notice 'migration-660 smoke (case 4: cross-member mutation) — cannot touch another member''s device token';
end $$;

rollback;

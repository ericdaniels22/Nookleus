-- issue #140 (PRD #134), Shared/Personal email accounts — migration smoke test.
--
-- Purpose:   Verify migration-140 produced the expected post-state. This file
--            is *not* part of the migration; it is a self-checking script that
--            runs on a fresh DB after migration-140 applies. Every assertion
--            below raises an exception on failure, so a clean run prints
--            nothing (NOTICE lines aside) and a failed run terminates loudly.
--
-- Shape:     One transaction. Seeds 2 orgs, 3 users (A+B in org1, C in org2),
--            and 4 email accounts (1 Shared in org1, Personal-A, Personal-B,
--            Personal-C). Walks the access matrix:
--              - Wipe   — email_accounts/emails/email_attachments empty BEFORE seed.
--              - Shape  — user_id column exists, nullable, FK → auth.users(id).
--              - RLS    — as A in org1: sees Shared + own Personal; not B's Personal.
--                       — as B in org1: sees Shared + own Personal; not A's Personal.
--                       — as C in org2: sees nothing in org1.
--              - Children — emails / email_attachments inherit parent visibility.
--            All seed rows are inserted with fixed UUIDs so assertions can name
--            them. The transaction ROLLBACK at the end leaves the DB unchanged.
--
-- Run:       psql -f supabase/migration-140-smoke-test.sql
--            (or paste into Supabase SQL editor; Service-role bypass is fine
--            for the wipe + shape assertions because they use catalog
--            metadata, not RLS — the RLS assertions explicitly set
--            request.jwt.claims and switch to the authenticated role.)

begin;

-- ---------------------------------------------------------------------------
-- 0. Pre-seed assertions — wipe + shape. These must hold immediately after
--    migration-140 has applied to a fresh DB. We run them before inserting
--    any rows so a stale DB (column added but wipe missed) is caught here.
-- ---------------------------------------------------------------------------
do $$
declare
  v_accounts bigint;
  v_emails bigint;
  v_attachments bigint;
begin
  select count(*) into v_accounts from public.email_accounts;
  select count(*) into v_emails from public.emails;
  select count(*) into v_attachments from public.email_attachments;
  if v_accounts <> 0 or v_emails <> 0 or v_attachments <> 0 then
    raise exception
      'migration-140 smoke: wipe failed — expected all email tables empty, got accounts=%, emails=%, attachments=%',
      v_accounts, v_emails, v_attachments;
  end if;
end $$;

do $$
declare
  v_data_type text;
  v_is_nullable text;
begin
  select data_type, is_nullable
    into v_data_type, v_is_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'email_accounts'
     and column_name = 'user_id';
  if v_data_type is null then
    raise exception 'migration-140 smoke: user_id column missing on email_accounts';
  end if;
  if v_data_type <> 'uuid' then
    raise exception 'migration-140 smoke: user_id should be uuid, got %', v_data_type;
  end if;
  if v_is_nullable <> 'YES' then
    raise exception 'migration-140 smoke: user_id must be nullable (NULL = Shared)';
  end if;
end $$;

do $$
declare
  v_constraint text;
  v_foreign_schema text;
  v_foreign_table text;
  v_foreign_column text;
begin
  select tc.constraint_name, ccu.table_schema, ccu.table_name, ccu.column_name
    into v_constraint, v_foreign_schema, v_foreign_table, v_foreign_column
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
   where tc.constraint_type = 'FOREIGN KEY'
     and tc.table_schema = 'public'
     and tc.table_name = 'email_accounts'
     and kcu.column_name = 'user_id';
  if v_constraint is null then
    raise exception 'migration-140 smoke: user_id has no FK constraint';
  end if;
  if v_foreign_schema <> 'auth' or v_foreign_table <> 'users' or v_foreign_column <> 'id' then
    raise exception 'migration-140 smoke: user_id FK must point at auth.users(id), got %.%(%)',
      v_foreign_schema, v_foreign_table, v_foreign_column;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. RLS seed. Two orgs, three users, four accounts. Service-role insert
--    bypasses RLS. The four accounts span the matrix:
--        Shared-org1 (user_id null)
--        Personal-A  (user_id = A)
--        Personal-B  (user_id = B)
--        Personal-C  (user_id = C, in org2)
--    Each Personal account gets one email + one attachment so the children
--    inherit visibility from their parent.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values
  ('40000000-0000-0000-0000-000000000001', 'smoke-org-1', 'smoke-org-1'),
  ('40000000-0000-0000-0000-000000000002', 'smoke-org-2', 'smoke-org-2');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('40000000-0000-0000-0000-000000000010', 'smoke-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('40000000-0000-0000-0000-000000000011', 'smoke-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('40000000-0000-0000-0000-000000000012', 'smoke-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('40000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000001', 'admin'),
  ('40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000001', 'crew_lead'),
  ('40000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000002', 'admin');

insert into public.email_accounts
  (id, label, email_address, username, encrypted_password, organization_id, user_id)
values
  -- Shared in org1
  ('40000000-0000-0000-0000-000000000100', 'team@', 'team@smoke.invalid', 'team@smoke.invalid', 'x', '40000000-0000-0000-0000-000000000001', null),
  -- Personal A in org1
  ('40000000-0000-0000-0000-000000000101', 'A personal', 'a@smoke.invalid', 'a@smoke.invalid', 'x', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000010'),
  -- Personal B in org1
  ('40000000-0000-0000-0000-000000000102', 'B personal', 'b@smoke.invalid', 'b@smoke.invalid', 'x', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011'),
  -- Personal C in org2
  ('40000000-0000-0000-0000-000000000103', 'C personal', 'c@smoke.invalid', 'c@smoke.invalid', 'x', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000012');

insert into public.emails
  (id, account_id, organization_id, message_id, from_address, to_addresses, received_at)
values
  ('40000000-0000-0000-0000-000000000200', '40000000-0000-0000-0000-000000000100', '40000000-0000-0000-0000-000000000001', 'shared-msg', 'shared@smoke.invalid', '[]', now()),
  ('40000000-0000-0000-0000-000000000201', '40000000-0000-0000-0000-000000000101', '40000000-0000-0000-0000-000000000001', 'a-msg', 'a@smoke.invalid', '[]', now()),
  ('40000000-0000-0000-0000-000000000202', '40000000-0000-0000-0000-000000000102', '40000000-0000-0000-0000-000000000001', 'b-msg', 'b@smoke.invalid', '[]', now()),
  ('40000000-0000-0000-0000-000000000203', '40000000-0000-0000-0000-000000000103', '40000000-0000-0000-0000-000000000002', 'c-msg', 'c@smoke.invalid', '[]', now());

insert into public.email_attachments
  (id, email_id, organization_id, filename)
values
  ('40000000-0000-0000-0000-000000000300', '40000000-0000-0000-0000-000000000200', '40000000-0000-0000-0000-000000000001', 'shared.pdf'),
  ('40000000-0000-0000-0000-000000000301', '40000000-0000-0000-0000-000000000201', '40000000-0000-0000-0000-000000000001', 'a.pdf'),
  ('40000000-0000-0000-0000-000000000302', '40000000-0000-0000-0000-000000000202', '40000000-0000-0000-0000-000000000001', 'b.pdf'),
  ('40000000-0000-0000-0000-000000000303', '40000000-0000-0000-0000-000000000203', '40000000-0000-0000-0000-000000000002', 'c.pdf');

-- ---------------------------------------------------------------------------
-- 2. RLS assertions — one DO block per (caller, expectation) row of the
--    access matrix. Each block sets request.jwt.claims, switches to the
--    authenticated role, runs the visibility query, then reset role so the
--    next block can re-stamp the JWT.
-- ---------------------------------------------------------------------------

-- 2a. As user A (admin of org1, owns Personal-A): sees Shared + Personal-A
--     in email_accounts (count = 2). Does NOT see Personal-B (same org) or
--     Personal-C (other org).
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000010","active_organization_id":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), array_agg(id order by id)
    into v_count, v_ids
    from public.email_accounts;

  reset role;

  if v_count <> 2 then
    raise exception 'migration-140 smoke: user A expected to see 2 accounts (Shared + own Personal), got % — ids=%', v_count, v_ids;
  end if;
  if not (v_ids @> array['40000000-0000-0000-0000-000000000100'::uuid, '40000000-0000-0000-0000-000000000101'::uuid]) then
    raise exception 'migration-140 smoke: user A account ids wrong — expected Shared (..100) + Personal-A (..101), got %', v_ids;
  end if;
end $$;

-- 2b. As user B (crew_lead of org1, owns Personal-B): sees Shared +
--     Personal-B; does NOT see Personal-A (content-private from B's view).
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000011","active_organization_id":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*), array_agg(id order by id)
    into v_count, v_ids
    from public.email_accounts;

  reset role;

  if v_count <> 2 then
    raise exception 'migration-140 smoke: user B expected to see 2 accounts (Shared + own Personal), got % — ids=%', v_count, v_ids;
  end if;
  if not (v_ids @> array['40000000-0000-0000-0000-000000000100'::uuid, '40000000-0000-0000-0000-000000000102'::uuid]) then
    raise exception 'migration-140 smoke: user B account ids wrong — expected Shared (..100) + Personal-B (..102), got %', v_ids;
  end if;
end $$;

-- 2c. As user C in org2: sees only Personal-C (org1's Shared is invisible
--     because C is not a member of org1). Cross-org boundary holds.
do $$
declare
  v_count bigint;
  v_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000012","active_organization_id":"40000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*), array_agg(id order by id)
    into v_count, v_ids
    from public.email_accounts;

  reset role;

  if v_count <> 1 then
    raise exception 'migration-140 smoke: user C (other org) expected to see only Personal-C, got % — ids=%', v_count, v_ids;
  end if;
  if v_ids[1] <> '40000000-0000-0000-0000-000000000103'::uuid then
    raise exception 'migration-140 smoke: user C account id wrong — expected Personal-C (..103), got %', v_ids;
  end if;
end $$;

-- 2d. Emails inherit parent account visibility. User A sees shared-msg +
--     a-msg only; user B sees shared-msg + b-msg only.
do $$
declare
  v_a bigint;
  v_a_ids uuid[];
  v_b bigint;
  v_b_ids uuid[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000010","active_organization_id":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*), array_agg(id order by id) into v_a, v_a_ids from public.emails;

  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000011","active_organization_id":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*), array_agg(id order by id) into v_b, v_b_ids from public.emails;

  reset role;

  if v_a <> 2 or not (v_a_ids @> array['40000000-0000-0000-0000-000000000200'::uuid, '40000000-0000-0000-0000-000000000201'::uuid]) then
    raise exception 'migration-140 smoke: emails visible to A wrong — got count=%, ids=%', v_a, v_a_ids;
  end if;
  if v_b <> 2 or not (v_b_ids @> array['40000000-0000-0000-0000-000000000200'::uuid, '40000000-0000-0000-0000-000000000202'::uuid]) then
    raise exception 'migration-140 smoke: emails visible to B wrong — got count=%, ids=%', v_b, v_b_ids;
  end if;
end $$;

-- 2e. Email attachments inherit through emails → email_accounts. User A
--     sees shared.pdf + a.pdf; user B sees shared.pdf + b.pdf.
do $$
declare
  v_a bigint;
  v_a_files text[];
  v_b bigint;
  v_b_files text[];
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000010","active_organization_id":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*), array_agg(filename order by filename) into v_a, v_a_files from public.email_attachments;

  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000011","active_organization_id":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*), array_agg(filename order by filename) into v_b, v_b_files from public.email_attachments;

  reset role;

  if v_a <> 2 or not (v_a_files @> array['shared.pdf', 'a.pdf']) then
    raise exception 'migration-140 smoke: attachments visible to A wrong — got count=%, files=%', v_a, v_a_files;
  end if;
  if v_b <> 2 or not (v_b_files @> array['shared.pdf', 'b.pdf']) then
    raise exception 'migration-140 smoke: attachments visible to B wrong — got count=%, files=%', v_b, v_b_files;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Done. Rolling back so the seed leaves no residue. A clean run prints
--    no NOTICE lines after this ROLLBACK; a failed run aborted earlier with
--    a clearly-labeled exception.
-- ---------------------------------------------------------------------------
rollback;

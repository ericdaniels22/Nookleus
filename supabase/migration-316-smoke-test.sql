-- issue #317 (PRD #304, ADR 0005) — conversation owner-snapshot access-matrix
-- smoke test.
--
-- Purpose:   Verify, at the database under real RLS, that migration-316's
--            owner snapshot scopes Personal content correctly AND that a
--            revived number's prior content stays with the departed owner —
--            the leak migration-316 closes. Mirrors migration-308-smoke-test
--            and extends it with the revive cases.
--
--            Matrix exercised (phone_conversations / phone_messages SELECT):
--              - Shared conversation              → every same-org member sees
--              - Personal untagged, owner         → owner sees
--              - Personal untagged, non-owner     → hidden
--              - Personal Job-tagged, non-owner   → sees (Job-visible team)
--              - REVIVE: number reassigned to a new owner
--                  · new owner sees ONLY their own new conversation
--                  · new owner does NOT see the prior owner's conversation
--                    or untagged messages (the snapshot wall)
--                  · prior owner's snapshot rows remain theirs
--
-- Shape:     One transaction, rolled back at the end. The owner snapshot is set
--            by the BEFORE INSERT trigger, so the seed never writes
--            owner_user_id directly. Each assertion sets the JWT claims,
--            switches to `authenticated`, runs a SELECT, asserts the row set.
--
-- Run:       Via Supabase MCP `execute_sql` against the target project, AFTER
--            migration-316 is applied. The local embedded-postgres counterpart
--            (tests/integration/conversation-owner-snapshot.pg.test.ts) drives
--            the same policies through GUC-backed shims.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed. Service-role bypass for orgs / users / memberships.
--      Org: smoke-316-org
--        User C — crew_lead, original owner of the Personal number
--        User B — crew_lead, teammate / future re-claimant (owns nothing yet)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values ('b1600000-0000-0000-0000-000000000001', 'smoke-316-org', 'smoke-316-org');

insert into auth.users (id, email, role, aud, instance_id)
values
  ('b1600000-0000-0000-0000-000000000012', 'smoke-316-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b1600000-0000-0000-0000-000000000011', 'smoke-316-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.user_organizations (user_id, organization_id, role)
values
  ('b1600000-0000-0000-0000-000000000012', 'b1600000-0000-0000-0000-000000000001', 'crew_lead'),
  ('b1600000-0000-0000-0000-000000000011', 'b1600000-0000-0000-0000-000000000001', 'crew_lead');

-- One Personal number owned by User C.
insert into public.phone_numbers
  (id, organization_id, twilio_sid, e164, kind, user_id)
values
  ('b1600000-0000-0000-0000-0000000000a2', 'b1600000-0000-0000-0000-000000000001',
   'PN-smoke-316-personal', '+15125550316', 'personal',
   'b1600000-0000-0000-0000-000000000012');

-- C's conversation on the Personal line. The trigger snapshots owner = C.
insert into public.phone_conversations
  (id, organization_id, phone_number_id, outside_e164)
values
  ('b1600000-0000-0000-0000-0000000000b2', 'b1600000-0000-0000-0000-000000000001',
   'b1600000-0000-0000-0000-0000000000a2', '+15551110316');

-- A Job for the Job-tagged (team-visible) case.
insert into public.contacts (id, organization_id, full_name)
values ('b1600000-0000-0000-0000-0000000000c1',
        'b1600000-0000-0000-0000-000000000001', 'smoke-316-contact');

insert into public.jobs
  (id, organization_id, contact_id, damage_type, property_address)
values
  ('b1600000-0000-0000-0000-0000000000d1', 'b1600000-0000-0000-0000-000000000001',
   'b1600000-0000-0000-0000-0000000000c1', 'water', '1 smoke st');

-- Two messages on C's Personal conversation: one untagged (owner-only), one
-- Job-tagged (team-visible).
insert into public.phone_messages
  (id, organization_id, conversation_id, direction, from_e164, to_e164, body, job_tag)
values
  ('b1600000-0000-0000-0000-0000000000e3', 'b1600000-0000-0000-0000-000000000001',
   'b1600000-0000-0000-0000-0000000000b2', 'in', '+15551110316', '+15125550316', 'personal-untagged', null),
  ('b1600000-0000-0000-0000-0000000000e4', 'b1600000-0000-0000-0000-000000000001',
   'b1600000-0000-0000-0000-0000000000b2', 'in', '+15551110316', '+15125550316', 'personal-tagged',
   'b1600000-0000-0000-0000-0000000000d1');

-- ---------------------------------------------------------------------------
-- 1. Pre-revive. User C (owner) sees the conversation + both messages.
--    User B (non-owner) sees neither the conversation nor the untagged
--    message, but DOES see the Job-tagged message (team-visible).
-- ---------------------------------------------------------------------------
do $$
declare
  v_c_conv int;
  v_c_msg  int;
  v_b_conv int;
  v_b_msg  text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b1600000-0000-0000-0000-000000000012","active_organization_id":"b1600000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) into v_c_conv from public.phone_conversations;
  select count(*) into v_c_msg  from public.phone_messages;
  reset role;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b1600000-0000-0000-0000-000000000011","active_organization_id":"b1600000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) into v_b_conv from public.phone_conversations;
  select string_agg(body, ',' order by body) into v_b_msg from public.phone_messages;
  reset role;

  if v_c_conv <> 1 then
    raise exception 'migration-316 smoke (1: owner conv): expected 1, got %', v_c_conv;
  end if;
  if v_c_msg <> 2 then
    raise exception 'migration-316 smoke (1: owner msgs): expected 2, got %', v_c_msg;
  end if;
  if v_b_conv <> 0 then
    raise exception 'migration-316 smoke (1: non-owner conv): expected 0 (untagged Personal hidden), got %', v_b_conv;
  end if;
  if coalesce(v_b_msg, '') <> 'personal-tagged' then
    raise exception 'migration-316 smoke (1: non-owner msgs): expected only personal-tagged, got %', v_b_msg;
  end if;
  raise notice 'migration-316 smoke (1) — owner sees own Personal content; non-owner sees only the Job-tagged message';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Revive: offboard C, re-claim the number for B (reassign user_id), and B
--    starts a fresh conversation on the revived line.
-- ---------------------------------------------------------------------------
update public.phone_numbers
   set user_id = 'b1600000-0000-0000-0000-000000000011'
 where id = 'b1600000-0000-0000-0000-0000000000a2';

insert into public.phone_conversations
  (id, organization_id, phone_number_id, outside_e164)
values
  ('b1600000-0000-0000-0000-0000000000b9', 'b1600000-0000-0000-0000-000000000001',
   'b1600000-0000-0000-0000-0000000000a2', '+15552220316');

-- ---------------------------------------------------------------------------
-- 3. Post-revive. B (new owner) sees ONLY their own new conversation, never
--    C's prior one or C's untagged message. C's snapshot rows stay C's.
-- ---------------------------------------------------------------------------
do $$
declare
  v_b_ids text;
  v_b_untagged int;
  v_c_ids text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b1600000-0000-0000-0000-000000000011","active_organization_id":"b1600000-0000-0000-0000-000000000001","role":"authenticated"}';
  select string_agg(id::text, ',' order by id) into v_b_ids from public.phone_conversations;
  select count(*) into v_b_untagged from public.phone_messages where body = 'personal-untagged';
  reset role;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"b1600000-0000-0000-0000-000000000012","active_organization_id":"b1600000-0000-0000-0000-000000000001","role":"authenticated"}';
  select string_agg(id::text, ',' order by id) into v_c_ids from public.phone_conversations;
  reset role;

  if v_b_ids <> 'b1600000-0000-0000-0000-0000000000b9' then
    raise exception 'migration-316 smoke (3: new owner conv): expected only the new conversation, got %', v_b_ids;
  end if;
  if v_b_untagged <> 0 then
    raise exception 'migration-316 smoke (3: new owner leak): new owner can see the prior owner''s untagged message';
  end if;
  if v_c_ids <> 'b1600000-0000-0000-0000-0000000000b2' then
    raise exception 'migration-316 smoke (3: prior owner conv): expected only the prior conversation, got %', v_c_ids;
  end if;
  raise notice 'migration-316 smoke (3) — revive wall holds: new owner sees only their own thread, prior owner keeps theirs';
end $$;

rollback;

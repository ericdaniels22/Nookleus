-- issue #706 (parent epic #699) — Timesheet Corrections & needs-attention smoke test.
--
-- Purpose:   Self-checking script that verifies migration-706's Correction RPC
--            and the cross-Organization isolation that backstops it. NOT part of
--            the migration. Wrapped in begin; ... rollback; so the database is
--            unchanged on a clean run. Every assertion raises on failure; a clean
--            run prints only NOTICE lines.
--
-- Preconditions: migration-706 (and its deps 661/662) have been applied.
--            Sections that need a real auth.users row (the default-permission
--            grants and the cross-org RLS proof) pick any existing user and skip
--            themselves if the database has none. The RPC behaviour section uses
--            off-app sessions (user_id NULL) + a NULL actor, so it always runs.
--
-- Run:       psql -f supabase/migration-706-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. correct_time_session(uuid,uuid,timestamptz,timestamptz,uuid) exists and
--      set_default_permissions references manage_timesheets.
--   2. set_default_permissions defaults manage_timesheets ON for admin +
--      crew_lead, OFF for crew_member + custom (AC7, SQL side — the TS side is
--      pinned by role-defaults.test.ts).
--   3. correct_time_session writes the decided times, flips capture_method to
--      'hand', and appends exactly ONE append-only 'corrected' event carrying
--      { field, old, new } over the edited columns (AC2). Correcting only the
--      clock-in of an Open session leaves it Open (AC1). An impossible span is
--      rejected by the migration-661 CHECK, writing NO event and leaving
--      capture_method unchanged (AC3, DB backstop).
--   4. Cross-org RLS (AC8): a lead in Org A cannot read, correct, forge-audit,
--      or see the needs-attention (Open) sessions of Org B — while the SAME
--      caller CAN correct its OWN Org's session (the control proving the denial
--      is cross-org, not a blanket failure).

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema/catalog presence.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  if to_regprocedure('public.correct_time_session(uuid, uuid, timestamptz, timestamptz, uuid)') is null then
    raise exception 'm706 smoke: correct_time_session(uuid,uuid,timestamptz,timestamptz,uuid) does not exist';
  end if;

  v_src := pg_get_functiondef('public.set_default_permissions(uuid, text)'::regprocedure);
  if v_src not ilike '%manage_timesheets%' then
    raise exception 'm706 smoke: set_default_permissions body does not reference manage_timesheets';
  end if;
  raise notice 'm706 smoke: correct_time_session present; set_default_permissions references manage_timesheets';
end $$;

-- ---------------------------------------------------------------------------
-- 2. set_default_permissions — manage_timesheets default per role (AC7).
--    One membership per role across four throwaway orgs (a user can hold only
--    one membership per org). We assert the per-membership grant in
--    user_organization_permissions. Needs a real user for the membership FK.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user      uuid;
  v_org_admin uuid := gen_random_uuid();
  v_org_lead  uuid := gen_random_uuid();
  v_org_mem   uuid := gen_random_uuid();
  v_org_cust  uuid := gen_random_uuid();
  v_m_admin   uuid;
  v_m_lead    uuid;
  v_m_mem     uuid;
  v_m_cust    uuid;
  v_granted   boolean;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm706 smoke: default-permission checks skipped — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug) values
    (v_org_admin, 'm706 perm admin', 'm706-perm-admin-' || replace(v_org_admin::text, '-', '')),
    (v_org_lead,  'm706 perm lead',  'm706-perm-lead-'  || replace(v_org_lead::text,  '-', '')),
    (v_org_mem,   'm706 perm mem',   'm706-perm-mem-'   || replace(v_org_mem::text,   '-', '')),
    (v_org_cust,  'm706 perm cust',  'm706-perm-cust-'  || replace(v_org_cust::text,  '-', ''));

  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org_admin, 'admin')       returning id into v_m_admin;
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org_lead,  'crew_lead')   returning id into v_m_lead;
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org_mem,   'crew_member') returning id into v_m_mem;
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org_cust,  'custom')      returning id into v_m_cust;

  perform set_default_permissions(v_m_admin, 'admin');
  perform set_default_permissions(v_m_lead,  'crew_lead');
  perform set_default_permissions(v_m_mem,   'crew_member');
  perform set_default_permissions(v_m_cust,  'custom');

  select granted into v_granted from public.user_organization_permissions
    where user_organization_id = v_m_admin and permission_key = 'manage_timesheets';
  if v_granted is distinct from true then
    raise exception 'm706 smoke: manage_timesheets default for admin = % (expected true)', v_granted;
  end if;

  select granted into v_granted from public.user_organization_permissions
    where user_organization_id = v_m_lead and permission_key = 'manage_timesheets';
  if v_granted is distinct from true then
    raise exception 'm706 smoke: manage_timesheets default for crew_lead = % (expected true)', v_granted;
  end if;

  select granted into v_granted from public.user_organization_permissions
    where user_organization_id = v_m_mem and permission_key = 'manage_timesheets';
  if v_granted is distinct from false then
    raise exception 'm706 smoke: manage_timesheets default for crew_member = % (expected false)', v_granted;
  end if;

  select granted into v_granted from public.user_organization_permissions
    where user_organization_id = v_m_cust and permission_key = 'manage_timesheets';
  if v_granted is distinct from false then
    raise exception 'm706 smoke: manage_timesheets default for custom = % (expected false)', v_granted;
  end if;

  raise notice 'm706 smoke: set_default_permissions — manage_timesheets ON for admin+crew_lead, OFF for crew_member+custom';
end $$;

-- ---------------------------------------------------------------------------
-- 3. correct_time_session behaviour (AC1/AC2/AC3). Off-app sessions + NULL
--    actor, so this runs even on an empty auth.users. One do-block so the ids
--    stay in scope; everything rolls back at the end.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id     uuid := gen_random_uuid();
  v_contact_id uuid := gen_random_uuid();
  v_job_id     uuid;
  v_s_both     uuid := gen_random_uuid();
  v_s_open     uuid := gen_random_uuid();
  v_s_bad      uuid := gen_random_uuid();
  v_started    timestamptz;
  v_ended      timestamptz;
  v_method     text;
  v_count      int;
  v_meta       jsonb;
  v_rejected   boolean := false;
begin
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm706 rpc', 'm706-rpc-' || replace(v_org_id::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role)
    values (v_contact_id, v_org_id, 'Homeowner', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_id, v_contact_id, 'water', '1 RPC St', 'SMOKE-706')
    returning id into v_job_id;

  -- ----- 3a. Both ends corrected on a closed, live-captured session -----
  insert into public.time_sessions (id, organization_id, job_id, off_app_worker_name, capture_method, started_at, ended_at)
    values (v_s_both, v_org_id, v_job_id, 'Span', 'live',
            '2026-06-19T12:00:00Z', '2026-06-19T20:00:00Z');

  perform correct_time_session(
    v_s_both, v_org_id,
    '2026-06-19T13:00:00Z'::timestamptz, '2026-06-19T21:00:00Z'::timestamptz, null);

  select started_at, ended_at, capture_method into v_started, v_ended, v_method
    from public.time_sessions where id = v_s_both;
  if v_started is distinct from '2026-06-19T13:00:00Z'::timestamptz
     or v_ended is distinct from '2026-06-19T21:00:00Z'::timestamptz then
    raise exception 'm706 smoke: both-ends correction wrote started=% ended=% (expected 13:00 / 21:00)', v_started, v_ended;
  end if;
  if v_method <> 'hand' then
    raise exception 'm706 smoke: correction did not flip capture_method to hand (got %)', v_method;
  end if;

  select count(*) into v_count from public.time_session_events
    where time_session_id = v_s_both and event_type = 'corrected';
  if v_count <> 1 then
    raise exception 'm706 smoke: both-ends correction wrote % corrected events (expected exactly 1)', v_count;
  end if;

  select metadata into v_meta from public.time_session_events
    where time_session_id = v_s_both and event_type = 'corrected';
  if v_meta->'field' is distinct from '["started_at","ended_at"]'::jsonb then
    raise exception 'm706 smoke: both-ends event field is % (expected ["started_at","ended_at"])', v_meta->'field';
  end if;
  if v_meta->'old' is distinct from jsonb_build_object(
       'started_at', '2026-06-19T12:00:00Z'::timestamptz,
       'ended_at',   '2026-06-19T20:00:00Z'::timestamptz)
     or v_meta->'new' is distinct from jsonb_build_object(
       'started_at', '2026-06-19T13:00:00Z'::timestamptz,
       'ended_at',   '2026-06-19T21:00:00Z'::timestamptz) then
    raise exception 'm706 smoke: both-ends event old/new payload is wrong: %', v_meta;
  end if;
  raise notice 'm706 smoke: correction — both ends written, capture→hand, exactly 1 corrected event with {field,old,new}';

  -- ----- 3b. Correcting only the clock-in of an Open session keeps it Open (AC1) -----
  insert into public.time_sessions (id, organization_id, job_id, off_app_worker_name, capture_method, started_at)
    values (v_s_open, v_org_id, v_job_id, 'Open', 'live', '2026-06-19T09:00:00Z');

  perform correct_time_session(
    v_s_open, v_org_id, '2026-06-19T08:00:00Z'::timestamptz, null, null);

  select started_at, ended_at, capture_method into v_started, v_ended, v_method
    from public.time_sessions where id = v_s_open;
  if v_ended is not null then
    raise exception 'm706 smoke: correcting clock-in auto-closed the Open session (ended_at %)', v_ended;
  end if;
  if v_started is distinct from '2026-06-19T08:00:00Z'::timestamptz or v_method <> 'hand' then
    raise exception 'm706 smoke: clock-in-only correction wrote started=% capture=% (expected 08:00 / hand)', v_started, v_method;
  end if;

  select metadata into v_meta from public.time_session_events
    where time_session_id = v_s_open and event_type = 'corrected';
  if v_meta->'field' is distinct from '["started_at"]'::jsonb
     or v_meta->'old' is distinct from jsonb_build_object('started_at', '2026-06-19T09:00:00Z'::timestamptz)
     or v_meta->'new' is distinct from jsonb_build_object('started_at', '2026-06-19T08:00:00Z'::timestamptz) then
    raise exception 'm706 smoke: clock-in-only event payload is wrong (expected only started_at): %', v_meta;
  end if;
  raise notice 'm706 smoke: correction — clock-in-only edit keeps an Open session Open, event carries only started_at';

  -- ----- 3c. Impossible span rejected by the CHECK; no event, no capture change (AC3) -----
  insert into public.time_sessions (id, organization_id, job_id, off_app_worker_name, capture_method, started_at, ended_at)
    values (v_s_bad, v_org_id, v_job_id, 'Bad', 'live',
            '2026-06-19T12:00:00Z', '2026-06-19T20:00:00Z');

  begin
    -- New clock-out (11:00) lands BEFORE the existing clock-in (12:00). The app
    -- would reject this first; here we prove the DB CHECK backstops it.
    perform correct_time_session(
      v_s_bad, v_org_id, null, '2026-06-19T11:00:00Z'::timestamptz, null);
  exception when check_violation then v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'm706 smoke: impossible span (clock-out before clock-in) was NOT rejected';
  end if;

  select capture_method, ended_at into v_method, v_ended
    from public.time_sessions where id = v_s_bad;
  if v_method <> 'live' or v_ended is distinct from '2026-06-19T20:00:00Z'::timestamptz then
    raise exception 'm706 smoke: rejected span still mutated the session (capture=% ended=%)', v_method, v_ended;
  end if;
  select count(*) into v_count from public.time_session_events
    where time_session_id = v_s_bad and event_type = 'corrected';
  if v_count <> 0 then
    raise exception 'm706 smoke: rejected span still wrote % corrected event(s)', v_count;
  end if;
  raise notice 'm706 smoke: correction — impossible span rejected by CHECK, no event, capture unchanged';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Cross-org RLS (AC8). A lead in Org A must not read, correct, forge-audit,
--    or see the needs-attention (Open) sessions of Org B — while the SAME
--    caller CAN correct its OWN Org's session (control). Needs a real user for
--    the membership EXISTS check; skips itself when the database has none.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a       uuid := gen_random_uuid();
  v_org_b       uuid := gen_random_uuid();
  v_contact_a   uuid := gen_random_uuid();
  v_contact_b   uuid := gen_random_uuid();
  v_job_a       uuid;
  v_job_b       uuid;
  v_user        uuid;
  v_s_a         uuid := gen_random_uuid();   -- Org A closed session (own-org control)
  v_s_b         uuid := gen_random_uuid();   -- Org B closed session (correct/forge target)
  v_o_b         uuid := gen_random_uuid();   -- Org B Open session (needs-attention target)
  -- Captured under RLS as the Org-A caller:
  v_b_sessions      bigint;
  v_a_sessions      bigint;
  v_b_events        bigint;
  v_a_events        bigint;
  v_b_open_for_job  bigint;
  v_correct_blocked boolean := false;
  v_forge_blocked   boolean := false;
  v_a_started_after timestamptz;
  v_a_capture_after text;
  v_a_corrected     bigint;
  -- Captured after reset (owner bypass), to prove the blocked attempt wrote nothing:
  v_b_capture_after text;
  v_b_ended_after   timestamptz;
  v_b_corrected     bigint;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm706 smoke: cross-org RLS checks skipped — no auth.users row';
    return;
  end if;

  -- Two tenants; the caller is a crew_lead of Org A only.
  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm706 rls A', 'm706-rls-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm706 rls B', 'm706-rls-b-' || replace(v_org_b::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role) values
    (v_contact_a, v_org_a, 'RLS A', 'homeowner'),
    (v_contact_b, v_org_b, 'RLS B', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_a, v_contact_a, 'water', '1 RLS St', 'SMOKE-706-A') returning id into v_job_a;
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_b, v_contact_b, 'water', '2 RLS St', 'SMOKE-706-B') returning id into v_job_b;

  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org_a, 'crew_lead');

  -- Seed under owner bypass. Org A: one closed session + one event (controls so
  -- the caller proves it CAN see its own). Org B: a closed session + event (the
  -- read/correct/forge target) and a long-running Open session (needs-attention).
  insert into public.time_sessions (id, organization_id, job_id, off_app_worker_name, capture_method, started_at, ended_at) values
    (v_s_a, v_org_a, v_job_a, 'Own A', 'live', '2026-06-19T12:00:00Z', '2026-06-19T20:00:00Z'),
    (v_s_b, v_org_b, v_job_b, 'Theirs B', 'live', '2026-06-19T12:00:00Z', '2026-06-19T20:00:00Z');
  insert into public.time_sessions (id, organization_id, job_id, off_app_worker_name, capture_method, started_at) values
    (v_o_b, v_org_b, v_job_b, 'Open B', 'live', '2026-06-19T06:00:00Z');
  insert into public.time_session_events (organization_id, time_session_id, event_type) values
    (v_org_a, v_s_a, 'created'),
    (v_org_b, v_s_b, 'created');

  -- Act as the authenticated Org-A crew_lead.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org_a::text, 'role', 'authenticated')::text,
    true);

  -- Reads: B invisible, A visible (control).
  select count(*) into v_b_sessions from public.time_sessions     where organization_id = v_org_b;
  select count(*) into v_a_sessions from public.time_sessions     where organization_id = v_org_a;
  select count(*) into v_b_events   from public.time_session_events where organization_id = v_org_b;
  select count(*) into v_a_events   from public.time_session_events where organization_id = v_org_a;
  -- needs-attention is "Open sessions for this Job"; scoped to Org B's Job it
  -- must come back empty for an Org-A caller (the route can't surface B's list).
  select count(*) into v_b_open_for_job from public.time_sessions
    where job_id = v_job_b and ended_at is null;

  -- Correct Org B's session via the RPC → denied (the FOR UPDATE select sees no
  -- row under RLS, so the function raises "not found").
  begin
    perform correct_time_session(
      v_s_b, v_org_b, '2026-06-19T13:00:00Z'::timestamptz, null, v_user);
  exception when raise_exception or insufficient_privilege then v_correct_blocked := true;
  end;

  -- Forge an audit row into Org B directly → denied by the INSERT WITH CHECK.
  begin
    insert into public.time_session_events (organization_id, time_session_id, event_type, actor)
      values (v_org_b, v_s_b, 'corrected', v_user);
  exception when insufficient_privilege then v_forge_blocked := true;
  end;

  -- Control: correcting the caller's OWN-Org session succeeds.
  perform correct_time_session(
    v_s_a, v_org_a, '2026-06-19T13:00:00Z'::timestamptz, null, v_user);
  select started_at, capture_method into v_a_started_after, v_a_capture_after
    from public.time_sessions where id = v_s_a;
  select count(*) into v_a_corrected from public.time_session_events
    where time_session_id = v_s_a and event_type = 'corrected';

  reset role;

  -- Owner bypass: Org B's session must be exactly as seeded (the blocked
  -- correction and forge wrote nothing).
  select capture_method, ended_at into v_b_capture_after, v_b_ended_after
    from public.time_sessions where id = v_s_b;
  select count(*) into v_b_corrected from public.time_session_events
    where time_session_id = v_s_b and event_type = 'corrected';

  -- Assertions.
  if v_b_sessions <> 0 then
    raise exception 'm706 smoke: Org-A caller read % of Org B''s time_sessions (expected 0)', v_b_sessions;
  end if;
  if v_a_sessions = 0 then
    raise exception 'm706 smoke: control failed — Org-A caller could not see its OWN time_sessions';
  end if;
  if v_b_events <> 0 then
    raise exception 'm706 smoke: Org-A caller read % of Org B''s time_session_events (expected 0)', v_b_events;
  end if;
  if v_a_events = 0 then
    raise exception 'm706 smoke: control failed — Org-A caller could not see its OWN time_session_events';
  end if;
  if v_b_open_for_job <> 0 then
    raise exception 'm706 smoke: Org-A caller saw % of Org B''s Open (needs-attention) sessions (expected 0)', v_b_open_for_job;
  end if;
  if not v_correct_blocked then
    raise exception 'm706 smoke: Org-A caller correcting Org B''s session was NOT denied';
  end if;
  if not v_forge_blocked then
    raise exception 'm706 smoke: Org-A caller forging an Org B audit event was NOT denied';
  end if;
  if v_a_capture_after <> 'hand' or v_a_started_after is distinct from '2026-06-19T13:00:00Z'::timestamptz or v_a_corrected <> 1 then
    raise exception 'm706 smoke: control failed — own-Org correction did not take (capture=% started=% events=%)',
      v_a_capture_after, v_a_started_after, v_a_corrected;
  end if;
  if v_b_capture_after <> 'live' or v_b_ended_after is distinct from '2026-06-19T20:00:00Z'::timestamptz or v_b_corrected <> 0 then
    raise exception 'm706 smoke: the blocked cross-org attempt still mutated Org B (capture=% ended=% corrected=%)',
      v_b_capture_after, v_b_ended_after, v_b_corrected;
  end if;
  raise notice 'm706 smoke: RLS — Org A cannot read/correct/forge-audit/needs-attention Org B; own-Org correction works (control)';
end $$;

rollback;

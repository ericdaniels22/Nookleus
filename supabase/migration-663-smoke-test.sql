-- issue #702 (parent epic #699) — Offline-resilient clock-in smoke test.
--
-- Purpose:   Self-checking script for migration-663. NOT part of the migration.
--            Wrapped in begin; ... rollback; so the database is unchanged on a
--            clean run. Every assertion raises on failure; a clean run prints
--            only NOTICE lines.
--
-- Preconditions: migration-661 and migration-663 have been applied. The RPC
--            sections pick any existing auth.users row and skip themselves if
--            the database has no users.
--
-- Run:       psql -f supabase/migration-663-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. time_sessions gains client_capture_id + server_received_at; NO location
--      column was added.
--   2. The (organization_id, client_capture_id) partial unique index: a
--      duplicate is rejected; NULL client_capture_id rows are exempt; a
--      soft-deleted row frees the id; the SAME client_capture_id under a
--      different Org is allowed (AC9, cross-org isolation).
--   3. clock_in_to_job idempotency: first call opens + logs 'created'; a replay
--      with the same client_capture_id returns the SAME session id, writes no
--      second session, no second 'created' event, and does NOT re-run a
--      job-switch close. The session is capture_method 'live' (AC3) with the
--      device started_at (AC4) and a non-null server_received_at audit stamp.
--   4. clock_out_session idempotency: closes at the device ended_at + logs
--      'clocked_out'; a replay with the same client_capture_id is a no-op
--      success (no second event, ended_at unchanged) — AC8; a double clock-out
--      WITHOUT a client_capture_id still raises (slice-1 contract preserved).

begin;

-- ---------------------------------------------------------------------------
-- 1. New columns exist; no location column crept in.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_location text;
begin
  select string_agg('time_sessions.' || col, ', ')
    into v_missing
  from unnest(array['client_capture_id', 'server_received_at']) as col
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'time_sessions'
       and column_name = col
  );
  if v_missing is not null then
    raise exception 'm663 smoke: missing column(s): %', v_missing;
  end if;

  select string_agg(column_name, ', ')
    into v_location
  from information_schema.columns
   where table_schema = 'public' and table_name = 'time_sessions'
     and column_name ~* '(latitude|longitude|geo|fence|region|coord|gps|location|\mlat\M|\mlng\M)';
  if v_location is not null then
    raise exception 'm663 smoke: time_sessions grew a location column (ADR 0019): %', v_location;
  end if;
  raise notice 'm663 smoke: columns client_capture_id + server_received_at present; no location column';
end $$;

-- ---------------------------------------------------------------------------
-- 2. (organization_id, client_capture_id) partial unique index behavior.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a     uuid := gen_random_uuid();
  v_org_b     uuid := gen_random_uuid();
  v_contact_a uuid := gen_random_uuid();
  v_contact_b uuid := gen_random_uuid();
  v_job_a     uuid;
  v_job_b     uuid;
  v_cap       uuid := gen_random_uuid();
  v_row       uuid;
  v_count     int;
begin
  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm663 idx A', 'm663-idx-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm663 idx B', 'm663-idx-b-' || replace(v_org_b::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role) values
    (v_contact_a, v_org_a, 'Idx A', 'homeowner'),
    (v_contact_b, v_org_b, 'Idx B', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_a, v_contact_a, 'water', '1 Idx St', 'SMOKE-663-IDX-A') returning id into v_job_a;
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_b, v_contact_b, 'water', '2 Idx St', 'SMOKE-663-IDX-B') returning id into v_job_b;

  -- ----- 2a. duplicate (org, client_capture_id) rejected -----
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, client_capture_id)
    values (v_org_a, v_job_a, 'Idx', 'live', v_cap);
  begin
    insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, client_capture_id)
      values (v_org_a, v_job_a, 'Idx', 'live', v_cap);
    raise exception 'm663 smoke: duplicate (org, client_capture_id) was NOT rejected';
  exception when unique_violation then null;
  end;

  -- ----- 2b. NULL client_capture_id rows are exempt (many allowed) -----
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, client_capture_id)
    values (v_org_a, v_job_a, 'Idx', 'live', null), (v_org_a, v_job_a, 'Idx', 'live', null);

  -- ----- 2c. soft-deleting the row frees the id for a new live row -----
  update public.time_sessions set deleted_at = now()
    where organization_id = v_org_a and client_capture_id = v_cap;
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, client_capture_id)
    values (v_org_a, v_job_a, 'Idx', 'live', v_cap);  -- allowed: prior is soft-deleted

  -- ----- 2d. same client_capture_id under a different Org is allowed (AC9) -----
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, client_capture_id)
    values (v_org_b, v_job_b, 'Idx', 'live', v_cap);
  select count(*) into v_count from public.time_sessions
    where client_capture_id = v_cap and deleted_at is null;
  if v_count <> 2 then
    raise exception 'm663 smoke: expected 2 live rows (one per Org) sharing client_capture_id, found %', v_count;
  end if;
  raise notice 'm663 smoke: idempotency index — duplicate rejected, NULL exempt, soft-delete frees id, cross-org allowed';
end $$;

-- ---------------------------------------------------------------------------
-- 3. clock_in_to_job idempotency (AC2/AC3/AC4). First call opens the session
--    and logs 'created'; a replay with the SAME client_capture_id returns the
--    original session id, writes no second session and no second 'created'
--    event, and does NOT re-run a job-switch close. The session is live (AC3)
--    with the device started_at (AC4) and a distinct, non-null server_received_at
--    audit stamp (AC4 — the server receive time never substitutes for the tap).
--    RPC-driven rows FK to auth.users, so this section needs a real user.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user      uuid;
  v_org       uuid := gen_random_uuid();
  v_contact   uuid := gen_random_uuid();
  v_job       uuid;
  v_job2      uuid;
  v_cap1      uuid := gen_random_uuid();
  v_cap_sw    uuid := gen_random_uuid();
  v_sess      uuid := gen_random_uuid();
  v_sess_rep  uuid := gen_random_uuid();
  v_sess_sw   uuid := gen_random_uuid();
  v_sess_swr  uuid := gen_random_uuid();
  v_ret       uuid;
  v_count     int;
  v_method    text;
  v_started   timestamptz;
  v_srv       timestamptz;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm663 smoke: clock_in_to_job idempotency SKIPPED — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug)
    values (v_org, 'm663 ci', 'm663-ci-' || replace(v_org::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role)
    values (v_contact, v_org, 'CI', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org, v_contact, 'water', '1 CI St', 'SMOKE-663-CI-1') returning id into v_job;
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org, v_contact, 'water', '2 CI St', 'SMOKE-663-CI-2') returning id into v_job2;

  -- ----- 3a. first clock-in opens the session: live, device time, audited -----
  v_ret := clock_in_to_job(v_sess, v_org, v_job, v_user,
                           '2026-06-19T12:00:00Z'::timestamptz, v_user, null, null, v_cap1);
  if v_ret <> v_sess then
    raise exception 'm663 smoke: first clock-in returned % (expected %)', v_ret, v_sess;
  end if;
  select capture_method, started_at, server_received_at
    into v_method, v_started, v_srv
    from public.time_sessions where id = v_sess;
  if v_method <> 'live' then
    raise exception 'm663 smoke: offline session capture_method % (expected live, AC3)', v_method;
  end if;
  if v_started is distinct from '2026-06-19T12:00:00Z'::timestamptz then
    raise exception 'm663 smoke: started_at % is not the device taken_at (AC4)', v_started;
  end if;
  if v_srv is null then
    raise exception 'm663 smoke: server_received_at was not stamped (AC4 audit)';
  end if;
  if v_started = v_srv then
    raise exception 'm663 smoke: server_received_at must be the server now(), not the device started_at (AC4)';
  end if;

  -- ----- 3b. replay (same cap, different proposed id) returns the ORIGINAL -----
  v_ret := clock_in_to_job(v_sess_rep, v_org, v_job, v_user,
                           '2026-06-19T12:00:00Z'::timestamptz, v_user, null, null, v_cap1);
  if v_ret <> v_sess then
    raise exception 'm663 smoke: clock-in replay returned % (expected original %)', v_ret, v_sess;
  end if;
  if exists (select 1 from public.time_sessions where id = v_sess_rep) then
    raise exception 'm663 smoke: clock-in replay inserted the new proposed session id';
  end if;
  select count(*) into v_count from public.time_sessions
    where organization_id = v_org and client_capture_id = v_cap1 and deleted_at is null;
  if v_count <> 1 then
    raise exception 'm663 smoke: clock-in replay produced % sessions (expected 1, AC2)', v_count;
  end if;
  select count(*) into v_count from public.time_session_events
    where time_session_id = v_sess and event_type = 'created';
  if v_count <> 1 then
    raise exception 'm663 smoke: clock-in replay wrote a second created event (% total)', v_count;
  end if;

  -- ----- 3c. job switch, then replay-of-switch: the prior session is closed
  --           ONCE, the replay returns the switched-in session and re-runs
  --           nothing (no re-close, no second created event) -----
  v_ret := clock_in_to_job(v_sess_sw, v_org, v_job2, v_user,
                           '2026-06-19T14:00:00Z'::timestamptz, v_user,
                           v_sess, '2026-06-19T14:00:00Z'::timestamptz, v_cap_sw);
  if v_ret <> v_sess_sw then
    raise exception 'm663 smoke: job-switch clock-in returned % (expected %)', v_ret, v_sess_sw;
  end if;
  if (select ended_at from public.time_sessions where id = v_sess)
       is distinct from '2026-06-19T14:00:00Z'::timestamptz then
    raise exception 'm663 smoke: job switch did not close the prior session at the device time';
  end if;

  v_ret := clock_in_to_job(v_sess_swr, v_org, v_job2, v_user,
                           '2026-06-19T14:00:00Z'::timestamptz, v_user,
                           v_sess, '2026-06-19T14:00:00Z'::timestamptz, v_cap_sw);
  if v_ret <> v_sess_sw then
    raise exception 'm663 smoke: switch replay returned % (expected switched-in %)', v_ret, v_sess_sw;
  end if;
  if exists (select 1 from public.time_sessions where id = v_sess_swr) then
    raise exception 'm663 smoke: switch replay inserted a new session id';
  end if;
  select count(*) into v_count from public.time_session_events
    where time_session_id = v_sess and event_type = 'clocked_out';
  if v_count <> 1 then
    raise exception 'm663 smoke: switch replay re-closed the prior session (% clocked_out events)', v_count;
  end if;
  select count(*) into v_count from public.time_session_events
    where time_session_id = v_sess_sw and event_type = 'created';
  if v_count <> 1 then
    raise exception 'm663 smoke: switch replay wrote a second created event (% total)', v_count;
  end if;

  raise notice 'm663 smoke: clock_in_to_job idempotency — first opens (live, device time, audited), replay returns original, switch closes once';
end $$;

-- ---------------------------------------------------------------------------
-- 4. clock_out_session idempotency (AC4/AC8). A clock-out closes at the device
--    ended_at and logs 'clocked_out' once; a replay with the SAME
--    client_capture_id is a no-op success (ended_at unchanged, no second event);
--    a late offline tap for a session ALREADY resolved by a lead's hand close
--    does NOT overwrite that close (AC8 — never auto-back-dates an already
--    resolved session); and a double clock-out WITHOUT a client_capture_id still
--    raises (slice-1 contract preserved).
-- ---------------------------------------------------------------------------
do $$
declare
  v_user     uuid;
  v_org      uuid := gen_random_uuid();
  v_contact  uuid := gen_random_uuid();
  v_job      uuid;
  v_sd       uuid := gen_random_uuid();   -- session that gets clocked out + replayed
  v_sd2      uuid := gen_random_uuid();   -- session a lead resolves, then a late tap hits
  v_cap_in   uuid := gen_random_uuid();
  v_cap_in2  uuid := gen_random_uuid();
  v_cap_out  uuid := gen_random_uuid();
  v_cap_late uuid := gen_random_uuid();
  v_count    int;
  v_ended    timestamptz;
  v_raised   boolean := false;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm663 smoke: clock_out_session idempotency SKIPPED — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug)
    values (v_org, 'm663 co', 'm663-co-' || replace(v_org::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role)
    values (v_contact, v_org, 'CO', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org, v_contact, 'water', '1 CO St', 'SMOKE-663-CO') returning id into v_job;

  perform clock_in_to_job(v_sd, v_org, v_job, v_user,
                          '2026-06-19T08:00:00Z'::timestamptz, v_user, null, null, v_cap_in);

  -- ----- 4a. clock-out closes at the device ended_at + logs 'clocked_out' once -----
  perform clock_out_session(v_sd, v_org, '2026-06-19T16:00:00Z'::timestamptz, v_user, v_cap_out);
  select ended_at into v_ended from public.time_sessions where id = v_sd;
  if v_ended is distinct from '2026-06-19T16:00:00Z'::timestamptz then
    raise exception 'm663 smoke: clock-out did not record the device ended_at (AC4), got %', v_ended;
  end if;
  select count(*) into v_count from public.time_session_events
    where time_session_id = v_sd and event_type = 'clocked_out';
  if v_count <> 1 then
    raise exception 'm663 smoke: clock-out wrote % clocked_out events (expected 1)', v_count;
  end if;

  -- ----- 4b. replay (same cap, different ended_at) is a no-op success -----
  perform clock_out_session(v_sd, v_org, '2026-06-19T19:00:00Z'::timestamptz, v_user, v_cap_out);
  select ended_at into v_ended from public.time_sessions where id = v_sd;
  if v_ended is distinct from '2026-06-19T16:00:00Z'::timestamptz then
    raise exception 'm663 smoke: clock-out replay OVERWROTE ended_at (AC8), got %', v_ended;
  end if;
  select count(*) into v_count from public.time_session_events
    where time_session_id = v_sd and event_type = 'clocked_out';
  if v_count <> 1 then
    raise exception 'm663 smoke: clock-out replay wrote a second clocked_out event (% total)', v_count;
  end if;

  -- ----- 4c. a late offline tap for a session a lead already closed by hand
  --           must NOT overwrite the lead's close (AC8) -----
  perform clock_in_to_job(v_sd2, v_org, v_job, v_user,
                          '2026-06-19T09:00:00Z'::timestamptz, v_user, null, null, v_cap_in2);
  -- lead/admin closes it by hand (no client_capture_id)
  perform clock_out_session(v_sd2, v_org, '2026-06-19T17:00:00Z'::timestamptz, v_user);
  -- a late offline clock-out tap (its own cap) arrives for that same session
  perform clock_out_session(v_sd2, v_org, '2026-06-19T23:00:00Z'::timestamptz, v_user, v_cap_late);
  select ended_at into v_ended from public.time_sessions where id = v_sd2;
  if v_ended is distinct from '2026-06-19T17:00:00Z'::timestamptz then
    raise exception 'm663 smoke: a late offline tap overwrote an already-resolved session (AC8), got %', v_ended;
  end if;

  -- ----- 4d. a double clock-out WITHOUT a client_capture_id still raises -----
  begin
    perform clock_out_session(v_sd, v_org, '2026-06-19T20:00:00Z'::timestamptz, v_user);
  exception when raise_exception then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'm663 smoke: a no-capture double clock-out did NOT raise (slice-1 contract lost)';
  end if;

  raise notice 'm663 smoke: clock_out_session idempotency — closes at device time, replay no-op, late tap preserves prior close, no-cap double raises';
end $$;

rollback;

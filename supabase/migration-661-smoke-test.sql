-- issue #701 (parent epic #699) — Time sessions foundation smoke test.
--
-- Purpose:   Self-checking script that verifies migration-661's schema
--            invariants and the clock-in / clock-out RPCs. NOT part of the
--            migration. Wrapped in begin; ... rollback; so the database is
--            unchanged on a clean run. Every assertion raises on failure; a
--            clean run prints only NOTICE lines.
--
-- Preconditions: migration-661 has been applied. Sections that need a real
--            worker (the worker-XOR "both" case, the one-open-per-user index,
--            and the RPCs) pick any existing auth.users row and skip
--            themselves if the database has no users.
--
-- Run:       psql -f supabase/migration-661-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. Both tables exist with expected columns.
--   2. capture_method accepts 'live' / 'hand', rejects anything else.
--   3. Worker XOR: app-User-only OK, off-app-only OK, both rejected, neither
--      rejected.
--   4. ended_at must be NULL or strictly after started_at.
--   5. event_type accepts all five values, rejects others.
--   6. One Open session per app User (partial unique index); off-app rows are
--      exempt (multiple Open off-app sessions allowed).
--   7. clock_in_to_job logs 'created' and opens; clock_out_session closes and
--      logs 'clocked_out'; a Job switch closes the prior session first; a
--      double clock-out raises. The 'created' / 'clocked_out' events carry
--      {field, old, new} metadata (started_at / ended_at, old null).
--   8. time_session_events is append-only (RLS on; SELECT + INSERT policies
--      only, no UPDATE / DELETE policy).
--   9. time_sessions carries an org-isolation RLS policy.
--  10. RLS behavior: a cross-Organization INSERT is denied, and a caller sees
--      only its own Organization's time_sessions and time_session_events.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables and key columns exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(missing_col, ', ')
    into v_missing
  from (
    select 'time_sessions.' || col as missing_col
      from unnest(array[
        'id', 'organization_id', 'job_id', 'user_id', 'off_app_worker_name',
        'started_at', 'ended_at', 'capture_method', 'created_by',
        'created_at', 'updated_at', 'deleted_at'
      ]) as col
     where not exists (
       select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'time_sessions'
          and column_name = col
     )
    union all
    select 'time_session_events.' || col
      from unnest(array[
        'id', 'organization_id', 'time_session_id', 'event_type',
        'actor', 'metadata', 'created_at'
      ]) as col
     where not exists (
       select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'time_session_events'
          and column_name = col
     )
  ) m;

  if v_missing is not null then
    raise exception 'migration-661 smoke: missing column(s): %', v_missing;
  end if;
  raise notice 'migration-661 smoke: tables + columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Constraint + behavior tests. One do-block so locally declared ids stay
--    in scope. Everything rolls back at the end.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id          uuid := gen_random_uuid();
  v_contact_id      uuid := gen_random_uuid();
  v_job_id          uuid;
  v_user_id         uuid;
  v_have_real_user  boolean;
  v_sess            uuid;
  v_sess_a          uuid := gen_random_uuid();
  v_sess_b          uuid := gen_random_uuid();
  v_ended           timestamptz;
  v_method          text;
  v_count           int;
  v_meta            jsonb;
begin
  select id into v_user_id from auth.users limit 1;
  v_have_real_user := v_user_id is not null;

  -- Tenant scaffolding: org → contact → job. An explicit job_number keeps the
  -- set_job_number trigger from touching the per-org counter table.
  insert into public.organizations (id, name, slug)
    values (v_org_id, 'm661 smoke', 'm661-smoke-' || replace(v_org_id::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role)
    values (v_contact_id, v_org_id, 'Homeowner A', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_id, v_contact_id, 'water', '1 Maple St', 'SMOKE-661')
    returning id into v_job_id;

  -- ----- 2a. capture_method check (off-app worker so no real user needed) ---
  begin
    insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method)
      values (v_org_id, v_job_id, 'Day Laborer', 'gps');
    raise exception 'm661 smoke: capture_method accepted invalid value "gps"';
  exception when check_violation then null;
  end;

  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method)
    values (v_org_id, v_job_id, 'Day Laborer', 'live'), (v_org_id, v_job_id, 'Day Laborer', 'hand');
  delete from public.time_sessions where organization_id = v_org_id;
  raise notice 'm661 smoke: capture_method — accepts live/hand, rejects "gps"';

  -- ----- 2b. Worker XOR -----
  -- off-app only: OK
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method)
    values (v_org_id, v_job_id, 'Off App Only', 'hand');
  -- neither worker: rejected
  begin
    insert into public.time_sessions (organization_id, job_id, capture_method)
      values (v_org_id, v_job_id, 'hand');
    raise exception 'm661 smoke: worker XOR accepted a row with NEITHER user_id nor off_app_worker_name';
  exception when check_violation then null;
  end;

  if v_have_real_user then
    -- app User only: OK
    insert into public.time_sessions (organization_id, job_id, user_id, capture_method)
      values (v_org_id, v_job_id, v_user_id, 'live');
    -- both: rejected
    begin
      insert into public.time_sessions (organization_id, job_id, user_id, off_app_worker_name, capture_method)
        values (v_org_id, v_job_id, v_user_id, 'Both', 'live');
      raise exception 'm661 smoke: worker XOR accepted a row with BOTH user_id and off_app_worker_name';
    exception when check_violation then null;
    end;
    raise notice 'm661 smoke: worker XOR — user-only OK, off-app-only OK, both rejected, neither rejected';
  else
    raise notice 'm661 smoke: worker XOR — off-app-only OK, neither rejected (user-only / both skipped: no auth.users row)';
  end if;
  delete from public.time_sessions where organization_id = v_org_id;

  -- ----- 2c. ended_at must be NULL or strictly after started_at -----
  begin  -- zero-length
    insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, started_at, ended_at)
      values (v_org_id, v_job_id, 'Span', 'hand', '2026-06-19T12:00:00Z', '2026-06-19T12:00:00Z');
    raise exception 'm661 smoke: ended_at check accepted a zero-length span';
  exception when check_violation then null;
  end;
  begin  -- negative
    insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, started_at, ended_at)
      values (v_org_id, v_job_id, 'Span', 'hand', '2026-06-19T13:00:00Z', '2026-06-19T12:00:00Z');
    raise exception 'm661 smoke: ended_at check accepted a negative span';
  exception when check_violation then null;
  end;
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, started_at, ended_at)
    values (v_org_id, v_job_id, 'Span', 'hand', '2026-06-19T12:00:00Z', '2026-06-19T13:00:00Z'); -- positive OK
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method, started_at)
    values (v_org_id, v_job_id, 'Span', 'hand', '2026-06-19T12:00:00Z'); -- Open (NULL) OK
  delete from public.time_sessions where organization_id = v_org_id;
  raise notice 'm661 smoke: ended_at — rejects zero-length and negative, accepts positive and Open(NULL)';

  -- ----- 2d. event_type check (needs a session for the FK) -----
  insert into public.time_sessions (id, organization_id, job_id, off_app_worker_name, capture_method)
    values (gen_random_uuid(), v_org_id, v_job_id, 'Evt', 'hand')
    returning id into v_sess;
  begin
    insert into public.time_session_events (organization_id, time_session_id, event_type)
      values (v_org_id, v_sess, 'bogus');
    raise exception 'm661 smoke: event_type accepted invalid value "bogus"';
  exception when check_violation then null;
  end;
  insert into public.time_session_events (organization_id, time_session_id, event_type)
    values
      (v_org_id, v_sess, 'created'),
      (v_org_id, v_sess, 'clocked_out'),
      (v_org_id, v_sess, 'corrected'),
      (v_org_id, v_sess, 'deleted'),
      (v_org_id, v_sess, 'off_app_added');
  delete from public.time_sessions where organization_id = v_org_id;  -- cascades events
  raise notice 'm661 smoke: event_type — accepts all 5 values, rejects "bogus"';

  -- ----- 2e. One Open session per app User; off-app exempt -----
  -- Off-app: two Open rows allowed (user_id NULL excluded from the index).
  insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method)
    values (v_org_id, v_job_id, 'Open A', 'hand'), (v_org_id, v_job_id, 'Open B', 'hand');
  select count(*) into v_count from public.time_sessions
    where organization_id = v_org_id and ended_at is null;
  if v_count <> 2 then
    raise exception 'm661 smoke: expected 2 Open off-app sessions, found %', v_count;
  end if;
  delete from public.time_sessions where organization_id = v_org_id;

  if v_have_real_user then
    insert into public.time_sessions (id, organization_id, job_id, user_id, capture_method)
      values (v_sess_a, v_org_id, v_job_id, v_user_id, 'live');
    begin  -- a second Open session for the same User must violate the index
      insert into public.time_sessions (organization_id, job_id, user_id, capture_method)
        values (v_org_id, v_job_id, v_user_id, 'live');
      raise exception 'm661 smoke: one-open-per-user index allowed a SECOND Open session';
    exception when unique_violation then null;
    end;
    -- Closing the first frees the slot for a new Open session. ended_at must be
    -- strictly after started_at; now() is transaction-stable (it equals the
    -- session's now()-defaulted started_at within this begin/rollback), so push
    -- it forward by an interval rather than reusing the identical instant.
    update public.time_sessions set ended_at = now() + interval '1 hour' where id = v_sess_a;
    insert into public.time_sessions (organization_id, job_id, user_id, capture_method)
      values (v_org_id, v_job_id, v_user_id, 'live');
    delete from public.time_sessions where organization_id = v_org_id;
    raise notice 'm661 smoke: one-open-per-user — second Open rejected, allowed again after close';
  else
    raise notice 'm661 smoke: one-open-per-user (app User) skipped — no auth.users row; off-app exemption verified';
  end if;

  -- ----- 2f. RPCs: clock_in_to_job / clock_out_session / switch -----
  if v_have_real_user then
    v_sess_a := gen_random_uuid();
    perform clock_in_to_job(
      v_sess_a, v_org_id, v_job_id, v_user_id, '2026-06-19T12:00:00Z'::timestamptz, v_user_id);
    select ended_at, capture_method into v_ended, v_method
      from public.time_sessions where id = v_sess_a;
    if v_ended is not null then
      raise exception 'm661 smoke: clock_in_to_job left the session closed (ended_at set)';
    end if;
    if v_method <> 'live' then
      raise exception 'm661 smoke: clock_in_to_job recorded capture_method % (expected live)', v_method;
    end if;
    select count(*) into v_count from public.time_session_events
      where time_session_id = v_sess_a and event_type = 'created';
    if v_count <> 1 then
      raise exception 'm661 smoke: clock_in_to_job wrote % "created" events (expected 1)', v_count;
    end if;
    -- The 'created' event carries {field:'started_at', old:null, new:<started_at>}.
    select metadata into v_meta from public.time_session_events
      where time_session_id = v_sess_a and event_type = 'created';
    if v_meta->>'field' is distinct from 'started_at'
       or v_meta->'old' is distinct from 'null'::jsonb
       or (v_meta->>'new')::timestamptz is distinct from '2026-06-19T12:00:00Z'::timestamptz then
      raise exception 'm661 smoke: "created" event metadata is not {field:started_at, old:null, new:<started_at>}: %', v_meta;
    end if;

    perform clock_out_session(v_sess_a, v_org_id, '2026-06-19T15:00:00Z'::timestamptz, v_user_id);
    select ended_at into v_ended from public.time_sessions where id = v_sess_a;
    if v_ended is distinct from '2026-06-19T15:00:00Z'::timestamptz then
      raise exception 'm661 smoke: clock_out_session did not set ended_at (got %)', v_ended;
    end if;
    select count(*) into v_count from public.time_session_events
      where time_session_id = v_sess_a and event_type = 'clocked_out';
    if v_count <> 1 then
      raise exception 'm661 smoke: clock_out_session wrote % "clocked_out" events (expected 1)', v_count;
    end if;
    -- The 'clocked_out' event carries {field:'ended_at', old:null, new:<ended_at>}.
    select metadata into v_meta from public.time_session_events
      where time_session_id = v_sess_a and event_type = 'clocked_out';
    if v_meta->>'field' is distinct from 'ended_at'
       or v_meta->'old' is distinct from 'null'::jsonb
       or (v_meta->>'new')::timestamptz is distinct from '2026-06-19T15:00:00Z'::timestamptz then
      raise exception 'm661 smoke: "clocked_out" event metadata is not {field:ended_at, old:null, new:<ended_at>}: %', v_meta;
    end if;

    begin  -- double clock-out must raise (session no longer Open)
      perform clock_out_session(v_sess_a, v_org_id, '2026-06-19T16:00:00Z'::timestamptz, v_user_id);
      raise exception 'm661 smoke: a double clock-out did NOT raise';
    exception
      when raise_exception then null;  -- expected
    end;

    -- Switch: open A, then clock in to a Job with p_close_session_id => A.
    delete from public.time_sessions where organization_id = v_org_id;
    v_sess_a := gen_random_uuid();
    v_sess_b := gen_random_uuid();
    perform clock_in_to_job(
      v_sess_a, v_org_id, v_job_id, v_user_id, '2026-06-19T12:00:00Z'::timestamptz, v_user_id);
    perform clock_in_to_job(
      v_sess_b, v_org_id, v_job_id, v_user_id, '2026-06-19T14:00:00Z'::timestamptz, v_user_id,
      v_sess_a, '2026-06-19T14:00:00Z'::timestamptz);

    select ended_at into v_ended from public.time_sessions where id = v_sess_a;
    if v_ended is distinct from '2026-06-19T14:00:00Z'::timestamptz then
      raise exception 'm661 smoke: switch did not auto-close the prior session (ended_at %)', v_ended;
    end if;
    select ended_at into v_ended from public.time_sessions where id = v_sess_b;
    if v_ended is not null then
      raise exception 'm661 smoke: switch left the new session closed';
    end if;
    select count(*) into v_count from public.time_session_events
      where time_session_id = v_sess_a and event_type = 'clocked_out';
    if v_count <> 1 then
      raise exception 'm661 smoke: switch wrote % "clocked_out" events on prior session (expected 1)', v_count;
    end if;
    select count(*) into v_count from public.time_session_events
      where time_session_id = v_sess_b and event_type = 'created';
    if v_count <> 1 then
      raise exception 'm661 smoke: switch wrote % "created" events on new session (expected 1)', v_count;
    end if;
    raise notice 'm661 smoke: RPCs — clock-in opens + logs created, clock-out closes + logs clocked_out, switch auto-closes prior, double clock-out raises';
  else
    raise notice 'm661 smoke: RPC checks skipped — no auth.users row available';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Append-only: time_session_events has RLS on and only SELECT + INSERT
--    policies (no UPDATE / DELETE policy => those commands are denied).
-- ---------------------------------------------------------------------------
do $$
declare
  v_rls_on      boolean;
  v_write_pols  text;
begin
  select relrowsecurity into v_rls_on
    from pg_class where oid = 'public.time_session_events'::regclass;
  if not coalesce(v_rls_on, false) then
    raise exception 'm661 smoke: RLS is not enabled on time_session_events';
  end if;

  -- polcmd 'w' = UPDATE, 'd' = DELETE, '*' = ALL. Any of these breaks append-only.
  -- polcmd is the internal "char" type; cast so the || operator is unambiguous.
  select string_agg(polname || '(' || polcmd::text || ')', ', ')
    into v_write_pols
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'time_session_events'
    and p.polcmd in ('w', 'd', '*');

  if v_write_pols is not null then
    raise exception 'm661 smoke: time_session_events is not append-only — found mutating policy(ies): %', v_write_pols;
  end if;
  raise notice 'm661 smoke: time_session_events is append-only (RLS on; no UPDATE/DELETE/ALL policy)';
end $$;

-- ---------------------------------------------------------------------------
-- 4. time_sessions carries an org-isolation RLS policy.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy text;
begin
  select string_agg(polname, ', ')
    into v_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'time_sessions'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%active_organization_id%';

  if v_policy is null then
    raise exception 'm661 smoke: time_sessions has no org-isolation RLS policy';
  end if;
  raise notice 'm661 smoke: time_sessions org-isolation policy present (%)', v_policy;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS behavior — a cross-Organization INSERT is denied (AC #5). The caller
--    is active in org B but the proposed row belongs to org A; the WITH CHECK
--    (organization_id = nookleus.active_organization_id()) fails. An off-app
--    session (user_id NULL) needs no auth.users row, so this runs always.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a     uuid := '66000000-0000-0000-0000-0000000000a1';
  v_org_b     uuid := '66000000-0000-0000-0000-0000000000b1';
  v_contact_a uuid := '66000000-0000-0000-0000-0000000000c1';
  v_job_a     uuid;
  v_blocked   boolean := false;
begin
  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm661 rls A', 'm661-rls-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm661 rls B', 'm661-rls-b-' || replace(v_org_b::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role)
    values (v_contact_a, v_org_a, 'RLS A', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_a, v_contact_a, 'water', '1 RLS St', 'SMOKE-661-RLS-A')
    returning id into v_job_a;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"66000000-0000-0000-0000-0000000000f1","active_organization_id":"66000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
  begin
    insert into public.time_sessions (organization_id, job_id, off_app_worker_name, capture_method)
      values (v_org_a, v_job_a, 'Cross Org', 'hand');
  exception when insufficient_privilege then v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'm661 smoke: cross-org INSERT into another Organization was NOT denied';
  end if;
  raise notice 'm661 smoke: RLS — cross-org INSERT denied';
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS behavior — a caller sees only its OWN Organization's time_sessions
--    and time_session_events (AC #5). Needs a real auth.users row for the
--    membership EXISTS check, so it skips itself when the database has none.
--    Sessions are seeded off-app (user_id NULL) under owner bypass, then read
--    back as an authenticated member of org A.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_a     uuid := '66000000-0000-0000-0000-0000000000a2';
  v_org_b     uuid := '66000000-0000-0000-0000-0000000000b2';
  v_contact_a uuid := '66000000-0000-0000-0000-0000000000c2';
  v_contact_b uuid := '66000000-0000-0000-0000-0000000000c3';
  v_job_a     uuid;
  v_job_b     uuid;
  v_user      uuid;
  v_s_a       uuid := gen_random_uuid();
  v_s_b       uuid := gen_random_uuid();
  v_count     bigint;
  v_orgs      uuid[];
  v_evt_count bigint;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice 'm661 smoke: RLS own-org visibility skipped — no auth.users row';
    return;
  end if;

  insert into public.organizations (id, name, slug) values
    (v_org_a, 'm661 vis A', 'm661-vis-a-' || replace(v_org_a::text, '-', '')),
    (v_org_b, 'm661 vis B', 'm661-vis-b-' || replace(v_org_b::text, '-', ''));
  insert into public.contacts (id, organization_id, full_name, role) values
    (v_contact_a, v_org_a, 'Vis A', 'homeowner'),
    (v_contact_b, v_org_b, 'Vis B', 'homeowner');
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_a, v_contact_a, 'water', '1 Vis St', 'SMOKE-661-VIS-A') returning id into v_job_a;
  insert into public.jobs (organization_id, contact_id, damage_type, property_address, job_number)
    values (v_org_b, v_contact_b, 'water', '2 Vis St', 'SMOKE-661-VIS-B') returning id into v_job_b;

  -- The caller is a member of org A only.
  insert into public.user_organizations (user_id, organization_id, role)
    values (v_user, v_org_a, 'crew_member');

  -- One session + one event in each org (owner bypass; off-app rows).
  insert into public.time_sessions (id, organization_id, job_id, off_app_worker_name, capture_method)
    values (v_s_a, v_org_a, v_job_a, 'Vis A', 'hand'),
           (v_s_b, v_org_b, v_job_b, 'Vis B', 'hand');
  insert into public.time_session_events (organization_id, time_session_id, event_type)
    values (v_org_a, v_s_a, 'created'),
           (v_org_b, v_s_b, 'created');

  -- Read back as the org-A member. (Capture under RLS, reset, then assert.)
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'active_organization_id', v_org_a::text, 'role', 'authenticated')::text,
    true);

  select count(*), array_agg(distinct organization_id) into v_count, v_orgs from public.time_sessions;
  select count(*) into v_evt_count from public.time_session_events;

  reset role;

  if v_count <> 1 or v_orgs is distinct from array[v_org_a] then
    raise exception 'm661 smoke: RLS own-org visibility — org-A caller saw % time_sessions (orgs=%); expected only org A''s 1', v_count, v_orgs;
  end if;
  if v_evt_count <> 1 then
    raise exception 'm661 smoke: RLS own-org visibility — org-A caller saw % time_session_events; expected only org A''s 1', v_evt_count;
  end if;
  raise notice 'm661 smoke: RLS — caller sees only own-org time_sessions + time_session_events';
end $$;

rollback;

-- issue #702 (parent epic #699): Offline-resilient clock-in & self-nudges.
--
-- Slice 2 of per-Job timesheets. Makes the clock-in / clock-out path survive
-- being tapped OFFLINE. A tap is enqueued on the device with a client-generated
-- client_capture_id and a device-stamped taken_at, and the queue drains once
-- the network is confirmed online (src/lib/mobile/clock-event-queue.ts, the
-- sibling of the photo UploadQueueWorker). This migration gives the server the
-- two columns that path needs, plus the idempotency index and the conflict-
-- resolution path in the RPCs.
--
--   client_capture_id   — the idempotency key. Replaying the same tap (a queue
--                         retry, an app restart mid-sync) must yield exactly
--                         ONE session, enforced by a partial unique index on
--                         (organization_id, client_capture_id) and a matching
--                         conflict-resolution path in clock_in_to_job /
--                         clock_out_session.
--   server_received_at  — audit only. The instant the server received the tap.
--                         It NEVER substitutes for the worker's device
--                         taken_at: started_at / ended_at stay device time
--                         (AC4). It exists only so the gap between "tapped" and
--                         "reached the server" is observable for a late offline
--                         sync.
--
-- Device time is authoritative (ADR 0023): the recorded session times are
-- always the worker's device taken_at, online or offline. This deliberately
-- revises the slice-1 "never trust a client clock" stance FOR THE TAP INSTANT
-- ONLY. Downstream classification against the one Organization timezone
-- (ADR 0020) is unchanged and still server-side — taken_at is just the tap
-- instant, not a classification input.
--
-- Live capture (AC3): the offline path still records capture_method = 'live'
-- (clock_in_to_job hardcodes it), so an offline-synced session stays distinct
-- from a hand-entered lead/admin Correction.
--
-- No location (ADR 0019): this migration adds NO lat/long/geofence/region/
-- coordinate column. The offline path carries none.
--
-- Cross-org isolation (AC9): the unique index is on (organization_id,
-- client_capture_id), so the same client_capture_id under two Orgs is two
-- distinct rows — a clock event in one Org can never collide with another's.
--
-- Depends on: migration-661-time-sessions.sql.
-- Smoke test: supabase/migration-663-smoke-test.sql.
-- Revert:     see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. Columns: idempotency key + audit-only server receive time.
-- ---------------------------------------------------------------------------
alter table public.time_sessions
  add column if not exists client_capture_id  uuid,
  add column if not exists server_received_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Idempotency index: at most one session per (org, client_capture_id).
--    PARTIAL is mandatory — legacy rows (client_capture_id NULL: every slice-1
--    session, and every online tap that doesn't ride the queue) and
--    soft-deleted rows are exempt; only live offline-path rows are constrained.
--    Keyed on organization_id first so the same client_capture_id under two
--    Orgs never collides (AC9).
-- ---------------------------------------------------------------------------
create unique index if not exists uniq_time_sessions_org_client_capture
  on public.time_sessions (organization_id, client_capture_id)
  where client_capture_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Idempotent clock-in. Replaces migration-661's clock_in_to_job, adding a
--    trailing p_client_capture_id (default null) so existing positional callers
--    and the slice-1 smoke test keep working unchanged. The arg list grows, so
--    this is a drop + create (create-or-replace cannot change the signature).
--
--    With a client_capture_id (the offline path) the call is idempotent: a
--    replay of the same tap returns the ORIGINAL session and does nothing else
--    — no second session, no second 'created' event, and no re-running of the
--    job-switch close (AC2). Without one (online / legacy) the behavior is the
--    slice-1 behavior unchanged.
--
--    Device time is authoritative (AC4): started_at is the device taken_at the
--    caller passes; server_received_at is stamped now() as audit only and never
--    substitutes for it. capture_method stays 'live' (AC3).
-- ---------------------------------------------------------------------------
drop function if exists clock_in_to_job(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, timestamptz);
create function clock_in_to_job(
  p_session_id        uuid,
  p_organization_id   uuid,
  p_job_id            uuid,
  p_user_id           uuid,
  p_started_at        timestamptz,
  p_actor             uuid,
  p_close_session_id  uuid default null,
  p_close_ended_at    timestamptz default null,
  p_client_capture_id uuid default null
) returns uuid as $$
declare
  v_existing uuid;
begin
  -- Idempotency short-circuit: if this exact tap already opened a session,
  -- return THAT session and do nothing else — no second insert, no second
  -- 'created' event, and crucially no re-running of the job-switch close.
  if p_client_capture_id is not null then
    select id into v_existing from public.time_sessions
      where organization_id = p_organization_id
        and client_capture_id = p_client_capture_id
        and deleted_at is null;
    if found then return v_existing; end if;
  end if;

  if p_close_session_id is not null then
    update public.time_sessions
       set ended_at = p_close_ended_at
     where id = p_close_session_id and ended_at is null;
    if found then
      insert into public.time_session_events
        (organization_id, time_session_id, event_type, actor, metadata)
        values (p_organization_id, p_close_session_id, 'clocked_out', p_actor,
                jsonb_build_object('field', 'ended_at', 'old', null, 'new', p_close_ended_at));
    end if;
  end if;

  insert into public.time_sessions
    (id, organization_id, job_id, user_id, started_at, capture_method, created_by,
     client_capture_id, server_received_at)
    values
    (p_session_id, p_organization_id, p_job_id, p_user_id, p_started_at, 'live', p_actor,
     p_client_capture_id, now())
    on conflict (organization_id, client_capture_id)
      where client_capture_id is not null and deleted_at is null
      do nothing;

  if not found then
    -- Lost a concurrent race for the same client_capture_id: the other call
    -- inserted first. Return its session id (idempotent), having logged nothing.
    select id into p_session_id from public.time_sessions
      where organization_id = p_organization_id
        and client_capture_id = p_client_capture_id
        and deleted_at is null;
    return p_session_id;
  end if;

  insert into public.time_session_events
    (organization_id, time_session_id, event_type, actor, metadata)
    values (p_organization_id, p_session_id, 'created', p_actor,
            jsonb_build_object('field', 'started_at', 'old', null, 'new', p_started_at));

  return p_session_id;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 4. Idempotent clock-out. Replaces migration-661's clock_out_session, adding a
--    trailing p_client_capture_id (default null).
--
--    With a client_capture_id (the offline path) a replay of the same clock-out
--    tap is a no-op success: the matching 'clocked_out' event short-circuits a
--    second close. And a late tap arriving after the session was ALREADY
--    resolved — by an earlier sync of this same tap or by a lead/admin
--    Correction — must NOT reopen, overwrite, or back-date it (AC8); it just
--    succeeds. Without a client_capture_id the slice-1 contract holds: a double
--    clock-out is a loud error.
--
--    ended_at is the device taken_at (AC4).
-- ---------------------------------------------------------------------------
drop function if exists clock_out_session(uuid, uuid, timestamptz, uuid);
create function clock_out_session(
  p_session_id        uuid,
  p_organization_id   uuid,
  p_ended_at          timestamptz,
  p_actor             uuid,
  p_client_capture_id uuid default null
) returns void as $$
begin
  -- Replay short-circuit: this exact clock-out tap already closed the session.
  if p_client_capture_id is not null
     and exists (
       select 1 from public.time_session_events
        where time_session_id = p_session_id
          and event_type = 'clocked_out'
          and metadata->>'client_capture_id' = p_client_capture_id::text
     ) then
    return;
  end if;

  update public.time_sessions
     set ended_at = p_ended_at
   where id = p_session_id and ended_at is null;

  if not found then
    -- Session isn't Open. On the offline path (a client_capture_id is present)
    -- this is a late replay against an already-resolved session — succeed as a
    -- no-op rather than reopening or back-dating it (AC8). Off the offline path
    -- it is a genuine double clock-out: raise, as in slice-1.
    if p_client_capture_id is not null then return; end if;
    raise exception 'time session % is not open', p_session_id;
  end if;

  insert into public.time_session_events
    (organization_id, time_session_id, event_type, actor, metadata)
    values (p_organization_id, p_session_id, 'clocked_out', p_actor,
            jsonb_build_object('field', 'ended_at', 'old', null, 'new', p_ended_at,
                               'client_capture_id', p_client_capture_id));
end;
$$ language plpgsql;

-- ROLLBACK ---
-- -- Restore migration-661's RPC signatures + bodies (idempotency removed):
-- drop function if exists clock_out_session(uuid, uuid, timestamptz, uuid, uuid);
-- drop function if exists clock_in_to_job(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, timestamptz, uuid);
-- --   then re-run the clock_in_to_job / clock_out_session definitions from
-- --   migration-661-time-sessions.sql.
-- drop index if exists public.uniq_time_sessions_org_client_capture;
-- alter table public.time_sessions
--   drop column if exists server_received_at,
--   drop column if exists client_capture_id;

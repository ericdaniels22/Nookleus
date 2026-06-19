-- issue #701 (parent epic #699): Time sessions — Clock in / Clock out of a Job.
--
-- The foundation slice of per-Job timesheets. Two tables:
--   time_sessions        — one row per stretch a worker is (or was) On the
--                           clock for a Job. ended_at IS NULL means the
--                           session is still Open (the worker is clocked in).
--   time_session_events  — append-only audit trail; one row per thing that
--                           happened to a session (clock-in, clock-out,
--                           correction, delete, off-app add).
--
-- Worker identity:  A session's worker is EITHER an app User (user_id) OR an
--                   off-app name (off_app_worker_name) — never both, never
--                   neither. The chk_time_sessions_worker_xor constraint pins
--                   this. Off-app workers are hand-entered by a teammate; they
--                   have no login, so they never hold an Open live session in
--                   practice (the one-open-session index below only constrains
--                   app Users).
--
-- One Job at a time:  An app User can have at most one Open session across the
--                   whole org. The partial unique index
--                   uniq_time_sessions_one_open_per_user pins this at the
--                   database; src/lib/session-lifecycle.ts keeps the app from
--                   ever asking the database to break it (auto-closing the
--                   prior session when a worker clocks in to a different Job).
--
-- No location (ADR 0019):  we deliberately do NOT store GPS / lat-long. Hours
--                   are recorded in UTC (ADR 0020) — every timestamptz here is
--                   a UTC instant; local display is the UI's job.
--
-- Own-hours visibility:  RLS here is the org-isolation backstop only
--                   (tenant_isolation_*, the same shape as jobs / contacts).
--                   "A worker sees only their OWN hours" is enforced one layer
--                   up — the recorded-hours query filters user_id = the caller
--                   — so that admins / crew_leads can be granted broader
--                   visibility later (parent epic #699) without a policy
--                   rewrite. The granular `track_time` permission that gates
--                   clock-in lives in our own tables, not the JWT, so RLS
--                   cannot see it; the Route Handlers enforce it.
--
-- Append-only audit:  time_session_events carries SELECT + INSERT policies and
--                   nothing else. With RLS enabled and no UPDATE / DELETE
--                   policy, those commands are denied — the trail can only grow
--                   (the same enforcement contract_events relies on).
--
-- Atomic transitions:  clock_in_to_job() and clock_out_session() wrap the
--                   session write and its audit event in one statement each so
--                   a partial failure can't leave a session without its event
--                   (mirrors the contracts RPCs in migration-build33). The app
--                   decides WHICH transition to run (session-lifecycle.ts); the
--                   RPC just performs the decided writes atomically, including
--                   auto-closing a prior session on a Job switch.
--
-- Depends on: schema.sql (organizations, user_organizations,
--             nookleus.active_organization_id(), update_updated_at()), jobs,
--             auth.users.
--
-- Smoke test: supabase/migration-661-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. time_sessions — one stretch On the clock for a Job.
-- ---------------------------------------------------------------------------
create table if not exists public.time_sessions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  job_id              uuid not null references public.jobs(id) on delete cascade,
  -- The worker: an app User (user_id) XOR an off-app name. RESTRICT on user_id
  -- so a User who has recorded hours can't be hard-deleted out from under the
  -- payroll record (same call as referral_partner_calls.user_id).
  user_id             uuid references auth.users(id) on delete restrict,
  off_app_worker_name text,
  started_at          timestamptz not null default now(),
  -- NULL → Open (worker is clocked in). A non-NULL ended_at must be strictly
  -- after started_at — the database backstop for validateSpan() in
  -- session-lifecycle.ts (no zero-length or negative sessions).
  ended_at            timestamptz,
  capture_method      text not null
                        check (capture_method in ('live', 'hand')),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint chk_time_sessions_worker_xor check (
    (user_id is not null and off_app_worker_name is null)
    or (user_id is null and off_app_worker_name is not null)
  ),
  constraint chk_time_sessions_ended_after_started check (
    ended_at is null or ended_at > started_at
  )
);

-- Org-scoped list + soft-delete filter (Job detail Time tab, recorded-hours).
create index if not exists idx_time_sessions_org
  on public.time_sessions (organization_id, deleted_at);

-- Sessions for one Job, newest first (Job detail Time tab).
create index if not exists idx_time_sessions_job
  on public.time_sessions (job_id, started_at desc)
  where deleted_at is null;

-- A worker's own sessions, newest first (own recorded-hours, recently-clocked
-- ranking in the active-Job picker).
create index if not exists idx_time_sessions_user_recent
  on public.time_sessions (organization_id, user_id, started_at desc)
  where deleted_at is null and user_id is not null;

-- The invariant: at most one Open session per app User, org-wide. Off-app rows
-- (user_id IS NULL) are exempt — they are hand-entered, not live.
create unique index if not exists uniq_time_sessions_one_open_per_user
  on public.time_sessions (organization_id, user_id)
  where ended_at is null and deleted_at is null and user_id is not null;

create trigger trg_time_sessions_updated_at
  before update on public.time_sessions
  for each row execute function update_updated_at();

alter table public.time_sessions enable row level security;

-- Org-isolation backstop. Own-hours filtering + track_time gating are
-- app-layer (see header).
create policy tenant_isolation_time_sessions
  on public.time_sessions for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = time_sessions.organization_id
    )
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = time_sessions.organization_id
    )
  );

-- ---------------------------------------------------------------------------
-- 2. time_session_events — append-only audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.time_session_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  time_session_id   uuid not null references public.time_sessions(id) on delete cascade,
  event_type        text not null
                      check (event_type in (
                        'created',
                        'clocked_out',
                        'corrected',
                        'deleted',
                        'off_app_added'
                      )),
  -- Who performed the action. SET NULL so the trail survives the actor's
  -- account being removed.
  actor             uuid references auth.users(id) on delete set null,
  -- Every event records the field it set as { field, old, new }: a 'created'
  -- carries the started_at it set (old null), a 'clocked_out' the ended_at it
  -- set (old null), a 'corrected' the before/after of the edited field.
  metadata          jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_time_session_events_session
  on public.time_session_events (time_session_id, created_at desc);

create index if not exists idx_time_session_events_org
  on public.time_session_events (organization_id);

alter table public.time_session_events enable row level security;

-- Append-only: SELECT + INSERT only. No UPDATE / DELETE policy, so with RLS on
-- those commands are denied and the trail can only grow.
create policy tenant_isolation_time_session_events_select
  on public.time_session_events for select to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = time_session_events.organization_id
    )
  );

create policy tenant_isolation_time_session_events_insert
  on public.time_session_events for insert to authenticated
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = time_session_events.organization_id
    )
  );

-- ---------------------------------------------------------------------------
-- 3. RPCs — atomic clock-in / clock-out. SECURITY INVOKER (the default) so
--    they run under the caller's RLS. The app pre-computes the decision
--    (session-lifecycle.ts) and the new session id; the RPC performs the
--    decided writes plus their audit events in one statement.
-- ---------------------------------------------------------------------------

-- Opens a session for p_job_id and logs 'created'. When p_close_session_id is
-- supplied (a Job switch), the prior Open session is closed at p_close_ended_at
-- and logged 'clocked_out' first — all in one transaction so the one-open
-- index never sees two Open rows for the worker.
create or replace function clock_in_to_job(
  p_session_id        uuid,
  p_organization_id   uuid,
  p_job_id            uuid,
  p_user_id           uuid,
  p_started_at        timestamptz,
  p_actor             uuid,
  p_close_session_id  uuid default null,
  p_close_ended_at    timestamptz default null
) returns uuid as $$
begin
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
    (id, organization_id, job_id, user_id, started_at, capture_method, created_by)
    values
    (p_session_id, p_organization_id, p_job_id, p_user_id, p_started_at, 'live', p_actor);

  insert into public.time_session_events
    (organization_id, time_session_id, event_type, actor, metadata)
    values (p_organization_id, p_session_id, 'created', p_actor,
            jsonb_build_object('field', 'started_at', 'old', null, 'new', p_started_at));

  return p_session_id;
end;
$$ language plpgsql;

-- Closes an Open session at p_ended_at and logs 'clocked_out'. Raises if the
-- session isn't Open (already closed or unknown) so a double clock-out is a
-- loud no-op rather than a silent second event.
create or replace function clock_out_session(
  p_session_id      uuid,
  p_organization_id uuid,
  p_ended_at        timestamptz,
  p_actor           uuid
) returns void as $$
begin
  update public.time_sessions
     set ended_at = p_ended_at
   where id = p_session_id and ended_at is null;
  if not found then
    raise exception 'time session % is not open', p_session_id;
  end if;

  insert into public.time_session_events
    (organization_id, time_session_id, event_type, actor, metadata)
    values (p_organization_id, p_session_id, 'clocked_out', p_actor,
            jsonb_build_object('field', 'ended_at', 'old', null, 'new', p_ended_at));
end;
$$ language plpgsql;

-- ROLLBACK ---
-- drop function if exists clock_out_session(uuid, uuid, timestamptz, uuid);
-- drop function if exists clock_in_to_job(uuid, uuid, uuid, uuid, timestamptz, uuid, uuid, timestamptz);
-- drop policy if exists tenant_isolation_time_session_events_insert on public.time_session_events;
-- drop policy if exists tenant_isolation_time_session_events_select on public.time_session_events;
-- drop table if exists public.time_session_events;
-- drop policy if exists tenant_isolation_time_sessions on public.time_sessions;
-- drop trigger if exists trg_time_sessions_updated_at on public.time_sessions;
-- drop index if exists public.uniq_time_sessions_one_open_per_user;
-- drop index if exists public.idx_time_sessions_user_recent;
-- drop index if exists public.idx_time_sessions_job;
-- drop index if exists public.idx_time_sessions_org;
-- drop table if exists public.time_sessions;

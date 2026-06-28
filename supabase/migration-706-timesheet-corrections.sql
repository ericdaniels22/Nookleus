-- migration-706-timesheet-corrections.sql
--
-- issue #706 (parent epic #699) — Timesheet Corrections & needs-attention.
--
-- Two concerns, in one migration because they ship together:
--
--   1. The `manage_timesheets` permission key — the lead/admin gate for
--      correcting a recorded session, hand-entry, and the needs-attention
--      surface (CONTEXT.md "Correction": leads/admins only). Mirrored from the
--      TS `ROLE_DEFAULTS` table, pinned by `role-defaults.test.ts`:
--
--        | Role        | Default |
--        | ----------- | ------- |
--        | Admin       | ON      |
--        | Crew Lead   | ON      |
--        | Crew Member | OFF     |   <- unlike track_time: a worker self-clocks
--        |             |         |      but can never type or edit a time
--        | Custom      | OFF     |
--        | (other)     | OFF     |
--
--   2. `correct_time_session(...)` — the atomic Correction RPC (section 4
--      below). Validates nothing about spans itself (the app does that against
--      session-lifecycle.ts BEFORE calling, so a bad span writes nothing; the
--      migration-661 CHECK is the DB backstop); it performs the decided write —
--      set the corrected times, flip capture_method to 'hand' — and appends
--      exactly one append-only 'corrected' audit event, in one statement.
--
-- The manage_timesheets shape mirrors migration-306 (view_phone): OFF for BOTH
-- crew_member and custom, so it can sit out of `member_perms` and let the shared
-- `else` branch cover both — no new role branch is needed (track_time needed one
-- only because crew_member DIVERGED to ON). No existing key's grant changes for
-- any role; track_time's crew_member branch from migration-662 is preserved
-- verbatim.
--
-- Depends on: migration-662 (the current set_default_permissions body),
--   migration-661 (time_sessions, time_session_events, the 'corrected' event
--   type + the ended_at > started_at CHECK backstop).
-- Smoke test: supabase/migration-706-smoke-test.sql.
-- Revert:     see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. Refresh set_default_permissions to include manage_timesheets. Added to
--    all_perms (admin gets every key) and lead_perms only. member_perms (the
--    `else` branch: custom and any other role) is unchanged, and the
--    crew_member branch (member_perms || track_time, from migration-662) is
--    preserved verbatim — so crew_member and custom both stay OFF.
-- ---------------------------------------------------------------------------
create or replace function public.set_default_permissions(p_user_organization_id uuid, p_role text)
returns void
language plpgsql
as $$
declare
  all_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'view_phone',
    'track_time',
    'manage_timesheets',
    'manage_reports', 'access_settings',
    'log_expenses', 'manage_vendors', 'manage_contract_templates', 'manage_expense_categories',
    'view_accounting', 'manage_accounting'
  ];
  admin_perms text[] := all_perms;
  lead_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'view_phone',
    'track_time',
    'manage_timesheets',
    'manage_reports',
    'log_expenses'
  ];
  -- The `else` branch (custom + any other role). Unchanged — deliberately
  -- WITHOUT track_time or manage_timesheets, so custom stays OFF for both.
  member_perms text[] := array[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses'
  ];
  -- Crew Member: the member baseline PLUS track_time (preserved verbatim from
  -- migration-662 — workers clock in/out themselves). NOT manage_timesheets:
  -- a worker can never type or edit a time (CONTEXT.md "Clock in / Clock out").
  crew_member_perms text[] := member_perms || array['track_time'];
  granted_perms text[];
  perm text;
  v_user_id uuid;
begin
  select user_id into v_user_id from public.user_organizations where id = p_user_organization_id;
  if v_user_id is null then
    raise exception 'set_default_permissions: user_organization % not found', p_user_organization_id;
  end if;

  if p_role = 'admin' then
    granted_perms := admin_perms;
  elsif p_role = 'crew_lead' then
    granted_perms := lead_perms;
  elsif p_role = 'crew_member' then
    granted_perms := crew_member_perms;
  else
    granted_perms := member_perms;
  end if;

  foreach perm in array all_perms loop
    -- New source of truth
    insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
    values (p_user_organization_id, perm, perm = any(granted_perms))
    on conflict (user_organization_id, permission_key) do update set granted = excluded.granted;

    -- Legacy table — kept in sync until the deprecation cleanup migration drops it.
    insert into public.user_permissions (user_id, permission_key, granted)
    values (v_user_id, perm, perm = any(granted_perms))
    on conflict (user_id, permission_key) do update set granted = excluded.granted;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Backfill: insert (membership, 'manage_timesheets', granted) for every
--    existing user_organizations row. granted = ON for admin/crew_lead, OFF for
--    everyone else. DO NOTHING on conflict keeps the migration idempotent and
--    never overwrites an existing manual toggle.
-- ---------------------------------------------------------------------------
insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
select uo.id,
       'manage_timesheets',
       case when uo.role in ('admin', 'crew_lead') then true else false end
  from public.user_organizations uo
 on conflict (user_organization_id, permission_key) do nothing;

-- Legacy user_permissions: one row per user. "Any admin/crew_lead membership
-- grants it", so a user who leads any Org gets the legacy grant — the legacy
-- row never under-reports a grant the new table has.
insert into public.user_permissions (user_id, permission_key, granted)
select uo.user_id,
       'manage_timesheets',
       bool_or(uo.role in ('admin', 'crew_lead'))
  from public.user_organizations uo
 group by uo.user_id
 on conflict (user_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Safety assertion: every existing membership now has a manage_timesheets
--    row. Aborts loudly rather than leaving a half-applied state. The
--    grant-matches-role checks are soft (NOTICE) because pre-existing manual
--    toggles are legitimate and the DO NOTHING above preserves them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unset_count int;
  v_expected_on_off_count int;
  v_unexpected_on_count int;
begin
  select count(*) into v_unset_count
    from public.user_organizations uo
    left join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'manage_timesheets'
   where uop.id is null;

  if v_unset_count <> 0 then
    raise exception 'migration-706: % memberships missing manage_timesheets row after backfill', v_unset_count;
  end if;

  select count(*) into v_expected_on_off_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'manage_timesheets'
   where uo.role in ('admin', 'crew_lead')
     and uop.granted = false;

  if v_expected_on_off_count > 0 then
    raise notice 'migration-706: % admin/crew_lead memberships hold manage_timesheets OFF (likely pre-existing manual toggle, not aborted)', v_expected_on_off_count;
  end if;

  select count(*) into v_unexpected_on_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'manage_timesheets'
   where uo.role not in ('admin', 'crew_lead')
     and uop.granted = true;

  if v_unexpected_on_count > 0 then
    raise notice 'migration-706: % non-lead/admin memberships hold manage_timesheets ON (likely pre-existing manual toggle, not aborted)', v_unexpected_on_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. correct_time_session(...) — the atomic Correction RPC (AC1/AC2/AC3).
--
--    SECURITY INVOKER (the default) so it runs under the caller's RLS — a lead
--    can only touch a session their Organization owns. The app has already
--    decided the new times and validated the span against session-lifecycle.ts
--    BEFORE calling (so a bad span never gets here); this performs the decided
--    write and its audit event in one statement, mirroring clock_out_session:
--
--      * locks the target row and reads its current times for the audit "old";
--      * sets the corrected time(s) — coalesce leaves an unedited end UNTOUCHED,
--        so correcting only the clock-in of an Open session NEVER auto-closes it
--        (AC1) — and flips capture_method to 'hand' so the session is
--        permanently distinguishable from a live clock;
--      * appends exactly ONE append-only 'corrected' event carrying the acting
--        user and a { field, old, new } payload.
--
--    The { field, old, new } payload: a single Correction may edit one OR both
--    ends and must remain ONE event (AC2), so `field` is the JSON array of the
--    columns the human actually typed (the non-null params) and `old`/`new` are
--    objects keyed by those columns — the uniform generalisation of the scalar
--    { field, old, new } the migration-661 events use for a single field.
--
--    Defence in depth for AC3: even though the app rejects an impossible span
--    first, the chk_time_sessions_ended_after_started CHECK (migration-661)
--    backstops the UPDATE — a bad span raises and rolls back the whole function,
--    so no event is appended and capture_method is left unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.correct_time_session(
  p_session_id      uuid,
  p_organization_id uuid,
  p_started_at      timestamptz default null,
  p_ended_at        timestamptz default null,
  p_actor           uuid default null
) returns void
language plpgsql
as $$
declare
  v_old_started timestamptz;
  v_old_ended   timestamptz;
  v_fields text[] := array[]::text[];
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  if p_started_at is null and p_ended_at is null then
    raise exception 'correct_time_session: nothing to correct (both times null)';
  end if;

  -- Lock the target row and capture its current times for the audit "old".
  -- Org-scoped: a session in another Organization is "not found" (RLS already
  -- enforces this; the explicit predicate makes the intent loud).
  select started_at, ended_at into v_old_started, v_old_ended
    from public.time_sessions
   where id = p_session_id
     and organization_id = p_organization_id
     and deleted_at is null
   for update;
  if not found then
    raise exception 'correct_time_session: session % not found in org %', p_session_id, p_organization_id;
  end if;

  -- Build { field, old, new } from exactly the fields the human typed. The
  -- '...'::text cast forces the `anyarray || anyelement` (array_append) form of
  -- ||; without it Postgres reads the bare literal as a text[] and aborts with
  -- "malformed array literal".
  if p_started_at is not null then
    v_fields := v_fields || 'started_at'::text;
    v_old := v_old || jsonb_build_object('started_at', v_old_started);
    v_new := v_new || jsonb_build_object('started_at', p_started_at);
  end if;
  if p_ended_at is not null then
    v_fields := v_fields || 'ended_at'::text;
    v_old := v_old || jsonb_build_object('ended_at', v_old_ended);
    v_new := v_new || jsonb_build_object('ended_at', p_ended_at);
  end if;

  -- The decided write: corrected time(s) + capture_method 'hand'. coalesce keeps
  -- an unedited end untouched (NULL stays NULL → an Open session stays Open).
  update public.time_sessions
     set started_at     = coalesce(p_started_at, started_at),
         ended_at       = coalesce(p_ended_at, ended_at),
         capture_method = 'hand'
   where id = p_session_id
     and organization_id = p_organization_id
     and deleted_at is null;

  -- One append-only audit event. metadata.field is the JSON array of edited
  -- columns; old/new are objects keyed by them.
  insert into public.time_session_events
    (organization_id, time_session_id, event_type, actor, metadata)
    values (p_organization_id, p_session_id, 'corrected', p_actor,
            jsonb_build_object('field', to_jsonb(v_fields), 'old', v_old, 'new', v_new));
end;
$$;

-- ROLLBACK ---
-- drop function if exists public.correct_time_session(uuid, uuid, timestamptz, timestamptz, uuid);
-- -- Remove the manage_timesheets grants (both tables) and restore the
-- -- migration-662 set_default_permissions body (drop manage_timesheets from
-- -- all_perms + lead_perms; re-run migration-662's function definition).
-- delete from public.user_organization_permissions where permission_key = 'manage_timesheets';
-- delete from public.user_permissions where permission_key = 'manage_timesheets';
-- --   then re-run the set_default_permissions definition from migration-662.

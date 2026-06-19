-- migration-661-track-time-permission.sql
--
-- issue #701 (parent epic #699) — per-Job timesheets: clock in / out of a Job.
--
-- Adds the `track_time` permission key to existing memberships across every
-- Organization, with role-based defaults pinned by `role-defaults.test.ts`
-- against #701 § Permission:
--
--   | Role        | Default |
--   | ----------- | ------- |
--   | Admin       | ON      |
--   | Crew Lead   | ON      |
--   | Crew Member | ON      |   <- unlike view_phone: workers clock themselves in
--   | Custom      | OFF     |
--   | (other)     | OFF     |
--
-- Two stages, mirroring migration-306 (view_phone):
--
--   1. Rewrite `set_default_permissions(uuid, text)` so memberships seeded by
--      a future re-run include `track_time` per the role defaults. The
--      function writes to both `user_organization_permissions` (source of
--      truth) and `user_permissions` (legacy table kept in sync during 18a).
--   2. Backfill: insert a (membership, 'track_time', granted) row for every
--      existing `user_organizations` row, where `granted` follows the role
--      defaults. Idempotent — `do nothing` on conflict respects manual toggles.
--
-- WHY an explicit crew_member branch (the one structural change vs. 306):
--   view_phone was OFF for BOTH crew_member and custom, so it could sit out of
--   `member_perms` and let the shared `else` branch (which serves crew_member,
--   custom, and any other role) cover both. track_time DIVERGES: crew_member
--   is ON but custom is OFF. So we split crew_member into its own branch
--   (member_perms + track_time) and leave the `else` branch's grants exactly as
--   they were — custom and any unknown role keep their prior keys and never
--   pick up track_time. No existing key's grant changes for any role.
--
-- Note: `set_default_permissions` has no live trigger; the app seeds new
--   members directly from the TS `ROLE_DEFAULTS` table (POST /api/settings/
--   users). This function is the database mirror, exercised only when a future
--   migration re-runs the per-membership backfill loop (as build35/build67a
--   did). Keeping it in sync here preserves that mirror for #701.
--
-- Depends on migration-306 (the current set_default_permissions body) and
--   build48 (the (p_user_organization_id, p_role) signature).

-- ---------------------------------------------------------------------------
-- 1. Refresh set_default_permissions to include track_time. Added to
--    all_perms (admin gets every key) and lead_perms; crew_member gets its own
--    branch = member_perms + track_time. member_perms (the `else` branch:
--    custom and any other role) is unchanged, so custom stays OFF.
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
    'manage_reports',
    'log_expenses'
  ];
  -- The `else` branch (custom + any other role). Unchanged from migration-306 —
  -- deliberately WITHOUT track_time, so custom stays OFF.
  member_perms text[] := array[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses'
  ];
  -- Crew Member: the member baseline PLUS track_time (workers clock in/out
  -- themselves — the whole point of the feature is the labor recording it).
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

    -- Legacy table — kept in sync during 18a until the deprecation cleanup migration drops it.
    insert into public.user_permissions (user_id, permission_key, granted)
    values (v_user_id, perm, perm = any(granted_perms))
    on conflict (user_id, permission_key) do update set granted = excluded.granted;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Backfill: insert (membership, 'track_time', granted) for every existing
--    user_organizations row. granted = ON for admin/crew_lead/crew_member,
--    OFF for custom and any other role. DO NOTHING on conflict keeps the
--    migration idempotent and never overwrites an existing manual toggle.
-- ---------------------------------------------------------------------------
insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
select uo.id,
       'track_time',
       case when uo.role in ('admin', 'crew_lead', 'crew_member') then true else false end
  from public.user_organizations uo
 on conflict (user_organization_id, permission_key) do nothing;

-- Legacy user_permissions: one row per user. If a user holds memberships in
-- multiple Organizations with different roles, the legacy row stores one truth
-- — "any admin/crew_lead/crew_member membership grants it" — so the legacy row
-- never under-reports a grant the new table has.
insert into public.user_permissions (user_id, permission_key, granted)
select uo.user_id,
       'track_time',
       bool_or(uo.role in ('admin', 'crew_lead', 'crew_member'))
  from public.user_organizations uo
 group by uo.user_id
 on conflict (user_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Safety assertion: every existing membership now has a track_time row.
--    Aborts loudly rather than leaving a half-applied state. The grant-matches-
--    role checks are soft (NOTICE) because pre-existing manual toggles are
--    legitimate and the DO NOTHING above preserves them.
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
     and uop.permission_key = 'track_time'
   where uop.id is null;

  if v_unset_count <> 0 then
    raise exception 'migration-661: % memberships missing track_time row after backfill', v_unset_count;
  end if;

  select count(*) into v_expected_on_off_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'track_time'
   where uo.role in ('admin', 'crew_lead', 'crew_member')
     and uop.granted = false;

  if v_expected_on_off_count > 0 then
    raise notice 'migration-661: % admin/crew_lead/crew_member memberships hold track_time OFF (likely pre-existing manual toggle, not aborted)', v_expected_on_off_count;
  end if;

  select count(*) into v_unexpected_on_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'track_time'
   where uo.role not in ('admin', 'crew_lead', 'crew_member')
     and uop.granted = true;

  if v_unexpected_on_count > 0 then
    raise notice 'migration-661: % custom/other memberships hold track_time ON (likely pre-existing manual toggle, not aborted)', v_unexpected_on_count;
  end if;
end $$;

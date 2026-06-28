-- migration-693-view-timesheets-permission.sql
--
-- issue #705 (parent epic #699) — Presence: "On site now" + "On the clock now".
--
-- Adds the `view_timesheets` permission key to existing memberships across
-- every Organization, with role-based defaults pinned by `role-defaults.test.ts`
-- against #705 § Permission:
--
--   | Role        | Default |
--   | ----------- | ------- |
--   | Admin       | ON      |
--   | Crew Lead   | ON      |
--   | Crew Member | OFF     |   <- like view_phone: workers see per-Job presence
--   | Custom      | OFF     |       (gated by view_jobs), not the org-wide roll-up
--   | (other)     | OFF     |
--
-- `view_timesheets` gates ONLY the owner-dashboard org-wide "On the clock now"
-- roll-up. The per-Job "On site now" indicator is gated by the existing
-- view_jobs, so a Crew Member with no view_timesheets still sees who's on site
-- at a Job they can open — they just don't get the cross-Job owner view.
--
-- Role distribution is IDENTICAL to view_phone (migration-306): admin + crew_lead
-- ON, everyone else OFF. So unlike migration-662 (track_time, which split out a
-- crew_member branch because crew_member diverged to ON), view_timesheets needs
-- NO new branch — it rides admin_perms + lead_perms, and the existing
-- crew_member_perms / member_perms arrays stay exactly as migration-662 left
-- them, keeping crew_member and custom OFF.
--
-- Two stages, mirroring migration-306 / migration-662:
--
--   1. Rewrite `set_default_permissions(uuid, text)` so memberships seeded by
--      a future re-run include `view_timesheets` per the role defaults. The
--      function writes to both `user_organization_permissions` (source of
--      truth) and `user_permissions` (legacy table kept in sync during 18a).
--   2. Backfill: insert a (membership, 'view_timesheets', granted) row for
--      every existing `user_organizations` row, where `granted` follows the
--      role defaults. Idempotent — `do nothing` on conflict respects manual
--      toggles.
--
-- Note: `set_default_permissions` has no live trigger; the app seeds new
--   members directly from the TS `ROLE_DEFAULTS` table (POST /api/settings/
--   users). This function is the database mirror, exercised only when a future
--   migration re-runs the per-membership backfill loop (as build35/build67a
--   did). Keeping it in sync here preserves that mirror for #705.
--
-- Depends on migration-662 (the current set_default_permissions body) and
--   build48 (the (p_user_organization_id, p_role) signature).

-- ---------------------------------------------------------------------------
-- 1. Refresh set_default_permissions to include view_timesheets. Added to
--    all_perms (admin gets every key) and lead_perms only. crew_member_perms
--    and member_perms (the `else` branch: custom + any other role) are
--    UNCHANGED from migration-662, so crew_member and custom stay OFF.
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
    'view_timesheets',
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
    'view_timesheets',
    'manage_reports',
    'log_expenses'
  ];
  -- The `else` branch (custom + any other role). Unchanged from migration-662 —
  -- deliberately WITHOUT view_timesheets, so custom stays OFF.
  member_perms text[] := array[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses'
  ];
  -- Crew Member: the member baseline PLUS track_time (migration-662). NOT
  -- view_timesheets — workers see per-Job presence via view_jobs, not the
  -- org-wide owner roll-up.
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
-- 2. Backfill: insert (membership, 'view_timesheets', granted) for every
--    existing user_organizations row. granted = ON for admin/crew_lead, OFF
--    for crew_member, custom, and any other role. DO NOTHING on conflict keeps
--    the migration idempotent and never overwrites an existing manual toggle.
-- ---------------------------------------------------------------------------
insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
select uo.id,
       'view_timesheets',
       case when uo.role in ('admin', 'crew_lead') then true else false end
  from public.user_organizations uo
 on conflict (user_organization_id, permission_key) do nothing;

-- Legacy user_permissions: one row per user. If a user holds memberships in
-- multiple Organizations with different roles, the legacy row stores one truth
-- — "any admin/crew_lead membership grants it" — so the legacy row never
-- under-reports a grant the new table has.
insert into public.user_permissions (user_id, permission_key, granted)
select uo.user_id,
       'view_timesheets',
       bool_or(uo.role in ('admin', 'crew_lead'))
  from public.user_organizations uo
 group by uo.user_id
 on conflict (user_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Safety assertion: every existing membership now has a view_timesheets row.
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
     and uop.permission_key = 'view_timesheets'
   where uop.id is null;

  if v_unset_count <> 0 then
    raise exception 'migration-693: % memberships missing view_timesheets row after backfill', v_unset_count;
  end if;

  select count(*) into v_expected_on_off_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'view_timesheets'
   where uo.role in ('admin', 'crew_lead')
     and uop.granted = false;

  if v_expected_on_off_count > 0 then
    raise notice 'migration-693: % admin/crew_lead memberships hold view_timesheets OFF (likely pre-existing manual toggle, not aborted)', v_expected_on_off_count;
  end if;

  select count(*) into v_unexpected_on_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'view_timesheets'
   where uo.role not in ('admin', 'crew_lead')
     and uop.granted = true;

  if v_unexpected_on_count > 0 then
    raise notice 'migration-693: % crew_member/custom/other memberships hold view_timesheets ON (likely pre-existing manual toggle, not aborted)', v_unexpected_on_count;
  end if;
end $$;

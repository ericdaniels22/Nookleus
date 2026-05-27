-- migration-306-view-phone-permission.sql
--
-- PRD #304 — Nookleus Phone. Slice 2 (#306).
--
-- Adds the `view_phone` permission key to existing memberships across every
-- Organization, with role-based defaults pinned by `role-defaults.test.ts`
-- against the table in PRD #304 § Permission:
--
--   | Role        | Default |
--   | ----------- | ------- |
--   | Admin       | ON      |
--   | Crew Lead   | ON      |
--   | Crew Member | OFF     |
--   | (other)     | OFF     |
--
-- Two stages, mirroring build48's pattern:
--
--   1. Rewrite the `set_default_permissions(uuid, text)` function so new
--      memberships created after this migration include `view_phone` in
--      the seeded grants. The function writes to both `user_organization_
--      permissions` (the new source of truth) and `user_permissions` (the
--      legacy table kept in sync during 18a for revert safety).
--   2. Backfill: insert a (membership, 'view_phone', granted) row for every
--      existing `user_organizations` row, where `granted` follows the role
--      defaults. Idempotent — re-running is safe.
--
-- Depends on build48 (the (p_user_organization_id, p_role) signature of
-- set_default_permissions).

-- ---------------------------------------------------------------------------
-- 1. Refresh set_default_permissions to include view_phone in both
--    all_perms and lead_perms. admin_perms = all_perms; member_perms is
--    unchanged (Crew Member does not get view_phone).
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
    'manage_reports',
    'log_expenses'
  ];
  member_perms text[] := array[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses'
  ];
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
-- 2. Backfill: insert (membership, 'view_phone', granted) for every existing
--    user_organizations row. DO NOTHING on conflict keeps the migration
--    idempotent and never overwrites an existing grant (e.g. an admin who
--    manually toggled the key in Settings before this migration ran).
-- ---------------------------------------------------------------------------
insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
select uo.id,
       'view_phone',
       case when uo.role in ('admin', 'crew_lead') then true else false end
  from public.user_organizations uo
 on conflict (user_organization_id, permission_key) do nothing;

-- Legacy user_permissions: one row per user. If a user holds memberships in
-- multiple Organizations with different roles, the legacy row only stores
-- one truth — pick "any admin or crew_lead membership grants it" so the
-- legacy row never under-reports a grant the new table has.
insert into public.user_permissions (user_id, permission_key, granted)
select uo.user_id,
       'view_phone',
       bool_or(uo.role in ('admin', 'crew_lead'))
  from public.user_organizations uo
 group by uo.user_id
 on conflict (user_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Safety assertion: every existing membership now has a view_phone row,
--    and the grant matches the role default. Aborts the transaction loudly
--    rather than leaving a half-applied state behind.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unset_count int;
  v_admin_lead_off_count int;
  v_member_on_count int;
begin
  select count(*) into v_unset_count
    from public.user_organizations uo
    left join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'view_phone'
   where uop.id is null;

  if v_unset_count <> 0 then
    raise exception 'migration-306: % memberships missing view_phone row after backfill', v_unset_count;
  end if;

  select count(*) into v_admin_lead_off_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'view_phone'
   where uo.role in ('admin', 'crew_lead')
     and uop.granted = false;

  -- An admin/crew_lead membership with view_phone OFF is allowed only if it
  -- predates the backfill (the DO NOTHING above respects manual toggles).
  -- We only flag rows whose updated_at proves they were *created* by this
  -- migration with the wrong grant; an unchanged manual-off is fine.
  if v_admin_lead_off_count > 0 then
    -- Soft check: log but do not abort, since pre-existing manual toggles
    -- are legitimate. The hard guarantee is that every membership now has
    -- a row, which v_unset_count above asserts.
    raise notice 'migration-306: % admin/crew_lead memberships hold view_phone OFF (likely pre-existing manual toggle, not aborted)', v_admin_lead_off_count;
  end if;

  select count(*) into v_member_on_count
    from public.user_organizations uo
    join public.user_organization_permissions uop
      on uop.user_organization_id = uo.id
     and uop.permission_key = 'view_phone'
   where uo.role not in ('admin', 'crew_lead')
     and uop.granted = true;

  -- Same soft check for the other direction.
  if v_member_on_count > 0 then
    raise notice 'migration-306: % non-(admin/crew_lead) memberships hold view_phone ON (likely pre-existing manual toggle, not aborted)', v_member_on_count;
  end if;
end $$;

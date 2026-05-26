-- build78 (PRD #249, issue #250) — Referral Partners foundation smoke test.
--
-- Purpose:   Self-checking script that verifies the migration's schema
--            invariants. NOT part of the migration. Wrapped in
--            begin; ... rollback; so the database is unchanged on a clean
--            run. Every assertion raises an exception on failure; a clean
--            run prints only NOTICE lines.
--
-- Preconditions: build78 has already been applied. The script exercises
--            invariants assuming the tables, constraints, FKs, and RLS
--            policies are in place.
--
-- Run:       psql -f supabase/migration-build78-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. Both new tables exist with expected columns.
--   2. referral_partners.status check accepts every value in the
--      Lifecycle-status enum (grey/yellow/green/red) and rejects others;
--      `grey` is the default.
--   3. referral_partner_calls.outcome check accepts every value in the
--      call-outcome enum and rejects others.
--   4. contacts.role check accepts 'referral_contact' AND every existing
--      role value — the extension is non-breaking.
--   5. Hard-delete of a referral_partner cascades referral_partner_calls
--      and nulls contacts.referral_partner_id (people survive as orphans).
--   6. RLS policies with the admin/crew_lead role gate exist on both new
--      tables. (Live RLS visibility is exercised by integration tests at
--      the application layer where auth.uid() is real.)

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
    select 'referral_partners.' || col as missing_col
      from unnest(array[
        'id', 'organization_id', 'company_name', 'status', 'industry',
        'lead_source', 'operation_size', 'office_phone', 'office_email',
        'website', 'address', 'referral_fee_terms', 'notes',
        'primary_contact_id', 'owner_contact_id',
        'last_called_at', 'last_call_outcome', 'next_follow_up_at',
        'created_at', 'updated_at', 'deleted_at'
      ]) as col
     where not exists (
       select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'referral_partners'
          and column_name = col
     )
    union all
    select 'referral_partner_calls.' || col
      from unnest(array[
        'id', 'organization_id', 'referral_partner_id', 'referral_contact_id',
        'user_id', 'called_at', 'outcome', 'notes', 'follow_up_at', 'created_at'
      ]) as col
     where not exists (
       select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'referral_partner_calls'
          and column_name = col
     )
    union all
    select 'contacts.referral_partner_id'
     where not exists (
       select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'contacts'
          and column_name = 'referral_partner_id'
     )
  ) m;

  if v_missing is not null then
    raise exception 'build78 smoke: missing column(s): %', v_missing;
  end if;
  raise notice 'build78 smoke: tables + columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Constraint + behavior tests. Wrapped in one do-block so every locally
--    declared id is in scope. All inserts roll back at the end.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id        uuid := gen_random_uuid();
  v_user_id       uuid;
  v_have_real_user boolean;
  v_partner_id    uuid;
  v_partner_status text;
  v_contact_a     uuid := gen_random_uuid();
  v_contact_b     uuid := gen_random_uuid();
  v_call_count    int;
  v_contact_link_count int;
begin
  -- Pick any existing auth.users row so the FK on referral_partner_calls.user_id
  -- is satisfiable. If the smoke test runs on a DB with no users (rare), the
  -- call-attempt branches below skip themselves.
  select id into v_user_id from auth.users limit 1;
  v_have_real_user := v_user_id is not null;

  insert into public.organizations (id, name, slug)
    values (
      v_org_id,
      'build78 smoke',
      'build78-smoke-' || replace(v_org_id::text, '-', '')
    );

  -- ----- 2a. Lifecycle-status check constraint -----
  begin
    insert into public.referral_partners (organization_id, company_name, status)
      values (v_org_id, 'Bad Status Co', 'purple');
    raise exception 'build78 smoke: referral_partners.status accepted invalid value "purple"';
  exception when check_violation then
    null; -- expected
  end;

  insert into public.referral_partners (organization_id, company_name)
    values (v_org_id, 'Default Grey Co')
    returning id, status into v_partner_id, v_partner_status;
  if v_partner_status is distinct from 'grey' then
    raise exception 'build78 smoke: referral_partners.status default is not "grey" (got %)', v_partner_status;
  end if;

  update public.referral_partners set status = 'yellow' where id = v_partner_id;
  update public.referral_partners set status = 'green'  where id = v_partner_id;
  update public.referral_partners set status = 'red'    where id = v_partner_id;
  update public.referral_partners set status = 'grey'   where id = v_partner_id;
  raise notice 'build78 smoke: referral_partners.status — default grey, accepts all 4 values, rejects "purple"';

  -- ----- 2b. Call-outcome check constraint -----
  if v_have_real_user then
    begin
      insert into public.referral_partner_calls (organization_id, referral_partner_id, user_id, outcome)
        values (v_org_id, v_partner_id, v_user_id, 'maybe_later');
      raise exception 'build78 smoke: referral_partner_calls.outcome accepted invalid value "maybe_later"';
    exception when check_violation then
      null;
    end;

    -- Every valid outcome must accept (no exception expected on the inserts).
    insert into public.referral_partner_calls (organization_id, referral_partner_id, user_id, outcome)
      values
        (v_org_id, v_partner_id, v_user_id, 'no_answer'),
        (v_org_id, v_partner_id, v_user_id, 'voicemail'),
        (v_org_id, v_partner_id, v_user_id, 'spoke'),
        (v_org_id, v_partner_id, v_user_id, 'not_interested'),
        (v_org_id, v_partner_id, v_user_id, 'interested'),
        (v_org_id, v_partner_id, v_user_id, 'scheduled_followup');
    raise notice 'build78 smoke: referral_partner_calls.outcome — accepts all 6 values, rejects "maybe_later"';
  else
    raise notice 'build78 smoke: outcome check skipped — no auth.users row available';
  end if;

  -- ----- 2c. contacts.role extension -----
  insert into public.contacts (id, organization_id, full_name, role)
    values
      (gen_random_uuid(), v_org_id, 'Homeowner A',        'homeowner'),
      (gen_random_uuid(), v_org_id, 'Tenant A',           'tenant'),
      (gen_random_uuid(), v_org_id, 'PM A',               'property_manager'),
      (gen_random_uuid(), v_org_id, 'Adjuster A',         'adjuster'),
      (gen_random_uuid(), v_org_id, 'Insurance A',        'insurance'),
      (gen_random_uuid(), v_org_id, 'Referral Contact A', 'referral_contact');
  raise notice 'build78 smoke: contacts.role — accepts referral_contact + all 5 pre-existing roles';

  begin
    insert into public.contacts (id, organization_id, full_name, role)
      values (gen_random_uuid(), v_org_id, 'Bad Role', 'crew_member');
    raise exception 'build78 smoke: contacts.role accepted invalid value "crew_member"';
  exception when check_violation then
    null;
  end;

  -- ----- 2d. Hard-delete cascade + SET NULL behavior -----
  insert into public.contacts (id, organization_id, full_name, role, referral_partner_id)
    values
      (v_contact_a, v_org_id, 'Primary @ Partner', 'referral_contact', v_partner_id),
      (v_contact_b, v_org_id, 'Owner @ Partner',   'referral_contact', v_partner_id);

  update public.referral_partners
     set primary_contact_id = v_contact_a,
         owner_contact_id   = v_contact_b
   where id = v_partner_id;

  delete from public.referral_partners where id = v_partner_id;

  select count(*) into v_call_count
    from public.referral_partner_calls
   where referral_partner_id = v_partner_id;
  if v_call_count <> 0 then
    raise exception 'build78 smoke: referral_partner_calls did NOT cascade (% rows survive)', v_call_count;
  end if;

  select count(*) into v_contact_link_count
    from public.contacts
   where id in (v_contact_a, v_contact_b)
     and referral_partner_id is not null;
  if v_contact_link_count <> 0 then
    raise exception 'build78 smoke: contacts.referral_partner_id NOT nulled on partner delete (% rows still linked)', v_contact_link_count;
  end if;

  if not exists (select 1 from public.contacts where id = v_contact_a)
     or not exists (select 1 from public.contacts where id = v_contact_b) then
    raise exception 'build78 smoke: contact rows vanished on partner delete — they should orphan, not cascade';
  end if;

  raise notice 'build78 smoke: hard-delete — calls cascade, contacts.referral_partner_id nulled, contact rows survive';
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS policies with admin/crew_lead role gate exist on both tables.
-- ---------------------------------------------------------------------------
do $$
declare
  v_partners_policy text;
  v_calls_policy    text;
begin
  select string_agg(polname, ', ')
    into v_partners_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'referral_partners'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%admin%'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%crew_lead%';

  if v_partners_policy is null then
    raise exception 'build78 smoke: referral_partners has no RLS policy gating on admin/crew_lead';
  end if;

  select string_agg(polname, ', ')
    into v_calls_policy
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'referral_partner_calls'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%admin%'
    and pg_get_expr(p.polqual, p.polrelid) ilike '%crew_lead%';

  if v_calls_policy is null then
    raise exception 'build78 smoke: referral_partner_calls has no RLS policy gating on admin/crew_lead';
  end if;

  raise notice 'build78 smoke: RLS — referral_partners (%) and referral_partner_calls (%) gate on admin/crew_lead', v_partners_policy, v_calls_policy;
end $$;

rollback;

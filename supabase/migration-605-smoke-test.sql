-- issue #605 (parent PRD #603) — review_requests smoke test.
--
-- Purpose:   Self-checking script for migration-605. NOT part of the migration.
--            Wrapped in begin; ... rollback; so the database is unchanged on a
--            clean run. Every assertion raises on failure; a clean run prints
--            only NOTICE lines.
--
-- Preconditions: migration-605 has been applied.
--
-- Run:       psql -f supabase/migration-605-smoke-test.sql
--            (or paste into the Supabase SQL editor).
--
-- What it pins:
--   1. The review_requests table + every column it carries.
--   2. The channel CHECK constraint accepts 'sms'/'email' and rejects others.
--   3. RLS is enabled with the org-scoped SELECT + admin-only INSERT policies,
--      and the log is append-only (no UPDATE/DELETE policy exists).
--   4. The job-history index exists.

begin;

-- ---------------------------------------------------------------------------
-- 1. Table + columns.
-- ---------------------------------------------------------------------------
do $$
declare
  expected text[] := array[
    'id', 'organization_id', 'job_id', 'contact_id', 'channel',
    'sent_to', 'review_link', 'sent_by_user_id', 'sent_by_name', 'created_at'
  ];
  col text;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'review_requests'
  ) then
    raise exception 'm605 smoke: table public.review_requests is missing';
  end if;

  foreach col in array expected loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'review_requests'
         and column_name = col
    ) then
      raise exception 'm605 smoke: missing column review_requests.%', col;
    end if;
  end loop;
  raise notice 'm605 smoke: table + all 10 columns present';
end $$;

-- ---------------------------------------------------------------------------
-- 2. channel CHECK constraint — accepts sms/email, rejects anything else.
-- ---------------------------------------------------------------------------
do $$
declare
  org uuid;
  job uuid;
begin
  -- Use any existing org + job so the FKs hold; skip the behavioral check on
  -- an empty database rather than fabricating cross-domain rows.
  select id into org from public.organizations limit 1;
  select id into job from public.jobs where organization_id = org limit 1;
  if org is null or job is null then
    raise notice 'm605 smoke: no org/job rows — skipping channel-constraint check';
    return;
  end if;

  -- A bad channel must be rejected.
  begin
    insert into public.review_requests
      (organization_id, job_id, channel, sent_to, review_link)
      values (org, job, 'carrier-pigeon', 'x', 'https://x');
    raise exception 'm605 smoke: channel CHECK did not reject an invalid value';
  exception
    when check_violation then
      raise notice 'm605 smoke: channel CHECK rejects invalid values';
  end;

  -- A good channel must be accepted (rolled back with the surrounding tx).
  insert into public.review_requests
    (organization_id, job_id, channel, sent_to, review_link)
    values (org, job, 'sms', '+12125550142', 'https://g.page/r/x/review');
  raise notice 'm605 smoke: channel CHECK accepts ''sms''';
end $$;

-- ---------------------------------------------------------------------------
-- 3. RLS enabled + the expected policy set (append-only).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'review_requests'
       and c.relrowsecurity
  ) then
    raise exception 'm605 smoke: RLS is not enabled on review_requests';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'review_requests'
       and policyname = 'review_requests_select' and cmd = 'SELECT'
  ) then
    raise exception 'm605 smoke: missing SELECT policy review_requests_select';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'review_requests'
       and policyname = 'review_requests_insert' and cmd = 'INSERT'
  ) then
    raise exception 'm605 smoke: missing INSERT policy review_requests_insert';
  end if;

  -- Append-only: there must be no UPDATE or DELETE policy.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'review_requests'
       and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'm605 smoke: review_requests must be append-only (found an UPDATE/DELETE policy)';
  end if;

  raise notice 'm605 smoke: RLS enabled; select + insert policies present; append-only';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Job-history index.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'review_requests'
       and indexname = 'review_requests_job_id_idx'
  ) then
    raise exception 'm605 smoke: missing index review_requests_job_id_idx';
  end if;
  raise notice 'm605 smoke: job-history index present';
end $$;

rollback;

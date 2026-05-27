-- issue #294 (PRD #246) — unread_response_threads view — smoke test.
--
-- Purpose:   Pin every inclusion/exclusion bullet of the view's filter rule
--            (see supabase/migration-294-unread-response-threads.sql) with a
--            seeded battery of emails and assertions. A clean run prints only
--            NOTICE lines; a failed run aborts loudly.
--
-- Shape:     One transaction, rolled back at the end. The script:
--              1. Re-applies the view inside the transaction (CREATE OR
--                 REPLACE — idempotent against pre/post migration shapes;
--                 rollback restores whatever was there).
--              2. Seeds a temp organization, contact, Shared + Personal
--                 email accounts, jobs in each status, and one email per
--                 filter case.
--              3. Asserts the view returns exactly the rows that should be
--                 included, with the correct `unread_count` for the
--                 multi-email thread case.
--            No real production rows are touched: every INSERT is rolled
--            back, the CREATE OR REPLACE VIEW is rolled back, and triggers'
--            side-effect rows ride the same rollback.
--
-- Run:       Via Supabase MCP `execute_sql`. Service role bypasses RLS, so
--            this exercises the view's WHERE clause (the filter rule),
--            not the security_invoker RLS — that is verified in production
--            by reading from the view as an authenticated user.

begin;

-- ---------------------------------------------------------------------------
-- 0. Apply the view inside the transaction. Idempotent via CREATE OR REPLACE;
--    rollback at the end restores whatever was in place before the test.
-- ---------------------------------------------------------------------------
create or replace view public.unread_response_threads
  with (security_invoker = true)
as
with filtered as (
  select
    coalesce(e.thread_id, 'email:' || e.id::text) as thread_id,
    e.id,
    e.job_id,
    e.subject,
    e.from_name,
    e.from_address,
    e.snippet,
    e.received_at
  from public.emails e
    join public.email_accounts ea on ea.id = e.account_id
    left join public.jobs j on j.id = e.job_id
  where e.is_read = false
    and ea.user_id is null
    and (e.category is null or e.category = 'general')
    and (
      e.job_id is null
      or (j.deleted_at is null and j.status not in ('completed','cancelled'))
    )
),
ranked as (
  select
    thread_id, id, job_id, subject, from_name, from_address, snippet, received_at,
    row_number() over (
      partition by thread_id
      order by received_at desc, id desc
    ) as rn,
    count(*) over (partition by thread_id) as unread_count
  from filtered
)
select
  thread_id,
  job_id,
  id            as latest_email_id,
  subject       as latest_subject,
  from_name     as latest_from_name,
  from_address  as latest_from_address,
  snippet       as latest_snippet,
  received_at   as latest_received_at,
  unread_count
from ranked
where rn = 1;

-- ---------------------------------------------------------------------------
-- 1. Seed. One Organization, one Contact, one Shared and one Personal
--    Email account, jobs in each status (incl. trashed), one Auth user
--    to own the Personal account. Fixed UUIDs in the 94000000- range so
--    assertions can name rows directly.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('94000000-0000-0000-0000-000000000001', 'smoke-294-org', 'smoke-294-org');

insert into auth.users (id, email, role, aud, instance_id) values
  ('94000000-0000-0000-0000-000000000010',
   'smoke-294@example.invalid', 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000');

insert into public.contacts (id, full_name, role, organization_id) values
  ('94000000-0000-0000-0000-000000000020', 'Smoke Contact', 'homeowner',
   '94000000-0000-0000-0000-000000000001');

-- Shared account: user_id IS NULL (per migration-140; CONTEXT.md "Shared email account").
insert into public.email_accounts
  (id, label, email_address, username, encrypted_password, organization_id, user_id)
values
  ('94000000-0000-0000-0000-000000000030', 'team-smoke', 'team@smoke-294.invalid',
   'team@smoke-294.invalid', 'x',
   '94000000-0000-0000-0000-000000000001', null);

-- Personal account: user_id = the auth user above.
insert into public.email_accounts
  (id, label, email_address, username, encrypted_password, organization_id, user_id)
values
  ('94000000-0000-0000-0000-000000000031', 'eric-smoke', 'eric@smoke-294.invalid',
   'eric@smoke-294.invalid', 'x',
   '94000000-0000-0000-0000-000000000001',
   '94000000-0000-0000-0000-000000000010');

-- Jobs in each relevant status. `job_number` is given explicitly so the
-- set_job_number trigger leaves it alone and we don't need a sequence.
insert into public.jobs
  (id, job_number, contact_id, organization_id, status, damage_type, property_address, urgency)
values
  ('94000000-0000-0000-0000-000000000041', 'SMOKE-NEW',       '94000000-0000-0000-0000-000000000020',
   '94000000-0000-0000-0000-000000000001', 'new',       'water', '1 Smoke St', 'scheduled'),
  ('94000000-0000-0000-0000-000000000042', 'SMOKE-COMPLETED', '94000000-0000-0000-0000-000000000020',
   '94000000-0000-0000-0000-000000000001', 'completed', 'water', '2 Smoke St', 'scheduled'),
  ('94000000-0000-0000-0000-000000000043', 'SMOKE-CANCELLED', '94000000-0000-0000-0000-000000000020',
   '94000000-0000-0000-0000-000000000001', 'cancelled', 'water', '3 Smoke St', 'scheduled'),
  ('94000000-0000-0000-0000-000000000044', 'SMOKE-TRASHED',   '94000000-0000-0000-0000-000000000020',
   '94000000-0000-0000-0000-000000000001', 'new',       'water', '4 Smoke St', 'scheduled');

update public.jobs
   set deleted_at = now()
 where id = '94000000-0000-0000-0000-000000000044';

-- ---------------------------------------------------------------------------
-- 2. Seed emails — one per filter case. Unique message_ids and thread_ids so
--    each case stands alone except for case 11 (multi-unread thread).
--    All received_at values are set explicitly so the latest-email logic is
--    deterministic.
-- ---------------------------------------------------------------------------

insert into public.emails
  (id, account_id, organization_id, message_id, thread_id, from_address, from_name,
   subject, snippet, is_read, received_at, category, job_id)
values
  -- Case A — INCLUDED: matched-to-Active (status='new'), category=general.
  ('94000000-0000-0000-0000-000000000101',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-A', 'thread-A', 'a@smoke-294.invalid', 'Sender A',
   'Active match', 'snip A', false,
   timestamptz '2026-05-27 09:00:00+00', 'general',
   '94000000-0000-0000-0000-000000000041'),

  -- Case B — EXCLUDED: matched-to-completed.
  ('94000000-0000-0000-0000-000000000102',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-B', 'thread-B', 'b@smoke-294.invalid', 'Sender B',
   'Completed match', 'snip B', false,
   timestamptz '2026-05-27 09:01:00+00', 'general',
   '94000000-0000-0000-0000-000000000042'),

  -- Case C — EXCLUDED: matched-to-cancelled.
  ('94000000-0000-0000-0000-000000000103',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-C', 'thread-C', 'c@smoke-294.invalid', 'Sender C',
   'Cancelled match', 'snip C', false,
   timestamptz '2026-05-27 09:02:00+00', 'general',
   '94000000-0000-0000-0000-000000000043'),

  -- Case D — EXCLUDED: matched-to-trashed (deleted_at set).
  ('94000000-0000-0000-0000-000000000104',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-D', 'thread-D', 'd@smoke-294.invalid', 'Sender D',
   'Trashed match', 'snip D', false,
   timestamptz '2026-05-27 09:03:00+00', 'general',
   '94000000-0000-0000-0000-000000000044'),

  -- Case E — EXCLUDED: category=promotions.
  ('94000000-0000-0000-0000-000000000105',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-E', 'thread-E', 'e@smoke-294.invalid', 'Sender E',
   'Promo', 'snip E', false,
   timestamptz '2026-05-27 09:04:00+00', 'promotions',
   null),

  -- Case F — EXCLUDED: category=social.
  ('94000000-0000-0000-0000-000000000106',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-F', 'thread-F', 'f@smoke-294.invalid', 'Sender F',
   'Social', 'snip F', false,
   timestamptz '2026-05-27 09:05:00+00', 'social',
   null),

  -- Case G — EXCLUDED: category=purchases.
  ('94000000-0000-0000-0000-000000000107',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-G', 'thread-G', 'g@smoke-294.invalid', 'Sender G',
   'Receipt', 'snip G', false,
   timestamptz '2026-05-27 09:06:00+00', 'purchases',
   null),

  -- Case H — INCLUDED: unmatched + category=general.
  ('94000000-0000-0000-0000-000000000108',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-H', 'thread-H', 'h@smoke-294.invalid', 'Sender H',
   'Unmatched general', 'snip H', false,
   timestamptz '2026-05-27 09:07:00+00', 'general',
   null),

  -- Case I — INCLUDED: unmatched + category=NULL.
  ('94000000-0000-0000-0000-000000000109',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-I', 'thread-I', 'i@smoke-294.invalid', 'Sender I',
   'Unmatched null cat', 'snip I', false,
   timestamptz '2026-05-27 09:08:00+00', null,
   null),

  -- Case J — EXCLUDED: Personal-account thread (Shared filter rejects it).
  ('94000000-0000-0000-0000-000000000110',
   '94000000-0000-0000-0000-000000000031', '94000000-0000-0000-0000-000000000001',
   'msg-J', 'thread-J', 'j@smoke-294.invalid', 'Sender J',
   'Personal account', 'snip J', false,
   timestamptz '2026-05-27 09:09:00+00', 'general',
   null),

  -- Case K1 + K2 — INCLUDED as ONE row: multi-unread thread on Shared.
  --   - Two unread emails sharing thread_id 'thread-K'.
  --   - The later received_at wins for latest_* fields and latest_email_id.
  --   - unread_count must equal 2.
  ('94000000-0000-0000-0000-000000000111',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-K-old', 'thread-K', 'k@smoke-294.invalid', 'Sender K',
   'Old K', 'old snip K', false,
   timestamptz '2026-05-27 09:10:00+00', 'general',
   '94000000-0000-0000-0000-000000000041'),
  ('94000000-0000-0000-0000-000000000112',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-K-new', 'thread-K', 'k@smoke-294.invalid', 'Sender K',
   'New K', 'new snip K', false,
   timestamptz '2026-05-27 09:11:00+00', 'general',
   '94000000-0000-0000-0000-000000000041'),

  -- Case L — sanity: a READ email on Shared (is_read=true) — must be EXCLUDED.
  ('94000000-0000-0000-0000-000000000113',
   '94000000-0000-0000-0000-000000000030', '94000000-0000-0000-0000-000000000001',
   'msg-L', 'thread-L', 'l@smoke-294.invalid', 'Sender L',
   'Already read', 'snip L', true,
   timestamptz '2026-05-27 09:12:00+00', 'general',
   null);

-- ---------------------------------------------------------------------------
-- 3. Assertions. Each block names which case it pins. Failures raise
--    exceptions that abort the script before the final ROLLBACK.
--    Scope every assertion to the seed by message_id / thread_id range so
--    real prod rows are not counted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count bigint;
  v_unread_count bigint;
  v_latest_email_id uuid;
  v_job_id uuid;
begin
  -- Total expected included rows from this seed:
  --   A (matched-active), H (unmatched-general), I (unmatched-null),
  --   K (multi-unread, ONE row).
  -- Plus the 'thread-' prefix on case-K splits ensures one row, not two.
  select count(*) into v_count
    from public.unread_response_threads
   where thread_id like 'thread-%';

  if v_count <> 4 then
    raise exception
      'migration-294 smoke: expected 4 included rows scoped to seeded thread_ids, got %', v_count;
  end if;
  raise notice 'migration-294 smoke: 4 included rows (A, H, I, K) — count OK';
end $$;

-- Case A — matched-to-Active included.
do $$
declare v_count bigint; begin
  select count(*) into v_count
    from public.unread_response_threads where thread_id = 'thread-A';
  if v_count <> 1 then
    raise exception 'migration-294 smoke (A): matched-to-Active expected 1 row, got %', v_count;
  end if;
  raise notice 'migration-294 smoke (A): matched-to-Active included';
end $$;

-- Cases B, C, D — matched-to-completed / -cancelled / -trashed excluded.
do $$
declare v_count bigint; begin
  select count(*) into v_count
    from public.unread_response_threads
   where thread_id in ('thread-B','thread-C','thread-D');
  if v_count <> 0 then
    raise exception
      'migration-294 smoke (B/C/D): completed/cancelled/trashed threads should be excluded, got %', v_count;
  end if;
  raise notice 'migration-294 smoke (B/C/D): completed/cancelled/trashed excluded';
end $$;

-- Cases E, F, G — promotions / social / purchases excluded.
do $$
declare v_count bigint; begin
  select count(*) into v_count
    from public.unread_response_threads
   where thread_id in ('thread-E','thread-F','thread-G');
  if v_count <> 0 then
    raise exception
      'migration-294 smoke (E/F/G): promotions/social/purchases should be excluded, got %', v_count;
  end if;
  raise notice 'migration-294 smoke (E/F/G): promotions/social/purchases excluded';
end $$;

-- Case H — unmatched + general included.
do $$
declare v_count bigint; v_job uuid; begin
  select count(*), max(job_id)
    into v_count, v_job
    from public.unread_response_threads where thread_id = 'thread-H';
  if v_count <> 1 then
    raise exception 'migration-294 smoke (H): unmatched-general expected 1 row, got %', v_count;
  end if;
  if v_job is not null then
    raise exception 'migration-294 smoke (H): unmatched row should have NULL job_id, got %', v_job;
  end if;
  raise notice 'migration-294 smoke (H): unmatched-general included with NULL job_id';
end $$;

-- Case I — unmatched + null category included.
do $$
declare v_count bigint; begin
  select count(*) into v_count
    from public.unread_response_threads where thread_id = 'thread-I';
  if v_count <> 1 then
    raise exception 'migration-294 smoke (I): unmatched-null-category expected 1 row, got %', v_count;
  end if;
  raise notice 'migration-294 smoke (I): unmatched-null-category included';
end $$;

-- Case J — Personal-account thread excluded.
do $$
declare v_count bigint; begin
  select count(*) into v_count
    from public.unread_response_threads where thread_id = 'thread-J';
  if v_count <> 0 then
    raise exception
      'migration-294 smoke (J): Personal-account thread should be excluded, got %', v_count;
  end if;
  raise notice 'migration-294 smoke (J): Personal-account thread excluded';
end $$;

-- Case K — multi-unread thread collapses to one row with unread_count=2
-- and the latest_email_id pointing at the newer email.
do $$
declare
  v_count bigint;
  v_unread_count bigint;
  v_latest_email_id uuid;
begin
  -- Split into two SELECTs because Postgres has no aggregate max(uuid);
  -- since the row count is asserted to be 1, the bare SELECT is safe.
  select count(*), max(unread_count)
    into v_count, v_unread_count
    from public.unread_response_threads where thread_id = 'thread-K';

  if v_count <> 1 then
    raise exception 'migration-294 smoke (K): multi-unread thread should be one row, got %', v_count;
  end if;
  if v_unread_count <> 2 then
    raise exception
      'migration-294 smoke (K): unread_count expected 2, got %', v_unread_count;
  end if;

  select latest_email_id into v_latest_email_id
    from public.unread_response_threads where thread_id = 'thread-K';
  if v_latest_email_id <> '94000000-0000-0000-0000-000000000112' then
    raise exception
      'migration-294 smoke (K): latest_email_id should be the newer email, got %', v_latest_email_id;
  end if;
  raise notice 'migration-294 smoke (K): multi-unread thread collapses correctly';
end $$;

-- Case L — sanity: read email excluded.
do $$
declare v_count bigint; begin
  select count(*) into v_count
    from public.unread_response_threads where thread_id = 'thread-L';
  if v_count <> 0 then
    raise exception 'migration-294 smoke (L): read email should be excluded, got %', v_count;
  end if;
  raise notice 'migration-294 smoke (L): read email excluded';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Done. A clean run prints NOTICE lines and rolls back; a failed run
--    aborts earlier with a clearly-labeled exception.
-- ---------------------------------------------------------------------------
rollback;

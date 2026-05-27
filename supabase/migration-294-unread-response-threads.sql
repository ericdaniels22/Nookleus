-- issue #294 (PRD #246) — unread_response_threads view.
--
-- Purpose:   One declarative SQL artifact that aggregates unread emails on
--            Shared email accounts into per-thread rows for the dashboard's
--            "People to respond to" section. The filter rule lives here, not
--            in the React hook — so any future query (a report, a Jarvis
--            tool, an audit) reads the same definition.
--
-- Shape:     One row per email thread (fallback to one row per email when
--            `emails.thread_id IS NULL`). Columns:
--              thread_id            text   — coalesce(thread_id, 'email:'||id)
--              job_id               uuid   — the latest email's job_id
--              latest_email_id      uuid   — id of the newest unread email
--              latest_subject       text
--              latest_from_name     text
--              latest_from_address  text
--              latest_snippet       text
--              latest_received_at   timestamptz
--              unread_count         bigint — unread emails in the thread
--
-- Filter:    (all bullets ANDed together — pinned by migration-294-smoke-test.sql)
--              emails.is_read = false
--              email_accounts.user_id IS NULL                  -- Shared (per CONTEXT.md)
--              emails.category IN ('general') OR NULL          -- excludes promotions/social/purchases
--              ( emails.job_id IS NULL                         -- unmatched lead
--                OR ( jobs.deleted_at IS NULL
--                     AND jobs.status NOT IN ('completed','cancelled') ) )  -- Active job
--
-- RLS:       `security_invoker = true` so RLS on the underlying tables
--            (emails → email_accounts, jobs) flows through naturally. No
--            view-specific policies are added.
--
-- Note on Shared:  email_accounts has no literal `kind` column. The
--                  Shared/Personal split is encoded by `user_id IS NULL`
--                  (Shared) vs. `user_id = <uid>` (Personal). See
--                  supabase/migration-140-email-accounts-shared-and-personal.sql.
--                  The PRD/issue wording "email_accounts.kind = 'shared'" is
--                  CONTEXT.md domain language; the SQL translation is the
--                  null check used here.

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
    thread_id,
    id,
    job_id,
    subject,
    from_name,
    from_address,
    snippet,
    received_at,
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

comment on view public.unread_response_threads is
  'issue #294 — per-thread unread Shared-inbox emails for the dashboard People-to-respond-to section. security_invoker=true; see supabase/migration-294-unread-response-threads.sql for the filter rule.';

-- ROLLBACK ------------------------------------------------------------------
-- drop view if exists public.unread_response_threads;

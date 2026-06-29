-- issue #605 (parent PRD #603, ADR 0015) — review_requests log.
--
-- Purpose:   The audit log behind "Request review" on the Job page. One row per
--            manual review request an admin sends a customer: which Job, which
--            Contact, the channel it went out on (SMS or email), the exact
--            address/number it was sent to, the review link used, and who sent
--            it when. The Job page reads this back to show the send history and
--            to warn before double-asking the same customer (the pure
--            summarizePriorReviewRequests in src/lib/reviews/review-request.ts
--            does the warning logic over these rows).
--
--            There are NO automatic or scheduled sends — every row here is the
--            direct result of an admin clicking the button. Append-only: a send
--            is a historical fact, so there are no UPDATE/DELETE policies.
--
-- RLS:       Org-scoped READ (any member acting in the org sees the history on
--            the Job) + admin-only INSERT (Marketing is an admin surface, like
--            google_connection / /marketing). The send route writes through the
--            Service client (RLS bypassed); the insert policy is the User-client
--            backstop. There are no UPDATE/DELETE policies, so the log cannot be
--            rewritten through the User client.
--
-- Depends on: schema.sql + build42 (organizations, user_organizations,
--            nookleus.active_organization_id(), public.update_updated_at()),
--            jobs, contacts, auth.users.
--
-- Smoke test: supabase/migration-605-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. review_requests — one logged manual review request.
-- ---------------------------------------------------------------------------
create table if not exists public.review_requests (
  id                 uuid primary key default gen_random_uuid(),
  -- The Org the request was sent in. Cascade so deleting an org takes its
  -- review-request history with it.
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  -- The Job the request was sent from. Cascade so deleting a Job clears its
  -- send history along with it.
  job_id             uuid not null references public.jobs(id) on delete cascade,
  -- The customer contact asked. SET NULL so the log survives a contact being
  -- removed — the historical fact "we asked on this date" still stands.
  contact_id         uuid references public.contacts(id) on delete set null,
  -- How the request was delivered.
  channel            text not null check (channel in ('sms', 'email')),
  -- The address it actually went to — an E.164 number for SMS, an email
  -- address for email. Snapshotted so the history is meaningful even if the
  -- contact's details later change.
  sent_to            text not null,
  -- The Google review link used, snapshotted at send time.
  review_link        text not null,
  -- Who clicked the button. SET NULL so the row survives that user leaving.
  sent_by_user_id    uuid references auth.users(id) on delete set null,
  -- Display-name snapshot of the sender, so the history reads "Eric sent…"
  -- without a join that breaks once the membership is gone.
  sent_by_name       text,
  created_at         timestamptz not null default now()
);

-- The Job page reads the history for one Job, most-recent first.
create index if not exists review_requests_job_id_idx
  on public.review_requests (job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. RLS — org-scoped read, admin-only insert, append-only (no update/delete).
-- ---------------------------------------------------------------------------
alter table public.review_requests enable row level security;

-- READ: any member acting in the Org sees the Job's review-request history.
drop policy if exists review_requests_select on public.review_requests;
create policy review_requests_select on public.review_requests
  for select to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
  );

-- INSERT: admins only. Marketing is an admin surface; the send route already
-- gates adminOnly at the app layer, and this backstops the User client.
drop policy if exists review_requests_insert on public.review_requests;
create policy review_requests_insert on public.review_requests
  for insert to authenticated
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = review_requests.organization_id
         and uo.role = 'admin'
    )
  );

-- No UPDATE or DELETE policies: the log is append-only. A send is a historical
-- fact and must not be rewritten through the User client.

-- ROLLBACK ---
-- drop policy if exists review_requests_insert on public.review_requests;
-- drop policy if exists review_requests_select on public.review_requests;
-- alter table public.review_requests disable row level security;
-- drop index if exists public.review_requests_job_id_idx;
-- drop table if exists public.review_requests;

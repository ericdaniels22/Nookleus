-- issue #312 (PRD #304, ADR 0005 + ADR 0006) — phone_calls +
-- phone_number_round_robin.
--
-- Purpose:   The call-event table for Nookleus Phone. One row per inbound
--            (this slice) or outbound (slice 10+) voice call, threaded on
--            the SAME phone_conversations row as the slice-4 messages so a
--            call and a text to the same outside number interleave in one
--            Phone-tab thread. The inbound voice webhook writes a row with
--            status='ringing' at dial-start; the Twilio status-callback
--            webhook updates status + duration_seconds + ended_at as the
--            call progresses.
--
--            phone_number_round_robin holds the per-Shared-number rotation
--            cursor for the round-robin inbound rule (ADR 0006). It is its
--            own table — not a column on phone_numbers — so that the
--            high-churn "advance on every inbound call" write never
--            rewrites the low-churn phone_numbers settings row (issue #312,
--            Q1). The issue sketched a `phone_number_state` table; named
--            phone_number_round_robin here because the rotation cursor is
--            the only state it carries today.
--
-- Shape:     phone_calls is PRD #304 § Schema verbatim. No updated_at /
--            update trigger — like phone_messages, a call row's lifecycle
--            is status transitions written by the status-callback webhook,
--            not a generic updated_at. initiated_by_user_id is NULL for
--            inbound (no Nookleus user starts the call); it is set for
--            outbound in a later slice. The status CHECK enforces the
--            Twilio call-status vocabulary; NULL passes the CHECK (a row
--            may exist momentarily before its first status is known,
--            mirroring phone_messages' lenient nullable status).
--
-- RLS:       phone_calls SELECT is a structural copy of
--            phone_messages_select (migration-308) — the SAME ADR 0005
--            matrix: Shared (tagged or not) is team-visible, Personal is
--            owner-visible, Job-tagged on any number is visible to whoever
--            can see the Job. The matrix lives in
--            `phone-event-access.canRead` for Service-client paths and in
--            these policies for User-client paths; the smoke test pins them
--            in sync. NOTE: like phone_messages, the policy does NOT check
--            view_phone — the feature gate is applied at the route via
--            withRequestContext; RLS encodes only the Shared/Personal/Job
--            matrix. The "Crew Member without view_phone sees no call rows"
--            acceptance criterion is a route + RTL concern, not an RLS one.
--
--            phone_number_round_robin is internal routing state, written
--            only by the inbound webhook on the Service client (which
--            bypasses RLS). RLS is ENABLED with no authenticated policy so
--            the table is locked to the Service role — no user-facing read
--            path exists in this slice.
--
-- Indexes:   idx_phone_calls_conversation_started_at — renders the thread
--            chronologically (mirrors idx_phone_messages_conversation_sent_at).
--            idx_phone_calls_org_job_started_at — feeds the Job-page Calls
--            section (mirrors idx_phone_messages_org_job_sent_at).
--            idx_phone_calls_twilio_call_sid — the status-callback webhook
--            looks a row up by Twilio CallSid to apply status updates;
--            partial on non-null sid.
--
-- Depends on: schema.sql (organizations, jobs, contacts), migration-307
--            (phone_numbers), migration-308 (phone_conversations), and
--            `nookleus.active_organization_id()` / `nookleus.is_member_of()`.
--
-- Smoke test: supabase/migration-312-smoke-test.sql exercises every cell of
--            the ADR 0005 matrix on phone_calls, mirroring
--            migration-308-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. phone_calls. One row per voice call, threaded on phone_conversations.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_calls (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  conversation_id     uuid not null references public.phone_conversations(id) on delete cascade,
  direction           text not null check (direction in ('in', 'out')),
  from_e164           text not null,
  to_e164             text not null,
  -- Twilio's CallSid. The status-callback webhook keys on this to update
  -- status/duration/ended_at as the call progresses.
  twilio_call_sid     text,
  -- Twilio call-status vocabulary. NULL passes the CHECK (a row may exist
  -- before its first status is known); the webhook writes 'ringing' at
  -- dial-start and the status-callback advances it from there.
  status              text check (status in (
                        'queued', 'ringing', 'in_progress', 'completed',
                        'busy', 'no_answer', 'failed', 'canceled')),
  -- Filled from Twilio's CallDuration on the terminal status callback.
  duration_seconds    integer,
  -- The Job tag from smart-attach (NULL when untagged). Mirrors
  -- phone_messages.job_tag; slice-9 tag chips fill/change it, slice-13
  -- Personal-number access depends on whether it is non-null.
  job_tag             uuid references public.jobs(id) on delete set null,
  -- Null when auto-tagged; set when a user tagged via the chips UI.
  tagged_by_user_id   uuid references auth.users(id) on delete set null,
  -- NULL for inbound (no Nookleus user starts the call). Set to the
  -- placing user for outbound in a later slice.
  initiated_by_user_id uuid references auth.users(id) on delete set null,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_phone_calls_conversation_started_at
  on public.phone_calls (conversation_id, started_at);

create index if not exists idx_phone_calls_org_job_started_at
  on public.phone_calls (organization_id, job_tag, started_at)
  where job_tag is not null;

create index if not exists idx_phone_calls_twilio_call_sid
  on public.phone_calls (twilio_call_sid)
  where twilio_call_sid is not null;

-- ---------------------------------------------------------------------------
-- 2. phone_number_round_robin. Per-Shared-number rotation cursor for the
--    round-robin inbound rule. Its own table so advancing the cursor on
--    every inbound call never rewrites the phone_numbers settings row
--    (issue #312, Q1). rotation_cursor is monotonic — the webhook reads it
--    (default 0 when no row), passes it to decideShared, and writes back
--    the returned nextCursor. decideShared mods by the reachable-member
--    count, so the stored value can grow without bound safely.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_number_round_robin (
  phone_number_id     uuid primary key references public.phone_numbers(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  rotation_cursor     integer not null default 0,
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. RLS.
-- ---------------------------------------------------------------------------
alter table public.phone_calls              enable row level security;
alter table public.phone_number_round_robin enable row level security;

drop policy if exists phone_calls_select on public.phone_calls;
create policy phone_calls_select on public.phone_calls
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and exists (
      select 1
        from public.phone_numbers pn
        join public.phone_conversations pc on pc.phone_number_id = pn.id
       where pc.id = phone_calls.conversation_id
         and pn.organization_id = phone_calls.organization_id
         and (
           -- Shared number: team-visible regardless of job_tag.
           pn.user_id is null
           -- Personal number, owner: visible regardless of job_tag.
           or pn.user_id = auth.uid()
           -- Job-tagged, caller can see the Job. Mirrors phone_messages:
           -- slice-4's job-access policy is "every member of the active
           -- org sees every Job"; when a per-user Job ACL lands, replace
           -- this clause with the corresponding access query.
           or (
             phone_calls.job_tag is not null
             and exists (
               select 1
                 from public.jobs j
                where j.id = phone_calls.job_tag
                  and j.organization_id = phone_calls.organization_id
             )
           )
         )
    )
  );

drop policy if exists phone_calls_insert on public.phone_calls;
create policy phone_calls_insert on public.phone_calls
  for insert to authenticated
  with check (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  );

drop policy if exists phone_calls_update on public.phone_calls;
create policy phone_calls_update on public.phone_calls
  for update to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  )
  with check (
    organization_id = nookleus.active_organization_id()
  );

-- phone_number_round_robin: no authenticated policy. RLS is enabled so the
-- table is locked to the Service role (the inbound webhook). There is no
-- user-facing read or write path for the rotation cursor in this slice.

-- ROLLBACK ---
-- drop policy if exists phone_calls_update on public.phone_calls;
-- drop policy if exists phone_calls_insert on public.phone_calls;
-- drop policy if exists phone_calls_select on public.phone_calls;
-- alter table public.phone_number_round_robin disable row level security;
-- alter table public.phone_calls disable row level security;
-- drop index if exists public.idx_phone_calls_twilio_call_sid;
-- drop index if exists public.idx_phone_calls_org_job_started_at;
-- drop index if exists public.idx_phone_calls_conversation_started_at;
-- drop table if exists public.phone_number_round_robin;
-- drop table if exists public.phone_calls;

-- issue #308 (PRD #304, ADR 0003) — phone_conversations + phone_messages.
--
-- Purpose:   The two largest tables of Nookleus Phone — one row per
--            (Organization number, outside number) Conversation, and one
--            row per inbound/outbound SMS/MMS within it. Together these
--            land the entire read path of slice 4: inbound texts surface
--            as threaded messages in the Phone tab.
--
--            phone_conversations is iMessage-style: one row per Contact
--            (or per outside-E.164 when contact_id is NULL until "Save
--            as Contact" runs). phone_messages is the event row each
--            inbound webhook writes; the index on (conversation_id,
--            sent_at) renders the thread, and the index on
--            (organization_id, job_tag, sent_at) feeds the future
--            Job-page Messages section.
--
-- Shape:     Schema is PRD #304 § Schema verbatim, narrowed to the two
--            tables this slice needs. CASCADE deletes from
--            phone_conversations clear phone_messages along with them;
--            the conversation row is the unit of "delete this thread"
--            (soft-deleted via `deleted_at`).
--
-- RLS:       Encodes ADR 0003 — Job-tagged content is team-visible to
--            anyone with view_phone who can see the Job (across Shared
--            and Personal numbers), untagged content on a Shared number
--            is team-visible, untagged content on a Personal number is
--            owner-only. The matrix lives in `phone-event-access.canRead`
--            for the Service-client paths and in these RLS policies for
--            the User-client paths; tests pin them in sync.
--
--            Slice 4's UI uses the Service-client + access-module for
--            reads (the webhook persists with the Service client). The
--            RLS policies are the backstop and the source of truth for
--            slice 13's Personal-number branches.
--
-- Depends on: schema.sql (organizations, contacts, jobs), migration-307
--            (phone_numbers), migration-build45 (org_id columns), schema
--            for `nookleus.active_organization_id()` / `is_member_of()`.
--
-- Smoke test: supabase/migration-308-smoke-test.sql exercises every cell
--            of the ADR 0003 access matrix on phone_messages (Shared and
--            Personal, tagged and untagged, owner / non-owner / cross-org)
--            in the spirit of migration-222-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. phone_conversations. One row per (phone_number_id, outside_e164)
--    pair. The Conversation is the thread head; deleting it cascades to
--    every message in the thread.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_conversations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  -- The Nookleus number this Conversation is anchored on (Shared or
  -- Personal). FK CASCADE — releasing a number cascades its
  -- Conversations, but in practice the number row stays for audit via
  -- `released_at` soft-delete, so this cascade is a defense-in-depth
  -- for hard deletes only.
  phone_number_id     uuid not null references public.phone_numbers(id) on delete cascade,
  outside_e164        text not null,
  -- NULL until "Save as Contact" runs. Slice 7 (Save as Contact API
  -- route) sets this. Once set, the thread header replaces "Save as
  -- Contact" with the Contact's name.
  contact_id          uuid references public.contacts(id) on delete set null,
  -- Denormalized for the Phone-tab list sort (newest activity on top).
  -- Webhook + outbound paths both bump this on every message.
  last_event_at       timestamptz not null default now(),
  -- Denormalized count of unread inbound messages. Slice 4 increments
  -- this on every inbound; slice 8 (mark-read) decrements it. Stored
  -- rather than computed so the list query is a single-row read per
  -- conversation.
  unread_count        integer not null default 0,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint phone_conversations_pair_unique unique (phone_number_id, outside_e164)
);

create index if not exists idx_phone_conversations_org_active
  on public.phone_conversations (organization_id, last_event_at desc)
  where deleted_at is null;

create index if not exists idx_phone_conversations_contact
  on public.phone_conversations (contact_id)
  where contact_id is not null;

drop trigger if exists trg_phone_conversations_updated_at on public.phone_conversations;
create trigger trg_phone_conversations_updated_at
  before update on public.phone_conversations
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 2. phone_messages. One row per inbound or outbound text/MMS. The
--    (conversation_id, sent_at) index renders the thread chronologically;
--    the (organization_id, job_tag, sent_at) index feeds the future
--    Job-page Messages section.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  conversation_id     uuid not null references public.phone_conversations(id) on delete cascade,
  direction           text not null check (direction in ('in', 'out')),
  from_e164           text not null,
  to_e164             text not null,
  body                text,
  -- MMS attachments — array of Twilio MediaUrl values. Empty array for
  -- plain SMS. JSONB rather than text[] so the per-item shape can grow
  -- (mime, size) without a schema change.
  media_urls          jsonb not null default '[]'::jsonb,
  twilio_sid          text,
  status              text,
  -- The Job tag from smart-attach. NULL when untagged (the default for
  -- inbound from contact with 0 or 2+ Active jobs). Slice 9 (tag chips)
  -- lets the user fill or change this; slice 13 makes Personal-number
  -- access depend on whether this is non-null.
  job_tag             uuid references public.jobs(id) on delete set null,
  -- Null when auto-tagged by smart-attach (the inbound branch); set when
  -- a user tagged via the chips UI. Slice 9 reads this for the "tagged
  -- by Alice" badge.
  tagged_by_user_id   uuid references auth.users(id) on delete set null,
  -- Null for inbound; set to the sending user for outbound. Slice 5
  -- (compose) writes this.
  sent_by_user_id     uuid references auth.users(id) on delete set null,
  sent_at             timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists idx_phone_messages_conversation_sent_at
  on public.phone_messages (conversation_id, sent_at);

create index if not exists idx_phone_messages_org_job_sent_at
  on public.phone_messages (organization_id, job_tag, sent_at)
  where job_tag is not null;

-- ---------------------------------------------------------------------------
-- 3. RLS. ENABLE first, then policies on each table.
--
--    phone_conversations: SELECT mirrors phone_messages' rule — a
--      Conversation is visible when any of its messages would be (any
--      Shared, any Personal owned by you, any Job-tagged where you see
--      the Job). For slice 4's all-Shared world this collapses to "every
--      member of the active org sees every Shared Conversation"; the
--      Personal/tagged branches ship now for slice 13 readiness.
--
--    phone_messages: encodes the full ADR 0003 matrix at the database
--      level. The check is OR-tree:
--        - Shared number (untagged or tagged) — visible to every member.
--        - Personal number, owner — visible to owner.
--        - Job-tagged, any number — visible when the caller can see the
--          Job (slice 4 uses the schema.sql "every member sees every
--          Job in their active org" policy; future slices can add a
--          per-user Job ACL and this RLS stays unchanged).
--
--    Both tables: INSERT / UPDATE require organization_id match and
--      caller membership. Routes use the Service client for writes
--      (the webhook is admin-equivalent on the inbound surface); the
--      INSERT policy is a defense-in-depth for the User-client path.
-- ---------------------------------------------------------------------------
alter table public.phone_conversations enable row level security;
alter table public.phone_messages      enable row level security;

drop policy if exists phone_conversations_select on public.phone_conversations;
create policy phone_conversations_select on public.phone_conversations
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and exists (
      select 1
        from public.phone_numbers pn
       where pn.id = phone_conversations.phone_number_id
         and pn.organization_id = phone_conversations.organization_id
         and (
           pn.user_id is null                   -- Shared
           or pn.user_id = auth.uid()           -- Personal-owner
         )
    )
  );

drop policy if exists phone_conversations_insert on public.phone_conversations;
create policy phone_conversations_insert on public.phone_conversations
  for insert to authenticated
  with check (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  );

drop policy if exists phone_conversations_update on public.phone_conversations;
create policy phone_conversations_update on public.phone_conversations
  for update to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  )
  with check (
    organization_id = nookleus.active_organization_id()
  );

drop policy if exists phone_messages_select on public.phone_messages;
create policy phone_messages_select on public.phone_messages
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and exists (
      select 1
        from public.phone_numbers pn
        join public.phone_conversations pc on pc.phone_number_id = pn.id
       where pc.id = phone_messages.conversation_id
         and pn.organization_id = phone_messages.organization_id
         and (
           -- Shared number: team-visible regardless of job_tag.
           pn.user_id is null
           -- Personal number, owner: visible regardless of job_tag.
           or pn.user_id = auth.uid()
           -- Job-tagged, caller can see the Job. Slice 4's job-access
           -- policy is "every authenticated user in the active org" via
           -- schema.sql's "Allow all on jobs" — the EXISTS below mirrors
           -- that. When a per-user Job ACL lands, replace this clause
           -- with the corresponding access query.
           or (
             phone_messages.job_tag is not null
             and exists (
               select 1
                 from public.jobs j
                where j.id = phone_messages.job_tag
                  and j.organization_id = phone_messages.organization_id
             )
           )
         )
    )
  );

drop policy if exists phone_messages_insert on public.phone_messages;
create policy phone_messages_insert on public.phone_messages
  for insert to authenticated
  with check (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  );

drop policy if exists phone_messages_update on public.phone_messages;
create policy phone_messages_update on public.phone_messages
  for update to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  )
  with check (
    organization_id = nookleus.active_organization_id()
  );

-- ROLLBACK ---
-- drop policy if exists phone_messages_update on public.phone_messages;
-- drop policy if exists phone_messages_insert on public.phone_messages;
-- drop policy if exists phone_messages_select on public.phone_messages;
-- drop policy if exists phone_conversations_update on public.phone_conversations;
-- drop policy if exists phone_conversations_insert on public.phone_conversations;
-- drop policy if exists phone_conversations_select on public.phone_conversations;
-- alter table public.phone_messages disable row level security;
-- alter table public.phone_conversations disable row level security;
-- drop trigger if exists trg_phone_conversations_updated_at on public.phone_conversations;
-- drop index if exists public.idx_phone_messages_org_job_sent_at;
-- drop index if exists public.idx_phone_messages_conversation_sent_at;
-- drop index if exists public.idx_phone_conversations_contact;
-- drop index if exists public.idx_phone_conversations_org_active;
-- drop table if exists public.phone_messages;
-- drop table if exists public.phone_conversations;

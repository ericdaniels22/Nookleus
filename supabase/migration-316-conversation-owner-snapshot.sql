-- issue #317 (PRD #304, ADR 0005) — conversation owner snapshot.
--
-- Purpose:   Close a content-privacy leak that surfaced when slice 13 made a
--            released Personal number re-claimable. Offboarding releases a
--            Personal line but KEEPS its phone_numbers row (e164 is UNIQUE
--            across all rows, released included); re-claiming REVIVES that row
--            with a NEW owner (slice 7b). The Personal-number visibility
--            policies on phone_conversations / phone_messages / phone_calls
--            resolved ownership by joining LIVE to phone_numbers.user_id — so
--            reassigning the number moved the departed member's prior
--            conversations, messages, and calls to the new owner. That breaks
--            ADR 0005's invariant that untagged Personal content is owner-only.
--
-- Fix:       Snapshot the owner onto phone_conversations at creation time
--            (owner_user_id) via a BEFORE INSERT trigger, and point the
--            Personal-owner branch of all three SELECT policies at that
--            snapshot instead of the live phone_numbers.user_id. The snapshot
--            is immutable: a later owner change on the number does NOT move
--            existing conversations, so a revived number's prior content stays
--            with the member who created it. Messages and calls resolve through
--            their conversation, so phone_conversations is the single chokepoint
--            and the only table that needs the column.
--
--            null owner_user_id = Shared / team-visible (the number had no
--            owner when the conversation was created); a non-null value is the
--            Personal owner at creation.
--
-- Depends on: migration-307 (phone_numbers), migration-308 (phone_conversations,
--            phone_messages + their policies), migration-312 (phone_calls + its
--            policy). This migration rewrites the three SELECT policies those
--            migrations created.
--
-- Smoke test: supabase/migration-316-smoke-test.sql exercises the ADR-0005
--            visibility matrix on the snapshot — including the revive case
--            (new owner blocked from the prior owner's content) — under
--            SET ROLE authenticated, where RLS is actually enforced.
--
-- Revert:    see the rollback block at the bottom of this file.

-- ---------------------------------------------------------------------------
-- 1. The snapshot column. Nullable: null is the Shared / team-visible sentinel.
-- ---------------------------------------------------------------------------
alter table public.phone_conversations
  add column if not exists owner_user_id uuid;

-- ---------------------------------------------------------------------------
-- 2. The snapshot trigger. BEFORE INSERT only — so the value is taken once, at
--    creation, and never moves when the number is later reassigned. SECURITY
--    DEFINER so it reads the true owner regardless of the inserting caller's
--    RLS view of phone_numbers (a mis-read would silently mis-scope content).
--    It does NOT fire on the UPDATE branch of an upsert, so re-touching an
--    existing conversation preserves its original snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.phone_conversations_snapshot_owner()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  new.owner_user_id := (
    select pn.user_id
      from public.phone_numbers pn
     where pn.id = new.phone_number_id
  );
  return new;
end;
$$;

drop trigger if exists trg_phone_conversations_set_owner on public.phone_conversations;
create trigger trg_phone_conversations_set_owner
  before insert on public.phone_conversations
  for each row execute function public.phone_conversations_snapshot_owner();

-- ---------------------------------------------------------------------------
-- 3. Backfill existing conversations from their number's CURRENT owner. Rows
--    on a Shared number (user_id null) stay null = team-visible. This is the
--    only moment a snapshot is derived from the live owner; from here on it is
--    frozen at insert.
-- ---------------------------------------------------------------------------
update public.phone_conversations pc
   set owner_user_id = pn.user_id
  from public.phone_numbers pn
 where pn.id = pc.phone_number_id
   and pc.owner_user_id is null
   and pn.user_id is not null;

-- ---------------------------------------------------------------------------
-- 4. A SECURITY DEFINER reader for a conversation's frozen owner. The message
--    and call policies must consult the conversation's owner snapshot, but
--    phone_conversations itself carries RLS — so a plain EXISTS-subquery would
--    re-apply that RLS and hide a Job-tagged message from a non-owner teammate
--    (the conversation row is invisible to them, so the subquery finds
--    nothing). Reading the owner through a definer function bypasses that and
--    keeps the Job-tag team-visibility branch working, while still resolving
--    the owner from the immutable snapshot (not the live number).
-- ---------------------------------------------------------------------------
create or replace function nookleus.phone_conversation_owner(conv_id uuid)
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select owner_user_id from public.phone_conversations where id = conv_id
$$;

-- ---------------------------------------------------------------------------
-- 5. Rewrite the three SELECT policies to read the snapshot. The Personal-owner
--    branch now resolves the conversation's frozen owner rather than joining
--    live to phone_numbers.user_id. Shared (owner_user_id null) stays
--    team-visible; the message/call Job-tag branch is preserved.
-- ---------------------------------------------------------------------------
drop policy if exists phone_conversations_select on public.phone_conversations;
create policy phone_conversations_select on public.phone_conversations
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      owner_user_id is null              -- Shared / team-visible
      or owner_user_id = auth.uid()      -- Personal-owner (snapshot at creation)
    )
  );

drop policy if exists phone_messages_select on public.phone_messages;
create policy phone_messages_select on public.phone_messages
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      -- Shared conversation: team-visible regardless of job_tag.
      nookleus.phone_conversation_owner(conversation_id) is null
      -- Personal conversation, owner: visible regardless of job_tag.
      or nookleus.phone_conversation_owner(conversation_id) = auth.uid()
      -- Job-tagged: anyone who can see the Job (slice-4 org-wide Job ACL).
      or (
        job_tag is not null
        and exists (
          select 1
            from public.jobs j
           where j.id = phone_messages.job_tag
             and j.organization_id = phone_messages.organization_id
        )
      )
    )
  );

drop policy if exists phone_calls_select on public.phone_calls;
create policy phone_calls_select on public.phone_calls
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      nookleus.phone_conversation_owner(conversation_id) is null
      or nookleus.phone_conversation_owner(conversation_id) = auth.uid()
      or (
        job_tag is not null
        and exists (
          select 1
            from public.jobs j
           where j.id = phone_calls.job_tag
             and j.organization_id = phone_calls.organization_id
        )
      )
    )
  );

-- ROLLBACK ---
-- drop policy if exists phone_calls_select on public.phone_calls;
-- create policy phone_calls_select on public.phone_calls
--   for select to authenticated
--   using (
--     organization_id = nookleus.active_organization_id()
--     and exists (
--       select 1
--         from public.phone_numbers pn
--         join public.phone_conversations pc on pc.phone_number_id = pn.id
--        where pc.id = phone_calls.conversation_id
--          and pn.organization_id = phone_calls.organization_id
--          and (
--            pn.user_id is null
--            or pn.user_id = auth.uid()
--            or (
--              phone_calls.job_tag is not null
--              and exists (
--                select 1 from public.jobs j
--                 where j.id = phone_calls.job_tag
--                   and j.organization_id = phone_calls.organization_id
--              )
--            )
--          )
--     )
--   );
-- drop policy if exists phone_messages_select on public.phone_messages;
-- create policy phone_messages_select on public.phone_messages
--   for select to authenticated
--   using (
--     organization_id = nookleus.active_organization_id()
--     and exists (
--       select 1
--         from public.phone_numbers pn
--         join public.phone_conversations pc on pc.phone_number_id = pn.id
--        where pc.id = phone_messages.conversation_id
--          and pn.organization_id = phone_messages.organization_id
--          and (
--            pn.user_id is null
--            or pn.user_id = auth.uid()
--            or (
--              phone_messages.job_tag is not null
--              and exists (
--                select 1 from public.jobs j
--                 where j.id = phone_messages.job_tag
--                   and j.organization_id = phone_messages.organization_id
--              )
--            )
--          )
--     )
--   );
-- drop policy if exists phone_conversations_select on public.phone_conversations;
-- create policy phone_conversations_select on public.phone_conversations
--   for select to authenticated
--   using (
--     organization_id = nookleus.active_organization_id()
--     and exists (
--       select 1 from public.phone_numbers pn
--        where pn.id = phone_conversations.phone_number_id
--          and pn.organization_id = phone_conversations.organization_id
--          and (pn.user_id is null or pn.user_id = auth.uid())
--     )
--   );
-- drop trigger if exists trg_phone_conversations_set_owner on public.phone_conversations;
-- drop function if exists public.phone_conversations_snapshot_owner();
-- drop function if exists nookleus.phone_conversation_owner(uuid);
-- alter table public.phone_conversations drop column if exists owner_user_id;

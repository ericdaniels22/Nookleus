-- issue #312 follow-up (PRD #304, ADR 0005) — fix Job-tag team-visibility in
-- the phone_messages / phone_calls SELECT policies.
--
-- Bug:       ADR 0005's read matrix says a Job-tagged event on ANY number
--            (Shared or Personal) is visible to every member who can see the
--            Job — "Job-tagged content on the Personal number is already
--            team-visible." The TypeScript matrix (src/lib/phone/
--            phone-event-access.ts → canRead) implements this correctly for
--            the Service-client paths. The User-client RLS policies
--            (migration-308 phone_messages_select, migration-312
--            phone_calls_select) did NOT: their Job-tag branch was nested
--            INSIDE the `exists (… phone_numbers pn join phone_conversations
--            pc …)` subquery. That subquery is itself subject to
--            phone_numbers' own RLS (migration-307 phone_numbers_select),
--            which makes a Personal number visible only to its owner. So for
--            a non-owner caller the join produced no row and the Job-tag
--            branch was never reached — a Job-tagged event on a Personal
--            number was hidden from the team, violating ADR 0005.
--
--            Caught by supabase/migration-312-smoke-test.sql case 1/2 (admin
--            and crew_lead non-owner expected to see `personal-tagged`,
--            saw only the two Shared rows). The identical bug existed in the
--            shipped phone_messages_select; migration-308-smoke-test.sql
--            encodes the same (correct) expectation.
--
-- Fix:       Lift the Job-tag branch to a TOP-LEVEL OR so it no longer
--            depends on traversing the RLS-filtered phone_numbers row:
--
--              org-match AND (
--                (job_tag is not null AND caller-can-see-Job)   -- any number
--                OR  Shared(team) / Personal(owner)             -- via the join
--              )
--
--            "caller-can-see-Job" stays encoded as `exists (select 1 from
--            jobs …)`, which is filtered by jobs' own RLS (tenant_isolation_
--            jobs = every member of the active org sees every Job) — the same
--            implicit Job-visibility source the original policies used. No
--            cell widens beyond ADR 0005 / canRead: cross-org still sees 0,
--            Personal-untagged is still owner-only, and the view_phone gate
--            still lives at the route (withRequestContext), not in RLS.
--
-- Scope:     Applies the SAME structural fix to BOTH tables so the two
--            User-client policies and the canRead Service-client matrix all
--            agree. Forward-only: the historical migration-308 / -312 files
--            are left as applied; replaying 308 → 312 → 313 yields the
--            correct end state.
--
-- Verify:    Re-run supabase/migration-312-smoke-test.sql (phone_calls) and
--            supabase/migration-308-smoke-test.sql (phone_messages); all
--            matrix cases go green after this migration.
--
-- Depends on: migration-308 (phone_messages_select), migration-312
--            (phone_calls_select), migration-307 (phone_numbers_select),
--            schema.sql (tenant_isolation_jobs).
--
-- Revert:    see -- ROLLBACK -- block at the bottom (restores the prior
--            nested-Job-tag policies).

-- ---------------------------------------------------------------------------
-- 1. phone_messages_select — Job-tag branch lifted to top-level.
-- ---------------------------------------------------------------------------
drop policy if exists phone_messages_select on public.phone_messages;
create policy phone_messages_select on public.phone_messages
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      -- Job-tagged on any number → visible to anyone who can see the Job.
      (
        phone_messages.job_tag is not null
        and exists (
          select 1
            from public.jobs j
           where j.id = phone_messages.job_tag
             and j.organization_id = phone_messages.organization_id
        )
      )
      -- Number-based access: Shared (team-visible) or Personal (owner only).
      or exists (
        select 1
          from public.phone_numbers pn
          join public.phone_conversations pc on pc.phone_number_id = pn.id
         where pc.id = phone_messages.conversation_id
           and pn.organization_id = phone_messages.organization_id
           and (
             pn.user_id is null
             or pn.user_id = auth.uid()
           )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. phone_calls_select — identical structural fix.
-- ---------------------------------------------------------------------------
drop policy if exists phone_calls_select on public.phone_calls;
create policy phone_calls_select on public.phone_calls
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      -- Job-tagged on any number → visible to anyone who can see the Job.
      (
        phone_calls.job_tag is not null
        and exists (
          select 1
            from public.jobs j
           where j.id = phone_calls.job_tag
             and j.organization_id = phone_calls.organization_id
        )
      )
      -- Number-based access: Shared (team-visible) or Personal (owner only).
      or exists (
        select 1
          from public.phone_numbers pn
          join public.phone_conversations pc on pc.phone_number_id = pn.id
         where pc.id = phone_calls.conversation_id
           and pn.organization_id = phone_calls.organization_id
           and (
             pn.user_id is null
             or pn.user_id = auth.uid()
           )
      )
    )
  );

-- ROLLBACK ---
-- -- Restores the prior policies (Job-tag branch nested in the phone_numbers
-- -- join). NOTE: reverting reintroduces the ADR-0005 visibility bug.
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

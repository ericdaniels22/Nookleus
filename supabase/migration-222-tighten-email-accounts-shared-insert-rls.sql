-- issue #222 (PRD #220, ADR 0001) — Tighten email_accounts INSERT RLS to
-- enforce admin-only Shared creation.
--
-- Purpose:   Close the last open cell of ADR-0001's create matrix at the
--            database. The migration-140 policy already enforces cross-Org
--            isolation and "Personal owned by yourself only" in WITH CHECK;
--            it does NOT enforce "Shared creation is admin-only." This
--            migration adds that final cell — an inline admin EXISTS on
--            user_organizations — to the Shared branch of WITH CHECK so
--            every cell of the matrix is enforced at both layers (the
--            email-account-access TypeScript module + the RLS policy).
--
-- Shape:     DROP + CREATE the policy. Only the WITH CHECK clause's
--            "user_id IS NULL" branch changes; the USING clause is
--            untouched (reads of existing rows are governed by the
--            existing ADR-0001 matrix and do not need to know about
--            admin-ness for visibility purposes). No helper function is
--            introduced — the admin check is inlined. If a second policy
--            ever needs the same check, a `nookleus.is_admin_of(org_id)`
--            helper can be extracted in a follow-up.
--
-- Depends on: migration-140-email-accounts-shared-and-personal.sql (the
--            policy this migration rewrites; if 140 has not run, this
--            migration's DROP becomes a no-op and the CREATE establishes
--            the policy from scratch in its post-#222 shape).
--
-- Smoke test: supabase/migration-222-smoke-test.sql exercises every cell
--            of the create matrix (5 cases) via authenticated-role
--            sessions. Run via Supabase MCP `execute_sql` once before
--            this migration is applied to prod; it remains in the repo
--            as the documented test of the policy.
--
-- Revert:    see -- ROLLBACK -- block at the bottom. Reverts the WITH
--            CHECK clause to the migration-140 shape.

-- ---------------------------------------------------------------------------
-- 1. Drop + recreate the policy with the tightened WITH CHECK. The USING
--    clause is byte-identical to migration-140. The WITH CHECK clause's
--    "user_id IS NULL" branch now additionally requires the caller to be
--    an admin of the proposed organization_id, inlined as an EXISTS
--    against user_organizations.
-- ---------------------------------------------------------------------------
drop policy if exists email_accounts_shared_or_personal on public.email_accounts;

create policy email_accounts_shared_or_personal on public.email_accounts
  for all to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      (user_id is null and nookleus.is_member_of(organization_id))
      or user_id = auth.uid()
    )
  )
  with check (
    organization_id = nookleus.active_organization_id()
    and (
      (
        user_id is null
        and nookleus.is_member_of(organization_id)
        and exists (
          select 1
            from public.user_organizations uo
           where uo.user_id = auth.uid()
             and uo.organization_id = email_accounts.organization_id
             and uo.role = 'admin'
        )
      )
      or user_id = auth.uid()
    )
  );

-- ROLLBACK ---
-- drop policy if exists email_accounts_shared_or_personal on public.email_accounts;
-- create policy email_accounts_shared_or_personal on public.email_accounts
--   for all to authenticated
--   using (
--     organization_id = nookleus.active_organization_id()
--     and (
--       (user_id is null and nookleus.is_member_of(organization_id))
--       or user_id = auth.uid()
--     )
--   )
--   with check (
--     organization_id = nookleus.active_organization_id()
--     and (
--       (user_id is null and nookleus.is_member_of(organization_id))
--       or user_id = auth.uid()
--     )
--   );

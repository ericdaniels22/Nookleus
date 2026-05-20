-- issue #140 (PRD #134, ADR 0001) — Email accounts: Shared and Personal.
--
-- Purpose:   Turn `email_accounts` into a Shared-or-Personal table and rewrite
--            its RLS so visibility tracks the new kind, after wiping every
--            existing row.
--
--            Two kinds, decided by the new nullable `user_id` column:
--              user_id IS NULL  → Shared    (org-wide; every member with email
--                                 perm reads + sends; admin-only manage)
--              user_id = X      → Personal  (content-private to X; only owner
--                                 reads mail; admin can see + disconnect but
--                                 not read, enforced in code via the access
--                                 module — RLS just hides it from non-owners)
--
-- Order:     drop dependent data first (wipe), alter the table (add user_id),
--            replace the policies (email_accounts, then emails and
--            email_attachments which join through account_id so their
--            effective visibility tracks the parent account).
--
-- Cascades:  emails.account_id and email_attachments.email_id are already
--            ON DELETE CASCADE, so the single DELETE FROM email_accounts
--            wipes all three tables. The migration self-asserts this.
--
-- Wipe:      Per ADR 0001 and `project_no_real_customers_yet`, dropping every
--            existing row is acceptable. Re-classifying mid-flight (which is
--            the admin's personal inbox? which is `team@`?) is unreliable; a
--            clean re-connect under the new model is the rollout path.
--
-- Depends on: migration-build45 (organization_id NOT NULL + FK), build49
--            (tenant_isolation_email_accounts/emails/email_attachments
--            policies — all replaced here), schema-email.sql (base tables).
--
-- Smoke test: supabase/migration-140-smoke-test.sql runs after this and
--            asserts wipe + column shape + the RLS Personal-vs-Shared cases.
--
-- Revert:    see -- ROLLBACK -- block at the bottom. Reverts the column +
--            policies but cannot restore the wiped rows.

-- ---------------------------------------------------------------------------
-- 1. Wipe. The CASCADE FK chain (emails → email_accounts, attachments →
--    emails) clears every dependent row in a single statement. The DO block
--    asserts the chain actually fired, so a future schema drift that drops
--    a cascade can't slip through this migration silently.
-- ---------------------------------------------------------------------------
delete from public.email_accounts;

do $$
declare
  v_accounts bigint;
  v_emails bigint;
  v_attachments bigint;
begin
  select count(*) into v_accounts from public.email_accounts;
  select count(*) into v_emails from public.emails;
  select count(*) into v_attachments from public.email_attachments;
  if v_accounts <> 0 or v_emails <> 0 or v_attachments <> 0 then
    raise exception
      'migration-140: wipe did not cascade — expected all email tables empty, got accounts=%, emails=%, attachments=%. Check ON DELETE CASCADE on emails.account_id and email_attachments.email_id.',
      v_accounts, v_emails, v_attachments;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Add user_id. Nullable: NULL marks the row as Shared; a uuid marks it
--    Personal and names the owner. FK ON DELETE CASCADE — if an auth user
--    is deleted, their Personal account + its mail go with them. We
--    deliberately do NOT use SET NULL, which would silently promote a
--    Personal account into a Shared one. RESTRICT was the other contender;
--    CASCADE wins because the admin offboarding path is "disconnect the
--    account first, then delete the user," and if a service ever deletes
--    auth.users directly the cleanup is the privacy-correct default.
-- ---------------------------------------------------------------------------
alter table public.email_accounts
  add column if not exists user_id uuid;

alter table public.email_accounts
  drop constraint if exists email_accounts_user_id_fkey;

alter table public.email_accounts
  add constraint email_accounts_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

create index if not exists idx_email_accounts_user_id
  on public.email_accounts(user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 3. RLS — email_accounts. The previous tenant_isolation policy is
--    org-only; it predates the Shared/Personal split and grants every
--    member of the active org full visibility regardless of owner. Replace
--    it with one that encodes the access matrix from ADR 0001:
--      Shared (user_id IS NULL)  → any member of the active org
--      Personal (user_id = X)    → only X
--    Service-client routes still apply the access module in code; this
--    policy is the user-client backstop.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_isolation_email_accounts on public.email_accounts;

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
      (user_id is null and nookleus.is_member_of(organization_id))
      or user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. RLS — emails. Replace the org-only policy with one that delegates to
--    the parent account's policy via EXISTS. Postgres applies RLS to the
--    subquery's table, so "I can see this email" reduces to "I can see its
--    parent account" — keeping the access matrix in exactly one place
--    (email_accounts) and out of the children.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_isolation_emails on public.emails;

create policy emails_track_parent_account on public.emails
  for all to authenticated
  using (
    exists (
      select 1
        from public.email_accounts ea
       where ea.id = emails.account_id
    )
  )
  with check (
    exists (
      select 1
        from public.email_accounts ea
       where ea.id = emails.account_id
    )
  );

-- ---------------------------------------------------------------------------
-- 5. RLS — email_attachments. Same shape, one level deeper: visibility
--    tracks the parent email, which tracks the parent account.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_isolation_email_attachments on public.email_attachments;

create policy email_attachments_track_parent_email on public.email_attachments
  for all to authenticated
  using (
    exists (
      select 1
        from public.emails e
       where e.id = email_attachments.email_id
    )
  )
  with check (
    exists (
      select 1
        from public.emails e
       where e.id = email_attachments.email_id
    )
  );

-- ROLLBACK ---
-- delete from public.email_accounts;                    -- wipe again (rows added under the new model would be lost)
-- drop policy if exists email_attachments_track_parent_email on public.email_attachments;
-- drop policy if exists emails_track_parent_account          on public.emails;
-- drop policy if exists email_accounts_shared_or_personal    on public.email_accounts;
-- create policy tenant_isolation_email_accounts on public.email_accounts for all to authenticated
--   using (
--     organization_id is not null
--     and organization_id = nookleus.active_organization_id()
--     and exists (select 1 from public.user_organizations uo
--                  where uo.user_id = auth.uid() and uo.organization_id = email_accounts.organization_id)
--   )
--   with check (
--     organization_id is not null
--     and organization_id = nookleus.active_organization_id()
--     and exists (select 1 from public.user_organizations uo
--                  where uo.user_id = auth.uid() and uo.organization_id = email_accounts.organization_id)
--   );
-- create policy tenant_isolation_emails on public.emails for all to authenticated
--   using (
--     organization_id is not null
--     and organization_id = nookleus.active_organization_id()
--     and exists (select 1 from public.user_organizations uo
--                  where uo.user_id = auth.uid() and uo.organization_id = emails.organization_id)
--   )
--   with check (
--     organization_id is not null
--     and organization_id = nookleus.active_organization_id()
--     and exists (select 1 from public.user_organizations uo
--                  where uo.user_id = auth.uid() and uo.organization_id = emails.organization_id)
--   );
-- create policy tenant_isolation_email_attachments on public.email_attachments for all to authenticated
--   using (
--     organization_id is not null
--     and organization_id = nookleus.active_organization_id()
--     and exists (select 1 from public.user_organizations uo
--                  where uo.user_id = auth.uid() and uo.organization_id = email_attachments.organization_id)
--   )
--   with check (
--     organization_id is not null
--     and organization_id = nookleus.active_organization_id()
--     and exists (select 1 from public.user_organizations uo
--                  where uo.user_id = auth.uid() and uo.organization_id = email_attachments.organization_id)
--   );
-- drop index if exists idx_email_accounts_user_id;
-- alter table public.email_accounts drop constraint if exists email_accounts_user_id_fkey;
-- alter table public.email_accounts drop column if exists user_id;

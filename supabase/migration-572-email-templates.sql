-- issue #639 (PRD #634) — email_templates table.
--
-- Purpose:   The store behind the email-templates feature: body-only
--            rich-text (HTML) templates a user can drop into a compose
--            window. Two scopes, decided by the nullable owner_user_id:
--              owner_user_id IS NULL → Organization-wide (shared; every
--                                      member of the org reads it; creating /
--                                      editing / deleting requires the
--                                      `manage_email_templates` permission,
--                                      enforced in the app layer — see below)
--              owner_user_id = X     → Personal (private to X; only X reads
--                                      and manages it)
--
-- Defense-in-depth split:
--            RLS here is the *data-isolation* backstop — it enforces the
--            organization boundary and Personal-owner privacy, the things a
--            row's columns can decide. It deliberately does NOT gate
--            Organization-wide writes on a role, because the real gate is
--            Nookleus' granular `manage_email_templates` permission, and
--            those grants live in our own tables, not the JWT — RLS cannot
--            see them. So at the SQL surface any member may write an
--            Organization-wide row; the permission is enforced one layer up
--            by `authorizeTemplateMutation` in the CRUD routes. This is the
--            same reasoning as migration-140 (email_accounts), except those
--            had no granular permission so migration-222 later tightened
--            their Shared insert to admin-only; email_templates keeps the
--            member-level RLS and leans on the app-layer permission instead.
--
-- Shape:     Mirrors the Shared/Personal split of email_accounts
--            (migration-140) and phone_numbers (migration-307) — a single
--            nullable owner column as the discriminator, no `kind` column.
--            `created_by` records authorship for audit and is independent of
--            ownership (an Organization-wide row has owner_user_id NULL but a
--            non-NULL created_by). created_by is ON DELETE SET NULL so an
--            Organization-wide template outlives the member who authored it;
--            owner_user_id is ON DELETE CASCADE so a Personal template goes
--            with its owner (matching migration-140's privacy-correct
--            default).
--
-- RLS:       One `for all` policy, shaped like email_accounts'
--            email_accounts_shared_or_personal: visibility == mutation rule
--            at the SQL layer (the permission gate is app-layer, not RLS, so
--            there is no per-command divergence to model). USING and WITH
--            CHECK are identical:
--              organization_id = active org
--              AND ((owner_user_id IS NULL AND member of org)
--                   OR owner_user_id = auth.uid())
--
-- Indexes:   idx_email_templates_org — org-scoped list query (Settings →
--            Email → Templates, Organization section).
--            idx_email_templates_owner — partial on owner_user_id for the
--            Personal section, mirroring migration-140 / migration-307.
--
-- Depends on: schema.sql (organizations, user_organizations, the
--            nookleus.active_organization_id() / nookleus.is_member_of()
--            helpers, public.update_updated_at()), auth.users.
--
-- Smoke test: supabase/migration-572-smoke-test.sql exercises the SELECT
--            visibility rule (the testable core) plus the INSERT isolation
--            backstop, in the spirit of migration-307-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.email_templates (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  -- NULL → Organization-wide; a uuid → Personal, owned by that user. ON
  -- DELETE CASCADE so a deleted user's Personal templates go with them
  -- rather than silently promoting to Organization-wide (SET NULL) or
  -- blocking the delete (RESTRICT) — same rationale as migration-140.
  owner_user_id     uuid references auth.users(id) on delete cascade,
  name              text not null,
  -- Body-only rich text. The compose window supplies subject / recipients;
  -- a template is just the body, stored as sanitized HTML.
  body_html         text not null default '',
  -- Authorship audit, independent of ownership. SET NULL so an
  -- Organization-wide template survives its author leaving the org.
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_email_templates_org
  on public.email_templates (organization_id);

create index if not exists idx_email_templates_owner
  on public.email_templates (owner_user_id)
  where owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger — the shared BEFORE UPDATE function schema.sql
--    defines, same as the rest of the schema.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_email_templates_updated_at on public.email_templates;
create trigger trg_email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS. ENABLE first, then the single Organization-or-Personal policy.
--    The User-client policy is the data-isolation backstop; the CRUD routes
--    additionally enforce `manage_email_templates` for Organization-wide
--    mutations via authorizeTemplateMutation.
-- ---------------------------------------------------------------------------
alter table public.email_templates enable row level security;

drop policy if exists email_templates_org_or_personal on public.email_templates;
create policy email_templates_org_or_personal on public.email_templates
  for all to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      (owner_user_id is null and nookleus.is_member_of(organization_id))
      or owner_user_id = auth.uid()
    )
  )
  with check (
    organization_id = nookleus.active_organization_id()
    and (
      (owner_user_id is null and nookleus.is_member_of(organization_id))
      or owner_user_id = auth.uid()
    )
  );

-- ROLLBACK ---
-- drop policy if exists email_templates_org_or_personal on public.email_templates;
-- alter table public.email_templates disable row level security;
-- drop trigger if exists trg_email_templates_updated_at on public.email_templates;
-- drop index if exists public.idx_email_templates_owner;
-- drop index if exists public.idx_email_templates_org;
-- drop table if exists public.email_templates;

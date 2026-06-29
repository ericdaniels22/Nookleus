-- issue #613 (PRD #603, ADR 0015) — showcases table (Marketing Suite, slice ②).
--
-- Purpose:   The store behind a Showcase: one public-facing story per Job —
--            a hand-picked, ordered set of that Job's Photos plus a title and
--            write-up. #613 builds the entity + the in-app builder as DRAFTS
--            ONLY; publishing (privacy scrub, one-click consent, WordPress /
--            GBP push) is a later slice and deliberately not modelled here
--            beyond leaving 'published' valid in the status check.
--
-- One per Job:
--            CONTEXT.md / ADR 0015 — "A Job has zero or one Showcase." Enforced
--            by a PARTIAL unique index on (job_id) WHERE deleted_at IS NULL: at
--            most one LIVE Showcase per Job. A trashed Showcase does not block
--            creating a fresh one, which is exactly the "delete & start over"
--            recovery the builder offers (soft-delete, like photo_reports #402).
--
-- Photos:    photo_ids is an ordered JSONB array of the Job's own photo ids
--            (the gallery order is meaningful). The create/save routes run the
--            pure sanitizeShowcasePhotoSelection gate (src/lib/showcase-photos.ts)
--            so a stored array only ever holds the Job's photos, deduped, in the
--            chosen order — the same trust-nothing posture as photo-reports'
--            ownedJobPhotoIds.
--
-- RLS:       Admin-only on every surface (#613 acceptance criteria: "all
--            surfaces admin-only"). Unlike email_templates (migration-658), a
--            Showcase's read predicate equals its write predicate, so a single
--            FOR ALL policy expresses it: active-org AND caller is an admin of
--            that org. The admin check lives in a new SECURITY DEFINER helper
--            nookleus.is_admin_of(), shaped like is_member_of() so the policy
--            never recurses into user_organizations RLS (the #313 hazard).
--
-- Depends on: schema.sql (organizations, jobs, user_organizations, the
--            nookleus.active_organization_id() helper, public.update_updated_at()),
--            auth.users.
--
-- Smoke test: supabase/migration-613-smoke-test.sql exercises the admin-only
--            RLS (admin writes, non-admin member is blocked) and the
--            one-live-Showcase-per-Job partial unique index.
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The admin-of-org helper — "is the current user an admin of org X?"
--    SECURITY DEFINER + pinned search_path so it reads user_organizations
--    regardless of the caller's own RLS, letting the showcases policy reference
--    membership without recursive policy evaluation (mirrors is_member_of).
-- ---------------------------------------------------------------------------
create or replace function nookleus.is_admin_of(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_organizations
     where user_id = auth.uid()
       and organization_id = target_org
       and role = 'admin'
  );
$$;

grant execute on function nookleus.is_admin_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.showcases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The Job whose story this Showcase tells. CASCADE so a deleted Job takes its
  -- Showcase with it (a Showcase has no meaning without its Job).
  job_id          uuid not null references public.jobs(id) on delete cascade,
  title           text not null default '',
  -- The hand-written story. Drafts only in #613 — the admin types this (no AI
  -- drafting yet).
  write_up        text not null default '',
  -- Ordered array of the Job's photo ids; the gallery order is meaningful.
  photo_ids       jsonb not null default '[]'::jsonb,
  -- 'published' is left valid for the later publishing slice but never written
  -- by #613, which only ever creates 'draft' rows.
  status          text not null default 'draft'
    check (status in ('draft', 'published')),
  -- Authorship audit. SET NULL so a Showcase survives its author leaving.
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Soft-delete for the recoverable trash (matches photo_reports #402).
  -- NULL = live. A trashed row frees the per-Job uniqueness slot.
  deleted_at      timestamptz
);

-- Org-scoped list query (Marketing → Showcases tab).
create index if not exists idx_showcases_org
  on public.showcases (organization_id)
  where deleted_at is null;

-- At most one LIVE Showcase per Job (ADR 0015). Partial on deleted_at so a
-- trashed Showcase does not block starting a fresh one for the same Job.
create unique index if not exists showcases_one_live_per_job
  on public.showcases (job_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger — the shared BEFORE UPDATE function.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_showcases_updated_at on public.showcases;
create trigger trg_showcases_updated_at
  before update on public.showcases
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS. ENABLE first, then the single admin-only policy. Read predicate ==
--    write predicate, so one FOR ALL policy covers select / insert / update /
--    delete: the row is in the caller's active org AND the caller is an admin
--    of that org.
-- ---------------------------------------------------------------------------
alter table public.showcases enable row level security;

drop policy if exists showcases_admin_only on public.showcases;
create policy showcases_admin_only on public.showcases
  for all to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_admin_of(organization_id)
  )
  with check (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_admin_of(organization_id)
  );

-- ROLLBACK ---
-- drop policy if exists showcases_admin_only on public.showcases;
-- alter table public.showcases disable row level security;
-- drop trigger if exists trg_showcases_updated_at on public.showcases;
-- drop index if exists public.showcases_one_live_per_job;
-- drop index if exists public.idx_showcases_org;
-- drop table if exists public.showcases;
-- drop function if exists nookleus.is_admin_of(uuid);

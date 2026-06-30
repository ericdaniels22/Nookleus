-- issue #819 (PRD #804) — quick_pick_labels table.
--
-- Purpose:   The data layer for Quick-pick labels — reusable phrases an
--            org saves so a user can later tap one to apply as a Label on
--            an Annotation. This slice stands up the table + the Settings →
--            Photos list/add page; edit / reorder / delete land in later
--            slices.
--
-- Shape:     Mirrors the damage_types catalog. `organization_id` is
--            nullable: NULL rows are shared defaults visible to every org;
--            non-NULL rows are owned by one org. The API only ever inserts
--            org-owned rows (organization_id = the active org), never NULL.
--            sort_order drives the list ordering; created_at / updated_at
--            follow the schema-wide timestamp convention.
--
-- RLS:       Two policies, copied verbatim from damage_types
--            (migration-build49 § damage_types):
--              SELECT — NULL-org defaults are visible to everyone; an org's
--                       own rows are visible only to its members in the
--                       active org. Cross-org boundary at the top.
--              ALL    — mutations restricted to non-NULL rows owned by the
--                       active org whose caller is a member; the shared
--                       defaults can never be mutated through the User
--                       client. (Route-level access_settings gating is the
--                       separate permission layer.)
--
-- Indexes:   idx_quick_pick_labels_org_sort — (organization_id, sort_order)
--            backs the Settings → Photos list query (defaults + org rows in
--            sort_order).
--
-- Seed:      Three shared defaults (organization_id NULL) so every org sees
--            a starter set on day one: Source of loss, Moisture Reading,
--            Visible Damage.
--
-- Depends on: schema.sql (organizations), public.update_updated_at(),
--            nookleus.active_organization_id().
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The table itself.
-- ---------------------------------------------------------------------------
create table if not exists public.quick_pick_labels (
  id               uuid primary key default gen_random_uuid(),
  -- NULL = shared default visible to every org; non-NULL = org-owned.
  organization_id  uuid references public.organizations(id) on delete cascade,
  label            text not null,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_quick_pick_labels_org_sort
  on public.quick_pick_labels (organization_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger — the shared BEFORE UPDATE function from schema.sql.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_quick_pick_labels_updated_at on public.quick_pick_labels;
create trigger trg_quick_pick_labels_updated_at
  before update on public.quick_pick_labels
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — copied from damage_types (the catalog pattern this mirrors).
-- ---------------------------------------------------------------------------
alter table public.quick_pick_labels enable row level security;

drop policy if exists tenant_isolation_select_quick_pick_labels on public.quick_pick_labels;
create policy tenant_isolation_select_quick_pick_labels on public.quick_pick_labels for select to authenticated
  using (
    organization_id is null
    or (
      organization_id = nookleus.active_organization_id()
      and exists (select 1 from public.user_organizations uo
                   where uo.user_id = auth.uid() and uo.organization_id = quick_pick_labels.organization_id)
    )
  );

drop policy if exists tenant_isolation_mod_quick_pick_labels on public.quick_pick_labels;
create policy tenant_isolation_mod_quick_pick_labels on public.quick_pick_labels for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = quick_pick_labels.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = quick_pick_labels.organization_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Seed shared defaults (organization_id NULL). Guarded so a re-run can't
--    duplicate them — there is no unique key on label.
-- ---------------------------------------------------------------------------
insert into public.quick_pick_labels (organization_id, label, sort_order)
select v.organization_id, v.label, v.sort_order
  from (values
    (null::uuid, 'Source of loss',   1),
    (null::uuid, 'Moisture Reading', 2),
    (null::uuid, 'Visible Damage',   3)
  ) as v(organization_id, label, sort_order)
 where not exists (
   select 1 from public.quick_pick_labels where organization_id is null
 );

-- ROLLBACK ---
-- drop policy if exists tenant_isolation_mod_quick_pick_labels on public.quick_pick_labels;
-- drop policy if exists tenant_isolation_select_quick_pick_labels on public.quick_pick_labels;
-- alter table public.quick_pick_labels disable row level security;
-- drop trigger if exists trg_quick_pick_labels_updated_at on public.quick_pick_labels;
-- drop index if exists public.idx_quick_pick_labels_org_sort;
-- drop table if exists public.quick_pick_labels;

-- build78 (PRD #249, issue #250): Referral Partners foundation.
--
-- Schema for the first vertical slice of the Referral Partners surface:
-- two new tables, an extension of contacts.role with `'referral_contact'`,
-- and a nullable `contacts.referral_partner_id` FK that lets unlimited
-- Referral Contacts point at one Referral Partner without a join table.
--
-- The call table (`referral_partner_calls`) is created here even though
-- the UI doesn't exercise it yet (call-log read/write lands in issue
-- #254). One migration round-trip is cheaper than two; the smoke test
-- covers both tables in the same `begin; ... rollback;` script.
--
-- RLS pattern: tenant_isolation_* (mirrors build49) AND a role check
-- restricting all CRUD to `admin` and `crew_lead`. `crew_member` cannot
-- see Referral Partners at all (PRD #249 user story #24).
--
-- Revert: see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. referral_partners — the canonical home for each Referral Partner company.
-- ---------------------------------------------------------------------------
create table if not exists public.referral_partners (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  company_name        text not null,
  status              text not null default 'grey'
                        check (status in ('grey', 'yellow', 'green', 'red')),
  industry            text,
  lead_source         text,
  operation_size      text,
  office_phone        text,
  office_email        text,
  website             text,
  address             text,
  referral_fee_terms  text,
  notes               text,
  primary_contact_id  uuid references public.contacts(id) on delete set null,
  owner_contact_id    uuid references public.contacts(id) on delete set null,
  last_called_at      timestamptz,
  last_call_outcome   text,
  next_follow_up_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists idx_referral_partners_org
  on public.referral_partners (organization_id, deleted_at);

create trigger trg_referral_partners_updated_at
  before update on public.referral_partners
  for each row execute function update_updated_at();

alter table public.referral_partners enable row level security;

-- Tenant isolation + admin / crew_lead gate. crew_member sees nothing.
create policy tenant_isolation_referral_partners
  on public.referral_partners for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = referral_partners.organization_id
         and uo.role in ('admin', 'crew_lead')
    )
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = referral_partners.organization_id
         and uo.role in ('admin', 'crew_lead')
    )
  );

-- ---------------------------------------------------------------------------
-- 2. referral_partner_calls — one row per cold-call attempt. Cascades on the
--    partner so a hard-delete cleans the history with the row.
-- ---------------------------------------------------------------------------
create table if not exists public.referral_partner_calls (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  referral_partner_id   uuid not null references public.referral_partners(id) on delete cascade,
  referral_contact_id   uuid references public.contacts(id) on delete set null,
  user_id               uuid not null references auth.users(id) on delete restrict,
  called_at             timestamptz not null default now(),
  outcome               text not null
                          check (outcome in (
                            'no_answer',
                            'voicemail',
                            'spoke',
                            'not_interested',
                            'interested',
                            'scheduled_followup'
                          )),
  notes                 text,
  follow_up_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_referral_partner_calls_partner
  on public.referral_partner_calls (referral_partner_id, called_at desc);

create index if not exists idx_referral_partner_calls_org
  on public.referral_partner_calls (organization_id);

alter table public.referral_partner_calls enable row level security;

create policy tenant_isolation_referral_partner_calls
  on public.referral_partner_calls for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = referral_partner_calls.organization_id
         and uo.role in ('admin', 'crew_lead')
    )
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = referral_partner_calls.organization_id
         and uo.role in ('admin', 'crew_lead')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Extend contacts.role with 'referral_contact'.
--    The original constraint was inline-on-column from supabase/schema.sql,
--    so its name is the Postgres default `contacts_role_check`. Drop and
--    re-add with the extended value set. Existing roles are preserved.
-- ---------------------------------------------------------------------------
alter table public.contacts drop constraint if exists contacts_role_check;
alter table public.contacts add constraint contacts_role_check
  check (role in (
    'homeowner',
    'tenant',
    'property_manager',
    'adjuster',
    'insurance',
    'referral_contact'
  ));

-- ---------------------------------------------------------------------------
-- 4. contacts.referral_partner_id — nullable FK to referral_partners.
--    ON DELETE SET NULL so a hard-deleted partner doesn't take its people
--    with it (PRD #249 user story #23) — the contacts survive as orphans.
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists referral_partner_id uuid
    references public.referral_partners(id) on delete set null;

create index if not exists idx_contacts_referral_partner_id
  on public.contacts (referral_partner_id)
  where referral_partner_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Sidebar position — put "Referral Partners" directly below Marketing.
--    Look up Marketing's CURRENT sort_order at apply-time (it may have been
--    reordered by an admin since the build29 seed — at the time this
--    migration first shipped, AAA prod had Marketing at 9, not 3). Shift
--    everything below Marketing by +1 and insert at Marketing+1. If
--    Marketing isn't present at all (a fresh DB without the seed),
--    append to the end. Idempotent against re-runs.
-- ---------------------------------------------------------------------------
do $$
declare
  v_marketing_pos int;
  v_target_pos    int;
begin
  if not exists (select 1 from public.nav_items where href = '/referral-partners') then
    select sort_order into v_marketing_pos
      from public.nav_items where href = '/marketing';

    if v_marketing_pos is null then
      select coalesce(max(sort_order), 0) + 1
        into v_target_pos from public.nav_items;
    else
      v_target_pos := v_marketing_pos + 1;
      update public.nav_items
         set sort_order = sort_order + 1
       where sort_order >= v_target_pos;
    end if;

    insert into public.nav_items (href, sort_order)
      values ('/referral-partners', v_target_pos);
  end if;
end $$;

-- ROLLBACK ---
-- -- Capture the slot the new item occupied, then peel everything back.
-- do $$
-- declare v_pos int;
-- begin
--   select sort_order into v_pos from public.nav_items where href = '/referral-partners';
--   delete from public.nav_items where href = '/referral-partners';
--   if v_pos is not null then
--     update public.nav_items set sort_order = sort_order - 1 where sort_order > v_pos;
--   end if;
-- end $$;
-- drop index if exists public.idx_contacts_referral_partner_id;
-- alter table public.contacts drop column if exists referral_partner_id;
-- alter table public.contacts drop constraint if exists contacts_role_check;
-- alter table public.contacts add constraint contacts_role_check
--   check (role in ('homeowner', 'tenant', 'property_manager', 'adjuster', 'insurance'));
-- drop policy if exists tenant_isolation_referral_partner_calls on public.referral_partner_calls;
-- drop table if exists public.referral_partner_calls;
-- drop policy if exists tenant_isolation_referral_partners on public.referral_partners;
-- drop trigger if exists trg_referral_partners_updated_at on public.referral_partners;
-- drop table if exists public.referral_partners;

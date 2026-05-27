-- issue #307 (PRD #304, ADR 0003) — phone_numbers table.
--
-- Purpose:   The foundation table for Nookleus Phone. One row per Twilio
--            number the Organization has provisioned. Slice 3 lands only
--            Shared (admin-provisioned, org-wide) numbers; Personal numbers
--            (per-user, claimed from a profile page) come in slice 13.
--            The table is built for both kinds from day one — only the
--            insert path differs by slice.
--
-- Shape:     The schema is PRD #304 § Schema verbatim. The kind CHECK
--            enforces "(kind='shared' AND user_id IS NULL) OR
--            (kind='personal' AND user_id IS NOT NULL)" so a Shared row
--            can never carry an owner and a Personal row can never miss
--            one. Soft-delete via released_at (nullable; non-NULL = the
--            number was returned to Twilio and the row is offboarded);
--            this mirrors the existing soft-delete pattern from #294 /
--            referral-partners / contracts.
--
-- RLS:       Three policies, modeled after migration-140
--            (email_accounts_shared_or_personal) plus migration-222 (the
--            admin-only Shared INSERT tightening):
--              SELECT — same shape as the email-accounts USING clause:
--                       Shared visible to every member of the active org;
--                       Personal visible only to its owner. Cross-org
--                       boundary at the top.
--              INSERT — Shared rows require admin role; Personal rows
--                       require owner==auth.uid() (per slice 13 plan).
--                       Inlined EXISTS check (no helper function — see
--                       migration-222 § rationale).
--              UPDATE — same shape as SELECT, plus mutation requires
--                       admin role for Shared, owner-or-admin for Personal.
--                       Soft-delete (setting released_at) goes through
--                       UPDATE — there is no DELETE policy, so the table
--                       behaves as append-only at the SQL surface.
--
-- Indexes:   idx_phone_numbers_org_active — org-scoped, live (released_at
--            IS NULL) rows. Matches the Settings → Phone list query and
--            future inbound-routing lookups.
--            idx_phone_numbers_user_id_personal — partial index on owner
--            for Personal numbers, mirroring migration-140's pattern.
--            idx_phone_numbers_e164 — UNIQUE on e164 across all rows
--            including released. Twilio cannot re-issue an active number
--            to another tenant, so global uniqueness is safe and useful
--            for the future inbound-router lookup ("which org's number is
--            +1XXX trying to be reached?").
--
-- Depends on: schema.sql (organizations, user_organizations), auth.users.
--
-- Smoke test: supabase/migration-307-smoke-test.sql exercises the kind
--            CHECK + RLS cross-org isolation + admin-only Shared insert
--            in the spirit of migration-186-smoke-test.sql and
--            migration-222-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The table itself.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_numbers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  twilio_sid          text not null,
  e164                text not null,
  label               text,
  -- 'shared' = org-wide; 'personal' = owned by user_id.
  kind                text not null,
  -- NULL when Shared; FK to auth.users when Personal. ON DELETE CASCADE
  -- mirrors migration-140's rationale: if a user is deleted, their
  -- Personal number row goes with them rather than silently promoting to
  -- Shared (SET NULL) or blocking the user deletion (RESTRICT). The
  -- offboarding path is "release the number first, then delete the user";
  -- CASCADE is the privacy-correct default if a service ever bypasses it.
  user_id             uuid references auth.users(id) on delete cascade,
  -- Shared-only: { kind: 'ring-all' | 'round-robin' | 'forward' | 'voicemail',
  -- users? | sequence? | forwardUserId? }. NULL for Personal. Slice 8
  -- lands the configurable inbound rules; slice 3 inserts NULL.
  inbound_rule        jsonb,
  voicemail_greeting_url text,
  -- Snapshot of Twilio's monthly cost in cents at provision time. Used
  -- for the Settings → Phone list's monthly-cost column; not used for
  -- billing (Twilio's invoice is the source of truth).
  monthly_cost_cents  integer,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Non-NULL marks the number as released back to Twilio. Soft-delete:
  -- the row stays for audit (history of "we paid for X from..to").
  released_at         timestamptz,
  constraint phone_numbers_kind_user_id_chk check (
    (kind = 'shared'   and user_id is null) or
    (kind = 'personal' and user_id is not null)
  ),
  constraint phone_numbers_kind_chk check (kind in ('shared', 'personal'))
);

-- The e164 must be globally unique across all rows. Twilio cannot re-issue
-- an active number to another tenant, so this is safe and helps the
-- future inbound-router lookup. The unique index includes released rows
-- so a freshly-released number cannot be re-provisioned to a different
-- tenant accidentally; the admin must re-port if they want it back.
create unique index if not exists idx_phone_numbers_e164
  on public.phone_numbers (e164);

create index if not exists idx_phone_numbers_org_active
  on public.phone_numbers (organization_id)
  where released_at is null;

create index if not exists idx_phone_numbers_user_id_personal
  on public.phone_numbers (user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger. The pattern matches the rest of the schema —
--    a BEFORE UPDATE trigger calling the shared update_updated_at function
--    that schema.sql defines.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_phone_numbers_updated_at on public.phone_numbers;
create trigger trg_phone_numbers_updated_at
  before update on public.phone_numbers
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS. ENABLE first, then the policies. The User-client policy is the
--    backstop; Service-client routes additionally delegate to
--    `phone-event-access.canManage` (#307) for mutations.
-- ---------------------------------------------------------------------------
alter table public.phone_numbers enable row level security;

drop policy if exists phone_numbers_select on public.phone_numbers;
create policy phone_numbers_select on public.phone_numbers
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      (user_id is null and nookleus.is_member_of(organization_id))
      or user_id = auth.uid()
    )
  );

-- INSERT — Shared rows require admin role of the proposed org (matches
-- migration-222's tightening of email_accounts). Personal rows require
-- owner==auth.uid() (slice 13 will exercise this branch; included now
-- so the matrix is complete from day one and slice 13 is a UI-only
-- delivery).
drop policy if exists phone_numbers_insert on public.phone_numbers;
create policy phone_numbers_insert on public.phone_numbers
  for insert to authenticated
  with check (
    organization_id = nookleus.active_organization_id()
    and (
      (
        kind = 'shared'
        and user_id is null
        and exists (
          select 1
            from public.user_organizations uo
           where uo.user_id = auth.uid()
             and uo.organization_id = phone_numbers.organization_id
             and uo.role = 'admin'
        )
      )
      or (
        kind = 'personal'
        and user_id = auth.uid()
      )
    )
  );

-- UPDATE — same row-visibility as SELECT, with mutation gated to admin
-- for Shared and owner-or-admin for Personal. The UPDATE path is how a
-- soft-delete (setting released_at) reaches the table; there is no
-- DELETE policy, so the table behaves append-only.
drop policy if exists phone_numbers_update on public.phone_numbers;
create policy phone_numbers_update on public.phone_numbers
  for update to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and (
      (
        kind = 'shared'
        and exists (
          select 1
            from public.user_organizations uo
           where uo.user_id = auth.uid()
             and uo.organization_id = phone_numbers.organization_id
             and uo.role = 'admin'
        )
      )
      or (
        kind = 'personal'
        and (
          user_id = auth.uid()
          or exists (
            select 1
              from public.user_organizations uo
             where uo.user_id = auth.uid()
               and uo.organization_id = phone_numbers.organization_id
               and uo.role = 'admin'
          )
        )
      )
    )
  )
  with check (
    organization_id = nookleus.active_organization_id()
  );

-- ROLLBACK ---
-- drop policy if exists phone_numbers_update on public.phone_numbers;
-- drop policy if exists phone_numbers_insert on public.phone_numbers;
-- drop policy if exists phone_numbers_select on public.phone_numbers;
-- alter table public.phone_numbers disable row level security;
-- drop trigger if exists trg_phone_numbers_touch_updated_at on public.phone_numbers;
-- drop index if exists public.idx_phone_numbers_user_id_personal;
-- drop index if exists public.idx_phone_numbers_org_active;
-- drop index if exists public.idx_phone_numbers_e164;
-- drop table if exists public.phone_numbers;

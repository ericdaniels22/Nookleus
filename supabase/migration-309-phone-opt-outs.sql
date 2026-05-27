-- issue #309 (PRD #304, ADR 0003) — phone_opt_outs table.
--
-- Purpose:   The TCPA opt-out registry. One row per outside phone number
--            that has texted STOP / UNSUBSCRIBE / END / QUIT / CANCEL /
--            STOPALL to any of the Organization's numbers. The registry is
--            ORG-SCOPED — when a customer opts out by texting any one of
--            our numbers, every number in the same Organization is blocked
--            from texting them going forward, until an admin re-opts-in.
--
-- Shape:     Schema is PRD #304 § Schema verbatim. UNIQUE (organization_id,
--            outside_e164) is the natural key — an outside number can only
--            be opted-out-or-not per org, not per (org, our-number) pair.
--            `re_opted_in_at` is admin-set after fresh consent; `note` is
--            a free-text record of why (audit trail). Once `re_opted_in_at`
--            is non-null the row no longer blocks outbound.
--
-- RLS:       Org-scoped on SELECT and UPDATE. INSERT is permitted to any
--            authenticated member of the org (the inbound webhook writes
--            via the Service client, bypassing RLS; the policy is the
--            User-client backstop). Admin-only UPDATE for the re-opt-in
--            path, since admin is the action that resumes outbound from
--            a customer who previously opted out.
--
-- Indexes:   UNIQUE (organization_id, outside_e164) doubles as the lookup
--            index for the outbound-send opt-out check ("is +1XXX opted
--            out for this org?"). No additional index needed.
--
-- Depends on: schema.sql (organizations), migration-build45 (org_id
--            columns), schema for `nookleus.active_organization_id()` /
--            `is_member_of()`.
--
-- Smoke test: supabase/migration-309-smoke-test.sql exercises:
--              - UNIQUE constraint blocks duplicate (org, outside) opt-out
--              - cross-org isolation: opt-out in org A is invisible to org B
--              - admin can update re_opted_in_at; non-admin cannot
--              - inbound-webhook-style Service-client INSERT bypasses RLS
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The table itself.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_opt_outs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  -- The outside number that texted STOP. Always E.164, normalized at the
  -- write site (route-inbound / the opt-out classifier produce E.164 input).
  outside_e164        text not null,
  -- Timestamp of the STOP message. Set on insert; never updated.
  opted_out_at        timestamptz not null default now(),
  -- NULL means "still opted out". Non-NULL is the admin's
  -- re-opt-in timestamp — set when the admin acknowledges fresh consent
  -- from the customer.
  re_opted_in_at      timestamptz,
  -- Free-text admin note recorded at re-opt-in time. The PRD AC requires
  -- a "free-text note" so the admin records why fresh consent was given —
  -- this is the audit trail for the resumption.
  re_opted_in_note    text,
  -- Admin who acknowledged the re-opt-in, for the audit trail.
  re_opted_in_by_user_id uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Natural key — one row per (org, outside number). Upsert-by-conflict
  -- on this constraint is the inbound STOP path; the row already exists
  -- means "this number opted out before".
  constraint phone_opt_outs_org_outside_unique unique (organization_id, outside_e164)
);

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_phone_opt_outs_updated_at on public.phone_opt_outs;
create trigger trg_phone_opt_outs_updated_at
  before update on public.phone_opt_outs
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS.
--    SELECT — any member of the active org can read the registry, because
--             every Crew Lead in the org needs to know the customer has
--             opted out (the compose box's pre-send opt-out check uses
--             this surface).
--    INSERT — gated to membership; the webhook uses the Service client to
--             bypass when no auth user is present.
--    UPDATE — admin-only (re-opt-in is an admin action per PRD AC #11).
-- ---------------------------------------------------------------------------
alter table public.phone_opt_outs enable row level security;

drop policy if exists phone_opt_outs_select on public.phone_opt_outs;
create policy phone_opt_outs_select on public.phone_opt_outs
  for select to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  );

drop policy if exists phone_opt_outs_insert on public.phone_opt_outs;
create policy phone_opt_outs_insert on public.phone_opt_outs
  for insert to authenticated
  with check (
    organization_id = nookleus.active_organization_id()
    and nookleus.is_member_of(organization_id)
  );

drop policy if exists phone_opt_outs_update on public.phone_opt_outs;
create policy phone_opt_outs_update on public.phone_opt_outs
  for update to authenticated
  using (
    organization_id = nookleus.active_organization_id()
    and exists (
      select 1
        from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = phone_opt_outs.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    organization_id = nookleus.active_organization_id()
  );

-- ROLLBACK ---
-- drop policy if exists phone_opt_outs_update on public.phone_opt_outs;
-- drop policy if exists phone_opt_outs_insert on public.phone_opt_outs;
-- drop policy if exists phone_opt_outs_select on public.phone_opt_outs;
-- alter table public.phone_opt_outs disable row level security;
-- drop trigger if exists trg_phone_opt_outs_updated_at on public.phone_opt_outs;
-- drop table if exists public.phone_opt_outs;

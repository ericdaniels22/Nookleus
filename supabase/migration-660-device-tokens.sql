-- issue #671 (feature #667, ADR 0016) — device_tokens table.
--
-- Purpose:   The device-address registry for new-intake push. One row per
--            (Org member, device): the APNs push token a member's device hands
--            us when it registers, scoped to the Organization that member was
--            acting in. The new-intake dispatcher (a later slice) reads this
--            registry to learn which device addresses to buzz; THIS slice only
--            fills it — no push is sent here.
--
-- Shape:     Uniqueness is on the token itself (`device_tokens_token_unique`).
--            Re-registering the same token is an upsert-on-conflict(token) that
--            refreshes the existing row (org, updated_at) instead of inserting
--            a duplicate — the common "app reopened, same token" case. A
--            genuinely rotated token arrives as a NEW value (a new row); the
--            stale row is pruned once APNs reports it unregistered. There is no
--            device_id column because the Capacitor push plugin hands us no
--            stable per-device identifier — the token IS the device address.
--            `platform` is locked to 'ios' this slice (a future Android slice
--            extends the check).
--
-- RLS:       User-scoped own-rows. A member may read/write ONLY rows whose
--            user_id is their own auth.uid(); INSERT additionally requires the
--            stamped org to be one they belong to. Cross-user reads (the
--            dispatcher listing tokens for a set of members) and prunes run
--            through the Service client, which bypasses RLS — the policy is the
--            User-client backstop. See src/lib/notifications/device-tokens.ts.
--
-- Indexes:   `device_tokens_token_unique` UNIQUE(token) doubles as the upsert
--            conflict target and the dead-token prune lookup. A secondary
--            index on user_id serves the dispatcher's list-by-members read.
--
-- Depends on: schema.sql (organizations, auth.users, public.update_updated_at,
--            nookleus.is_member_of / active_organization_id).
--
-- Smoke test: supabase/migration-660-smoke-test.sql exercises, on real RLS:
--              - a member sees only their own device tokens, never another's
--              - a member cannot insert a row stamped with another user_id
--              - a Service-client read sees every org's rows (fan-out path)
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The table itself.
-- ---------------------------------------------------------------------------
create table if not exists public.device_tokens (
  id              uuid primary key default gen_random_uuid(),
  -- The member who owns this device address. Cascade-deleted with the user.
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- The Org the member was acting in when they registered this device.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The APNs device token — the device address a push targets.
  token           text not null,
  -- Locked to 'ios' this slice; a future Android slice widens the check.
  platform        text not null default 'ios',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint device_tokens_platform_check check (platform in ('ios')),
  -- Natural key — uniqueness on the token. Upsert-by-conflict on this
  -- constraint is the register-or-refresh path.
  constraint device_tokens_token_unique unique (token)
);

-- The dispatcher lists tokens for a set of member ids; index that read.
create index if not exists device_tokens_user_id_idx
  on public.device_tokens (user_id);

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_device_tokens_updated_at on public.device_tokens;
create trigger trg_device_tokens_updated_at
  before update on public.device_tokens
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — user-scoped own-rows.
--    SELECT/UPDATE/DELETE — the row's user_id must be the caller's auth.uid().
--    INSERT — same, plus the stamped org must be one the caller belongs to, so
--             a member cannot register a device under an org they're not in.
--    Cross-user reads/prunes use the Service client (RLS bypassed).
-- ---------------------------------------------------------------------------
alter table public.device_tokens enable row level security;

drop policy if exists device_tokens_select on public.device_tokens;
create policy device_tokens_select on public.device_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists device_tokens_insert on public.device_tokens;
create policy device_tokens_insert on public.device_tokens
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and nookleus.is_member_of(organization_id)
  );

drop policy if exists device_tokens_update on public.device_tokens;
create policy device_tokens_update on public.device_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists device_tokens_delete on public.device_tokens;
create policy device_tokens_delete on public.device_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- ROLLBACK ---
-- drop policy if exists device_tokens_delete on public.device_tokens;
-- drop policy if exists device_tokens_update on public.device_tokens;
-- drop policy if exists device_tokens_insert on public.device_tokens;
-- drop policy if exists device_tokens_select on public.device_tokens;
-- alter table public.device_tokens disable row level security;
-- drop trigger if exists trg_device_tokens_updated_at on public.device_tokens;
-- drop index if exists public.device_tokens_user_id_idx;
-- drop table if exists public.device_tokens;

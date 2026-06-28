-- issue #615 (parent PRD #603) — per-Organization Google connection.
--
-- The first slice of the Marketing Suite's Google integration (ADR 0015). One
-- OAuth link per Organization carries everything Google: Business Profile
-- reviews, GBP posts/performance, Search Console, and Ads reporting all ride
-- this single connection. The rest of the suite never sees tokens — it asks the
-- deep module (src/lib/google/client.ts) for an authorized client.
--
-- Trust shape (CONTEXT.md "Website connection" / "QuickBooks connection"):
-- per-Organization, opt-in, encrypted at rest, never a shared admin login.
-- Mirrors qb_connection but with three deliberate differences:
--
--   1. ONE ROW PER ORG (uniq_google_connection_org), not an append-on-reconnect
--      history. Disconnect DELETES the row (the app also revokes the token at
--      Google first); reconnect upserts. "Disconnected" is therefore the
--      ABSENCE of a row — there is no inactive-but-retained credential to leak.
--
--   2. A `status` enum ('connected' | 'broken') instead of qb's is_active
--      boolean. 'broken' is the remotely-revoked / refresh-failed state that
--      surfaces the reconnect prompt; the token chokepoint flips it on an
--      invalid_grant and never on a transient network error.
--
--   3. ADMIN-ONLY RLS. Marketing surfaces are admin-only (like /marketing), so
--      the policy requires uo.role = 'admin' — not merely org membership. This
--      is the qb_connection_admin shape modernised onto active_organization_id().
--
-- Tokens: refresh_token_encrypted is the long-lived credential (AES-256-GCM via
-- src/lib/encryption.ts, same ENCRYPTION_KEY as qb / email). access_token_*
-- cache the short-lived token so not every call hits Google's token endpoint;
-- both are nullable because a freshly-broken row may have no usable access token.
--
-- Depends on: schema.sql (organizations, user_organizations,
--             nookleus.active_organization_id(), update_updated_at()),
--             auth.users.
--
-- Smoke test: supabase/migration-615-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- google_connection — one Organization's link to its Google account.
-- ---------------------------------------------------------------------------
create table if not exists public.google_connection (
  id                      uuid primary key default gen_random_uuid(),
  -- One per Organization (uniq index below). CASCADE so deleting an org takes
  -- its connection with it — there is no cross-org audit value in keeping it.
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  -- The connected Google account, for display ("Connected as owner@aaa.com").
  -- Set from the OIDC userinfo response at connect time.
  google_account_email    text,
  google_account_name     text,
  -- Long-lived credential — the only thing a refresh truly needs. Encrypted.
  refresh_token_encrypted text not null,
  -- Cached short-lived access token + its expiry. Nullable: a broken row, or a
  -- row whose cache was never warmed, simply has no access token and the
  -- chokepoint refreshes on next use.
  access_token_encrypted  text,
  access_token_expires_at timestamptz,
  -- The scopes Google actually granted (from the token response). Lets the UI
  -- and later slices reason about which features the link can serve.
  scopes                  text[] not null default '{}',
  -- 'connected'  — usable.
  -- 'broken'     — the refresh token was rejected (revoked at Google or
  --                expired); the UI shows a reconnect prompt. Set only on an
  --                invalid_grant, never on a transient error.
  status                  text not null default 'connected'
                            check (status in ('connected', 'broken')),
  broken_reason           text,
  broken_at               timestamptz,
  -- Who clicked Connect. SET NULL so the row survives that user being removed.
  connected_by            uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- One connection per Organization. The callback upserts on this key, so a
-- reconnect overwrites the prior row rather than stacking a second.
create unique index if not exists uniq_google_connection_org
  on public.google_connection (organization_id);

create trigger trg_google_connection_updated_at
  before update on public.google_connection
  for each row execute function update_updated_at();

alter table public.google_connection enable row level security;

-- Admin-only, org-scoped. Marketing is an admin surface, so membership alone is
-- not enough — uo.role must be 'admin'. Service-role callers (the OAuth callback
-- and the deep module) bypass RLS; this policy backstops the User client.
create policy google_connection_admin
  on public.google_connection for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = google_connection.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = google_connection.organization_id
         and uo.role = 'admin'
    )
  );

-- ROLLBACK ---
-- drop policy if exists google_connection_admin on public.google_connection;
-- drop trigger if exists trg_google_connection_updated_at on public.google_connection;
-- drop index if exists public.uniq_google_connection_org;
-- drop table if exists public.google_connection;

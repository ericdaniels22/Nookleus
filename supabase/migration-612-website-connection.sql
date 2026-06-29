-- issue #612 (parent PRD #603) — per-Organization Website (WordPress) connection.
--
-- The Marketing Suite's publishing target (ADR 0015 / CONTEXT.md "Website
-- connection"): one WordPress link per Organization that Showcase posts ride.
-- The admin pastes the site URL, a WordPress username, and an Application
-- Password into Settings; Save validates them against the live WordPress REST
-- API (it must be able to publish posts) before a row is ever written. The rest
-- of the suite never sees the password — it asks the deep module
-- (src/lib/website/*) to act on the connection.
--
-- Trust shape mirrors google_connection (migration-615) with WordPress-specific
-- differences:
--
--   1. NO OAuth. WordPress has no app-level OAuth and no remote revoke endpoint.
--      The credential is a pasted Application Password, stored encrypted
--      (AES-256-GCM via src/lib/encryption.ts, same ENCRYPTION_KEY as Google /
--      qb / email). There is no refresh/access-token cache — a WordPress
--      Application Password is long-lived until revoked on the WordPress side.
--
--   2. ONE ROW PER ORG (uniq_website_connection_org), not an append-on-reconnect
--      history. Disconnect DELETES the row (WordPress has no remote revoke, so we
--      simply drop our copy); reconnect upserts. "Disconnected" is therefore the
--      ABSENCE of a row — no inactive-but-retained credential to leak.
--
--   3. A `status` enum ('connected' | 'broken'). 'broken' is the revoked /
--      changed-password state that surfaces the reconnect prompt; the publish
--      chokepoint flips it on a WordPress 401 and never on a transient error.
--
--   4. ADMIN-ONLY RLS. Marketing surfaces are admin-only (like /marketing), so
--      the policy requires uo.role = 'admin' — not merely org membership. This is
--      the google_connection_admin shape applied to website_connection.
--
-- Depends on: schema.sql (organizations, user_organizations,
--             nookleus.active_organization_id(), update_updated_at()),
--             auth.users.
--
-- Smoke test: supabase/migration-612-smoke-test.sql.
--
-- Revert:    see the ROLLBACK block at the bottom of this file.

-- ---------------------------------------------------------------------------
-- website_connection — one Organization's link to its WordPress site.
-- ---------------------------------------------------------------------------
create table if not exists public.website_connection (
  id                             uuid primary key default gen_random_uuid(),
  -- One per Organization (uniq index below). CASCADE so deleting an org takes
  -- its connection with it — there is no cross-org audit value in keeping it.
  organization_id                uuid not null references public.organizations(id) on delete cascade,
  -- The website platform. Only WordPress today; a check keeps the column honest
  -- and leaves room to widen the vocabulary deliberately later.
  provider                       text not null default 'wordpress'
                                   check (provider in ('wordpress')),
  -- The normalized WordPress site URL (scheme + host + optional subdir), the
  -- WordPress username, and the Application Password — encrypted, never stored
  -- in the clear. The username is needed alongside the password for HTTP Basic
  -- auth against the WordPress REST API.
  site_url                       text not null,
  username                       text not null,
  application_password_encrypted text not null,
  -- The connected WordPress display name, for the UI ("Connected as …"). Set
  -- from /wp-json/wp/v2/users/me at connect time. Nullable — display only.
  account_name                   text,
  -- 'connected'  — usable.
  -- 'broken'     — the Application Password was rejected (revoked or changed on
  --                WordPress, or publish rights lost); the UI shows a reconnect
  --                prompt. Set only on a WordPress 401, never on a transient
  --                error.
  status                         text not null default 'connected'
                                   check (status in ('connected', 'broken')),
  broken_reason                  text,
  broken_at                      timestamptz,
  -- Who clicked Connect. SET NULL so the row survives that user being removed.
  connected_by                   uuid references auth.users(id) on delete set null,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

-- One connection per Organization. The connect route upserts on this key, so a
-- reconnect overwrites the prior row rather than stacking a second.
create unique index if not exists uniq_website_connection_org
  on public.website_connection (organization_id);

create trigger trg_website_connection_updated_at
  before update on public.website_connection
  for each row execute function update_updated_at();

alter table public.website_connection enable row level security;

-- Admin-only, org-scoped. Marketing is an admin surface, so membership alone is
-- not enough — uo.role must be 'admin'. Service-role callers (the connect /
-- disconnect routes and the deep module) bypass RLS; this policy backstops the
-- User client.
create policy website_connection_admin
  on public.website_connection for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = website_connection.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = website_connection.organization_id
         and uo.role = 'admin'
    )
  );

-- ROLLBACK ---
-- drop policy if exists website_connection_admin on public.website_connection;
-- drop trigger if exists trg_website_connection_updated_at on public.website_connection;
-- drop index if exists public.uniq_website_connection_org;
-- drop table if exists public.website_connection;

-- Self-contained schema for the embedded-postgres website_connection harness
-- (#612). Loaded by website-connection.pg.test.ts into a throwaway cluster so
-- the LIVE migration-612 applies verbatim — no copy-paste drift.
--
-- This is NOT the Supabase stack: there is no PostgREST. RLS, however, IS
-- exercised here. migration-612's policy is ADMIN-ONLY: it requires a real
-- user_organizations row with role = 'admin' (not mere membership), so unlike
-- the device-tokens harness we cannot stub membership with a function — this
-- shim defines a REAL user_organizations table the policy's EXISTS reads. The
-- nookleus + auth shims read GUCs so a `SET ROLE authenticated` block can drive
-- the policy: test.org feeds active_organization_id(), test.uid feeds auth.uid().
-- Structural tests run as the superuser owner (RLS bypassed) and ignore the
-- shims. The same RLS contract is pinned again against real prod by
-- supabase/migration-612-smoke-test.sql.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- nookleus + auth helper shims. migration-612's policy references auth.uid() and
-- nookleus.active_organization_id(); both read GUCs so the RLS test can
-- impersonate an admin caller active in a chosen org.
CREATE SCHEMA IF NOT EXISTS nookleus;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION nookleus.active_organization_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.org', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- The updated_at trigger function migration-612's trigger executes. Prod body
-- lives in supabase/schema.sql; this is the same one-liner.
CREATE OR REPLACE FUNCTION public.update_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Minimal auth.users: the FK target for website_connection.connected_by. Prod
-- has many more columns (GoTrue); the FK only needs id.
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Minimal organizations: the FK target for website_connection.organization_id.
CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  slug       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- REAL user_organizations: the admin-only policy's EXISTS reads role here, so
-- the RLS test promotes a member to 'admin' and watches the row become visible.
-- role is plain text (no check) — the shim need not mirror prod's full role
-- vocabulary, only carry 'admin' vs anything-else.
CREATE TABLE public.user_organizations (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'crew_member',
  PRIMARY KEY (user_id, organization_id)
);

-- `authenticated` needs schema + helper + membership-read access to evaluate the
-- policy expressions under SET ROLE. website_connection privileges are granted
-- after migration-612 creates it (see the pg test), since it does not exist yet.
GRANT USAGE ON SCHEMA nookleus, auth TO authenticated;
GRANT SELECT ON public.user_organizations TO authenticated;

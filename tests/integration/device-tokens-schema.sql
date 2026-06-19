-- Self-contained schema for the embedded-postgres device_tokens harness
-- (#671). Loaded by device-tokens.pg.test.ts into a throwaway cluster so the
-- LIVE migration-660 applies verbatim — no copy-paste drift.
--
-- This is NOT the Supabase stack: there is no PostgREST. RLS, however, IS
-- exercised here: like the conversation-owner harness, the nookleus + auth
-- shims read GUCs so a `SET ROLE authenticated` block can drive the policies
-- (the test sets test.uid to impersonate a caller). Structural tests run as the
-- superuser owner (RLS bypassed) and ignore the shims. The same RLS contract is
-- pinned again against real prod by supabase/migration-660-smoke-test.sql.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- nookleus + auth helper shims. migration-660's policies reference auth.uid()
-- and nookleus.is_member_of(); auth.uid() reads the test.uid GUC so the RLS
-- test can impersonate a caller. is_member_of() returns true — org membership
-- is not what the user-scoped isolation test is about, and structural tests
-- bypass RLS entirely.
CREATE SCHEMA IF NOT EXISTS nookleus;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION nookleus.active_organization_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.org', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION nookleus.is_member_of(uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- The updated_at trigger function migration-660's trigger executes. Prod body
-- lives in supabase/schema.sql; this is the same one-liner.
CREATE OR REPLACE FUNCTION public.update_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Minimal auth.users: the FK target for device_tokens.user_id. Prod has many
-- more columns (GoTrue); the FK only needs id.
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Minimal organizations: the FK target for device_tokens.organization_id.
CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  slug       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- `authenticated` needs schema + helper access to evaluate the policy
-- expressions under SET ROLE. Table privileges are granted after migration-660
-- creates device_tokens (see the pg test), since the table does not exist yet.
GRANT USAGE ON SCHEMA nookleus, auth TO authenticated;

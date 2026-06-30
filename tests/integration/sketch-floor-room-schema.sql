-- Self-contained schema for the embedded-postgres Sketch/Floor/Room harness
-- (#860). Loaded by sketch-floor-room.pg.test.ts into a throwaway cluster so the
-- LIVE migration-build88 applies verbatim — no copy-paste drift.
--
-- This is NOT the Supabase stack: there is no PostgREST. RLS, however, IS
-- exercised here (like the device-tokens harness): the nookleus + auth shims read
-- GUCs so a `SET ROLE authenticated` block can drive the org-isolation policies.
-- migration-build88's policies are tenant-scoped — `organization_id =
-- nookleus.active_organization_id()` — so the org-isolation test sets test.org to
-- impersonate "the org the caller is acting in". Structural tests run as the
-- superuser owner (RLS bypassed) and ignore the shims.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- nookleus + auth helper shims. migration-build88's policies reference
-- nookleus.active_organization_id(); it reads the test.org GUC so the RLS test
-- can impersonate the caller's active org. is_member_of() / auth.uid() are
-- provided too (unused by these policies, but cheap and matches the prod schema
-- surface) so the migration's GRANTs and any future predicate load verbatim.
CREATE SCHEMA IF NOT EXISTS nookleus;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION nookleus.active_organization_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.org', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION nookleus.is_member_of(uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- The updated_at trigger function migration-build88's triggers execute. Prod
-- body lives in supabase/schema.sql; this is the same one-liner.
CREATE OR REPLACE FUNCTION public.update_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Minimal organizations: the FK target for *.organization_id. Prod has more
-- columns; the FK only needs id.
CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  slug       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Minimal jobs: the FK target for sketches.job_id. Prod has many more columns;
-- the Sketch FK only needs id (job_number kept for realistic seeding).
CREATE TABLE public.jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_number      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- `authenticated` needs schema + helper access to evaluate the policy
-- expressions under SET ROLE. Table privileges are granted after migration-build88
-- creates the tables (see the pg test), since they do not exist yet.
GRANT USAGE ON SCHEMA nookleus, auth TO authenticated;

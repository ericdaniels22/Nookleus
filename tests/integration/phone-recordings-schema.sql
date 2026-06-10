-- Self-contained schema for the embedded-postgres phone_recordings harness
-- (#315). Loaded by phone-recordings.pg.test.ts into a throwaway cluster.
--
-- This is NOT the Supabase stack: there is no PostgREST, and RLS is NOT
-- enforced (the harness connects as the cluster superuser, which bypasses row
-- security). It is the smallest schema that lets the LIVE migration-315 apply
-- verbatim — no copy-paste drift — so the pg suite can pin the structural
-- contract (FK CASCADE, UNIQUE(phone_call_id), the consent_notice_played and
-- organizations.recording_enabled_default defaults). The ADR-0005 RLS matrix
-- is pinned separately by supabase/migration-315-smoke-test.sql (run via the
-- Supabase MCP, where SET ROLE authenticated actually exercises the policy).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- The nookleus helper schema. migration-315's SELECT policy references
-- nookleus.active_organization_id(); stub it so `create policy` parses. (Its
-- return value is irrelevant here — RLS isn't enforced under the superuser.)
CREATE SCHEMA IF NOT EXISTS nookleus;
CREATE OR REPLACE FUNCTION nookleus.active_organization_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

-- Minimal organizations: the FK target for phone_recordings.organization_id
-- and the table migration-315 ALTERs to add recording_enabled_default.
CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  slug       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Minimal phone_calls: the parent the recording FK-cascades from and the RLS
-- subquery reads. Only the columns the cascade test touches (prod shape lives
-- in supabase/migration-312-phone-calls.sql).
CREATE TABLE public.phone_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

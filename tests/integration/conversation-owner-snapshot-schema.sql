-- Self-contained schema for the embedded-postgres conversation-owner-snapshot
-- harness (#317). Loaded by conversation-owner-snapshot.pg.test.ts into a
-- throwaway cluster so the LIVE migration-316 applies verbatim — no copy-paste
-- drift.
--
-- This is NOT the Supabase stack: there is no PostgREST, and RLS is NOT
-- enforced (the harness connects as the cluster superuser, which bypasses row
-- security). The pg suite pins the STRUCTURAL contract that does not need RLS
-- to observe — the BEFORE INSERT owner snapshot, its immutability across a
-- later pn.user_id change (the exact behaviour that closes the revive leak),
-- the backfill, and a clean rollback. The ADR-0005 visibility matrix itself is
-- pinned separately by supabase/migration-316-smoke-test.sql (run via the
-- Supabase MCP, where SET ROLE authenticated actually exercises the policy).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- nookleus + auth helper shims. migration-316's rewritten SELECT policies
-- reference nookleus.active_organization_id(), nookleus.is_member_of() and
-- auth.uid(). Unlike the recordings harness (which stubs these to NULL because
-- it never exercises RLS), here they read GUCs so a `SET ROLE authenticated`
-- block can actually drive the policy: the test sets test.uid / test.org to
-- impersonate a caller. Structural tests run as the superuser owner (RLS
-- bypassed) and ignore these entirely.
CREATE SCHEMA IF NOT EXISTS nookleus;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION nookleus.active_organization_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.org', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION nookleus.is_member_of(uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  slug       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name       text
);

CREATE TABLE public.jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE
);

-- phone_numbers: only the columns the snapshot path reads (id, organization_id,
-- user_id). Prod shape lives in supabase/migration-307-phone-numbers.sql.
CREATE TABLE public.phone_numbers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid
);

-- phone_conversations: the table migration-316 ALTERs (adds owner_user_id) and
-- triggers. Column names match migration-308 so the migration applies verbatim.
CREATE TABLE public.phone_conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_number_id     uuid NOT NULL REFERENCES public.phone_numbers(id) ON DELETE CASCADE,
  outside_e164        text NOT NULL,
  contact_id          uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  last_event_at       timestamptz NOT NULL DEFAULT now(),
  unread_count        integer NOT NULL DEFAULT 0,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_conversations_pair_unique UNIQUE (phone_number_id, outside_e164)
);

CREATE TABLE public.phone_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES public.phone_conversations(id) ON DELETE CASCADE,
  direction           text NOT NULL DEFAULT 'in',
  from_e164           text NOT NULL DEFAULT '',
  to_e164             text NOT NULL DEFAULT '',
  body                text,
  job_tag             uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.phone_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id     uuid REFERENCES public.phone_conversations(id) ON DELETE CASCADE,
  job_tag             uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS to match prod so the SET ROLE authenticated block exercises the
-- migration's rewritten policies. The superuser table owner bypasses RLS, so
-- the structural tests (which run as postgres) are unaffected. `authenticated`
-- needs table + helper privileges to evaluate the policy expressions.
ALTER TABLE public.phone_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_calls         ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA nookleus, auth TO authenticated;
GRANT SELECT ON
  public.phone_conversations,
  public.phone_messages,
  public.phone_calls,
  public.jobs
  TO authenticated;

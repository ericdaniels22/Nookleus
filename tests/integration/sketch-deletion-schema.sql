-- Self-contained schema for the embedded-postgres Sketch-deletion harness
-- (#869, S9). Loaded by sketch-deletion.pg.test.ts into a throwaway cluster; the
-- LIVE sketch migrations (build88 → build89 → build91) then create the real
-- sketches/floors/rooms chain on top, and build90 adds the line item's
-- `sketch_source` column — all verbatim, no copy-paste drift.
--
-- This harness proves the delete lifecycle end to end against a real database:
--   * deleting a Sketch cascades its Floors and Rooms (build88's ON DELETE
--     CASCADE) and takes the stored mesh (the row's mesh_ref) with it;
--   * a line item pulled from that Sketch keeps its frozen quantity + snapshot —
--     `sketch_source` is decoupled jsonb with no FK back to the Sketch (ADR 0004),
--     so a deleted source never corrupts a built estimate.
--
-- NOT the Supabase stack: no PostgREST. The delete/cascade/freeze behavior under
-- test is RLS-independent DB machinery, so the tests run as the superuser owner.
-- The nookleus/auth shims + `authenticated` role still exist because build88's
-- policy definitions and GRANTs reference them and must load verbatim; the
-- org-isolation contract itself is covered in sketch-floor-room.pg.test.ts.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- nookleus + auth helper shims: build88's policies reference
-- nookleus.active_organization_id(); the others match the prod surface so the
-- migration's GRANTs and predicates load verbatim.
CREATE SCHEMA IF NOT EXISTS nookleus;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION nookleus.active_organization_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.org', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION nookleus.is_member_of(uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- The updated_at trigger function build88's triggers execute.
CREATE OR REPLACE FUNCTION public.update_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Minimal organizations: the FK target for *.organization_id.
CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  slug       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Minimal jobs: the FK target for sketches.job_id.
CREATE TABLE public.jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_number      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The money tables (migration-build67a: numeric(10,2) money columns). The
-- `sketch_source` column is deliberately ABSENT — the LIVE build90 migration adds
-- it on top so this harness proves the delete leaves that snapshot frozen.
CREATE TABLE public.estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  job_id uuid,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.estimate_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Section',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES public.estimate_sections(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- `authenticated` needs schema + helper access for build88's policy expressions
-- (unused here since the tests run as owner, but the GRANTs must resolve).
GRANT USAGE ON SCHEMA nookleus, auth TO authenticated;

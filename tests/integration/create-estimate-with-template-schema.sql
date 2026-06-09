-- Self-contained schema for the embedded-postgres create_estimate_with_template
-- harness (#571). Loaded by create-estimate-with-template.pg.test.ts into a
-- throwaway cluster.
--
-- This is NOT the Supabase stack: no PostgREST, no RLS, none of the
-- anon/authenticated/service_role grants. It is the smallest schema that lets
-- the LIVE SQL run: the create path's tables (jobs, company_settings,
-- estimates with the numbering/title columns) plus the template tables the
-- delegated apply_template_to_estimate (#382b) touches, typed to match the
-- prod shape (migration-build67a / build46).
--
-- Deliberate divergences from prod, all safe because the functions under test
-- never depend on them:
--   * organization_id columns carry no FK — a fixture is a bare uuid, no
--     organizations row needed.
--   * estimate_line_items.library_item_id is FK-LESS, same reasoning as
--     apply-template-schema.sql (the snapshot keeps dangling breadcrumbs).
--   * auth.uid() is a stub reading the `test.auth_uid` session setting (NULL
--     when unset) — Supabase provides the real one; a bare cluster doesn't.

-- gen_random_uuid() is core since PG 13; keep pgcrypto too for older binaries.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Supabase's auth.uid(), stubbed. create_estimate_with_template stamps
-- created_by with it; tests impersonate via SET test.auth_uid = '<uuid>'.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.auth_uid', true), '')::uuid
$$;

-- Jobs: the create path reads organization_id; generate_estimate_number reads
-- job_number (FOR UPDATE) to build `{job_number}-EST-{seq}`.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-org key/value settings: the create path resolves the default estimate
-- title from key = 'default_estimate_title'. Unique shape per build46.
CREATE TABLE company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  key text NOT NULL,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

-- Templates: apply_template_to_estimate reads `structure` (the sections/items
-- JSONB tree), is_active, organization_id, and the opening/closing statements.
CREATE TABLE estimate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  name text NOT NULL,
  description text,
  opening_statement text,
  closing_statement text,
  structure jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Estimates: the create path inserts the draft (number, title, created_by);
-- apply locks it, guards on status/emptiness, reads the markup/discount/tax
-- settings, and writes back the resolved totals. Defaults mirror prod so a
-- fresh draft has zero totals. Status set + UNIQUE(job_id, sequence_number)
-- per migration-build67a.
CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id),
  estimate_number text UNIQUE NOT NULL,
  sequence_number integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'converted', 'voided')),
  opening_statement text,
  closing_statement text,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  markup_type text NOT NULL DEFAULT 'none' CHECK (markup_type IN ('percent', 'amount', 'none')),
  markup_value numeric(10,2) NOT NULL DEFAULT 0,
  markup_amount numeric(10,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('percent', 'amount', 'none')),
  discount_value numeric(10,2) NOT NULL DEFAULT 0,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  adjusted_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, sequence_number)
);

-- Sections: one row per template section AND per subsection (subsections
-- carry a non-null parent_section_id back to their parent).
CREATE TABLE estimate_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES estimate_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Line items: the resolved snapshot for every template item. See the header
-- note on why library_item_id has no FK.
CREATE TABLE estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES estimate_sections(id) ON DELETE CASCADE,
  library_item_id uuid,
  name text,
  description text NOT NULL,
  note text,
  code text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

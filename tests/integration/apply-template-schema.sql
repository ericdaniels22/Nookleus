-- Self-contained schema for the embedded-postgres apply_template_to_estimate
-- harness (#351). Loaded by apply-template.pg.test.ts into a throwaway cluster.
--
-- This is NOT the Supabase stack: there is no PostgREST, no RLS, and none of
-- the anon/authenticated/service_role grants the shared schema.sql carries.
-- It is the smallest schema that lets the LIVE migration-351 function run:
-- the five tables it reads/writes, with only the columns it actually touches,
-- typed to match the prod shape (migration-build67a).
--
-- Deliberate divergences from prod, both safe because the RPC never depends on
-- them:
--   * estimates drops the NOT NULL job_id FK — so a fixture is just an
--     estimate + a template, no contact/job chain.
--   * estimate_line_items.library_item_id is FK-LESS — the RPC keeps the
--     breadcrumb even when the library row is gone (the broken_refs path), so
--     a FK here would reject exactly the dangling-reference case we test.

-- gen_random_uuid() is core since PG 13; keep pgcrypto too for older binaries.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Library: read for the legacy "resolve from library" fallback rung.
CREATE TABLE item_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  name text NOT NULL,
  description text NOT NULL,
  code text,
  category text NOT NULL DEFAULT 'services'
    CHECK (category IN ('labor', 'equipment', 'materials', 'services', 'other')),
  default_quantity numeric(10,2) NOT NULL DEFAULT 1,
  default_unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Templates: the RPC reads `structure` (the sections/items JSONB tree),
-- is_active, organization_id, and the opening/closing statements.
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

-- Estimates: the RPC locks it, guards on status/emptiness, reads the
-- markup/discount/tax settings, and writes back the resolved totals + the
-- statements. Defaults mirror prod so an untouched estimate has total = subtotal.
CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
  code text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

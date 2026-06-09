-- Self-contained schema for the embedded-postgres convert_estimate_to_invoice
-- harness (#382). Loaded by convert-estimate.pg.test.ts into a throwaway cluster.
--
-- Like apply-template-schema.sql, this is NOT the Supabase stack: no PostgREST,
-- no RLS, no role grants. It is the smallest schema that lets the LIVE
-- convert_estimate_to_invoice function (migration-build67f, then the #382
-- note-aware body swap in migration-382b) run: the tables it reads/writes plus
-- stubs for the two things a bare cluster lacks — generate_invoice_number() and
-- auth.uid(). Columns are typed to match prod (migration-build67a / 67f).
--
-- The `note` columns are baked in here at their final shape (the same divergence
-- apply-template-schema.sql uses for `name`): the focused schema carries the
-- end state, and migration-382a is what adds the column in production.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- auth.uid() — the RPC stamps invoices.created_by with it. A bare cluster has no
-- auth schema; stub it to NULL (created_by is nullable here).
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';

CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  job_id uuid,
  title text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'converted', 'voided')),
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
  converted_to_invoice_id uuid,
  converted_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- estimate_templates is not exercised by the convert RPC, but migration-382b
-- also (re)defines apply_template_to_estimate, whose `v_template
-- estimate_templates%ROWTYPE` declaration is resolved at CREATE time. A minimal
-- table lets 382b load cleanly; the convert tests never touch it.
CREATE TABLE estimate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  name text NOT NULL,
  opening_statement text,
  closing_statement text,
  structure jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE estimate_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES estimate_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  job_id uuid,
  invoice_number text,
  sequence_number integer,
  title text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'voided')),
  issued_date date,
  due_date date,
  opening_statement text,
  closing_statement text,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  markup_type text NOT NULL DEFAULT 'none',
  markup_value numeric(10,2) NOT NULL DEFAULT 0,
  markup_amount numeric(10,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'none',
  discount_value numeric(10,2) NOT NULL DEFAULT 0,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  adjusted_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  converted_from_estimate_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  library_item_id uuid,
  name text,
  description text NOT NULL,
  note text,
  code text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_settings (
  organization_id uuid,
  key text,
  value text
);

-- generate_invoice_number() lives in an earlier migration the RPC depends on.
-- Stub it to a deterministic number so the conversion under test is the only
-- thing exercised.
CREATE OR REPLACE FUNCTION generate_invoice_number(p_job_id uuid)
RETURNS TABLE(invoice_number text, sequence_number integer)
LANGUAGE sql AS $$ SELECT 'INV-TEST-0001'::text, 1::integer $$;

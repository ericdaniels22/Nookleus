-- Build 67a — Estimates & Invoices Foundation
-- Spec: docs/superpowers/specs/2026-04-30-build-67a-estimates-foundation-design.md
-- Pre-flight: INV-2026-0001 + its 2 invoice_line_items rows must be deleted before this runs.

-- ============================================================================
-- 1. Drop legacy line_items (Build 6 artifact, 0 rows, superseded by invoice_line_items in Build 38)
-- ============================================================================
DROP TABLE IF EXISTS line_items CASCADE;

-- ============================================================================
-- 2. item_library
-- ============================================================================
CREATE TABLE item_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  code text,
  category text NOT NULL DEFAULT 'services'
    CHECK (category IN ('labor','equipment','materials','services','other')),
  default_quantity numeric(10,2) NOT NULL DEFAULT 1,
  default_unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  damage_type_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_item_library_org ON item_library(organization_id);
CREATE INDEX idx_item_library_category ON item_library(category);
CREATE INDEX idx_item_library_active ON item_library(is_active);
CREATE INDEX idx_item_library_damage_tags ON item_library USING GIN (damage_type_tags);
CREATE INDEX idx_item_library_section_tags ON item_library USING GIN (section_tags);

ALTER TABLE item_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_library
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_item_library_updated_at
  BEFORE UPDATE ON item_library FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 3. estimates
-- ============================================================================
CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  estimate_number text UNIQUE NOT NULL,
  sequence_number integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','approved','rejected','converted','voided')),
  opening_statement text,
  closing_statement text,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  markup_type text NOT NULL DEFAULT 'none'
    CHECK (markup_type IN ('percent','amount','none')),
  markup_value numeric(10,2) NOT NULL DEFAULT 0,
  markup_amount numeric(10,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('percent','amount','none')),
  discount_value numeric(10,2) NOT NULL DEFAULT 0,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  adjusted_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  issued_date date DEFAULT CURRENT_DATE,
  valid_until date,
  converted_to_invoice_id uuid,
  converted_at timestamptz,
  sent_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, sequence_number)
);
CREATE INDEX idx_estimates_org ON estimates(organization_id);
CREATE INDEX idx_estimates_job_id ON estimates(job_id);
CREATE INDEX idx_estimates_status ON estimates(status);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimates
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 4. estimate_sections
-- ============================================================================
CREATE TABLE estimate_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES estimate_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_estimate_sections_org ON estimate_sections(organization_id);
CREATE INDEX idx_estimate_sections_estimate_id ON estimate_sections(estimate_id);
CREATE INDEX idx_estimate_sections_parent ON estimate_sections(parent_section_id);

ALTER TABLE estimate_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimate_sections
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimate_sections_updated_at
  BEFORE UPDATE ON estimate_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 5. estimate_line_items
-- ============================================================================
CREATE TABLE estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES estimate_sections(id) ON DELETE CASCADE,
  library_item_id uuid REFERENCES item_library(id) ON DELETE SET NULL,
  description text NOT NULL,
  code text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_estimate_line_items_org ON estimate_line_items(organization_id);
CREATE INDEX idx_estimate_line_items_estimate_id ON estimate_line_items(estimate_id);
CREATE INDEX idx_estimate_line_items_section_id ON estimate_line_items(section_id);

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimate_line_items
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimate_line_items_updated_at
  BEFORE UPDATE ON estimate_line_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 6. estimate_templates (table only; no UI in 67a)
-- ============================================================================
CREATE TABLE estimate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  damage_type_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  opening_statement text,
  closing_statement text,
  structure jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_estimate_templates_org ON estimate_templates(organization_id);
CREATE INDEX idx_estimate_templates_active ON estimate_templates(is_active);

ALTER TABLE estimate_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimate_templates
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_estimate_templates_updated_at
  BEFORE UPDATE ON estimate_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 7. pdf_presets (table only; no UI in 67a)
-- ============================================================================
CREATE TABLE pdf_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('estimate','invoice')),
  document_title text NOT NULL,
  group_items_by text NOT NULL DEFAULT 'section',
  show_code boolean NOT NULL DEFAULT true,
  show_description boolean NOT NULL DEFAULT true,
  show_quantity boolean NOT NULL DEFAULT true,
  show_unit_cost boolean NOT NULL DEFAULT true,
  show_total boolean NOT NULL DEFAULT true,
  show_notes boolean NOT NULL DEFAULT false,
  show_markup boolean NOT NULL DEFAULT true,
  show_discount boolean NOT NULL DEFAULT true,
  show_taxes boolean NOT NULL DEFAULT true,
  show_company_details boolean NOT NULL DEFAULT true,
  show_sender_details boolean NOT NULL DEFAULT true,
  show_recipient_details boolean NOT NULL DEFAULT true,
  show_document_details boolean NOT NULL DEFAULT true,
  show_opening_statement boolean NOT NULL DEFAULT true,
  show_line_items boolean NOT NULL DEFAULT true,
  show_category_subtotals boolean NOT NULL DEFAULT false,
  show_total_cost boolean NOT NULL DEFAULT true,
  show_closing_statement boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_presets_org ON pdf_presets(organization_id);
CREATE INDEX idx_pdf_presets_document_type ON pdf_presets(document_type);
CREATE UNIQUE INDEX idx_pdf_presets_one_default_per_type
  ON pdf_presets(organization_id, document_type) WHERE is_default = true;

ALTER TABLE pdf_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pdf_presets
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_pdf_presets_updated_at
  BEFORE UPDATE ON pdf_presets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 8. invoice_sections (table only; no UI in 67a — 67b will use it)
-- ============================================================================
CREATE TABLE invoice_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_sections_org ON invoice_sections(organization_id);
CREATE INDEX idx_invoice_sections_invoice_id ON invoice_sections(invoice_id);

ALTER TABLE invoice_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_sections
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_invoice_sections_updated_at
  BEFORE UPDATE ON invoice_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 9. ALTER invoices to add 67-era columns (Build 6 + 38 → Build 67)
--    Pre-flight: INV-2026-0001 already deleted by Task 1.
-- ============================================================================
ALTER TABLE invoices
  ADD COLUMN sequence_number integer,
  ADD COLUMN title text,
  ADD COLUMN opening_statement text,
  ADD COLUMN closing_statement text,
  ADD COLUMN markup_type text NOT NULL DEFAULT 'none'
    CHECK (markup_type IN ('percent','amount','none')),
  ADD COLUMN markup_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN markup_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_type text NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('percent','amount','none')),
  ADD COLUMN discount_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN adjusted_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN converted_from_estimate_id uuid REFERENCES estimates(id),
  ADD COLUMN void_reason text,
  ADD COLUMN created_by uuid REFERENCES user_profiles(id);

ALTER TABLE invoices
  ALTER COLUMN sequence_number SET NOT NULL,
  ALTER COLUMN title SET NOT NULL;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_job_seq_unique UNIQUE (job_id, sequence_number);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','sent','partial','paid','voided'));

-- ============================================================================
-- 10. ALTER invoice_line_items to add 67-era columns
--     Note: existing columns from Build 38 already cover several needs:
--       - sort_order (already integer NOT NULL DEFAULT 0)
--       - xactimate_code (text, used as `code` via TS mapper in 67a+)
--       - amount (used as `total` via TS mapper)
--     So this ALTER only adds section_id, library_item_id, unit.
-- ============================================================================
ALTER TABLE invoice_line_items
  ADD COLUMN section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  ADD COLUMN library_item_id uuid REFERENCES item_library(id) ON DELETE SET NULL,
  ADD COLUMN unit text;

CREATE INDEX idx_invoice_line_items_section_id ON invoice_line_items(section_id);
CREATE INDEX idx_invoice_line_items_library_item_id ON invoice_line_items(library_item_id);

-- ============================================================================
-- 11. Cross-FK: estimates.converted_to_invoice_id -> invoices.id
-- ============================================================================
ALTER TABLE estimates
  ADD CONSTRAINT fk_estimates_converted_to_invoice
  FOREIGN KEY (converted_to_invoice_id) REFERENCES invoices(id);

-- ============================================================================
-- 12. RPC: generate_estimate_number(p_job_id) — atomic per-job sequence
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_estimate_number(p_job_id uuid)
RETURNS TABLE(estimate_number text, sequence_number integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_job_number text;
  v_seq integer;
BEGIN
  SELECT job_number INTO v_job_number
    FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job_number IS NULL THEN
    RAISE EXCEPTION 'job % not found or not visible to caller', p_job_id;
  END IF;
  SELECT COALESCE(MAX(e.sequence_number), 0) + 1 INTO v_seq
    FROM estimates e WHERE e.job_id = p_job_id;
  estimate_number := v_job_number || '-EST-' || v_seq;
  sequence_number := v_seq;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_estimate_number(uuid) TO authenticated;

-- ============================================================================
-- 13. RPC: generate_invoice_number(p_job_id) — same shape, INV suffix
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_invoice_number(p_job_id uuid)
RETURNS TABLE(invoice_number text, sequence_number integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_job_number text;
  v_seq integer;
BEGIN
  SELECT job_number INTO v_job_number
    FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job_number IS NULL THEN
    RAISE EXCEPTION 'job % not found or not visible to caller', p_job_id;
  END IF;
  SELECT COALESCE(MAX(i.sequence_number), 0) + 1 INTO v_seq
    FROM invoices i WHERE i.job_id = p_job_id;
  invoice_number := v_job_number || '-INV-' || v_seq;
  sequence_number := v_seq;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_invoice_number(uuid) TO authenticated;

-- ============================================================================
-- 14. Seed company_settings keys per organization (idempotent)
-- ============================================================================
INSERT INTO company_settings (organization_id, key, value)
SELECT o.id, kv.key, kv.value
FROM organizations o
CROSS JOIN (VALUES
  ('default_tax_rate', '0.00'),
  ('default_estimate_opening_statement', ''),
  ('default_estimate_closing_statement', ''),
  ('default_invoice_opening_statement', ''),
  ('default_invoice_closing_statement', ''),
  ('default_estimate_valid_days', '30'),
  ('default_invoice_due_days', '30')
) AS kv(key, value)
ON CONFLICT (organization_id, key) DO NOTHING;

-- ============================================================================
-- 15. Extend set_default_permissions with the 12 new keys + backfill
-- ============================================================================
DROP FUNCTION IF EXISTS public.set_default_permissions(uuid, text);
CREATE OR REPLACE FUNCTION public.set_default_permissions(p_user_organization_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  all_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports', 'access_settings',
    'log_expenses', 'manage_vendors', 'manage_contract_templates', 'manage_expense_categories',
    'view_accounting', 'manage_accounting',
    -- Build 67a
    'view_estimates', 'view_invoices',
    'create_estimates', 'edit_estimates', 'convert_estimates', 'send_estimates',
    'create_invoices', 'edit_invoices', 'send_invoices',
    'manage_item_library', 'manage_templates', 'manage_pdf_presets'
  ];
  admin_perms text[] := all_perms;
  lead_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports',
    'log_expenses',
    -- Build 67a
    'view_estimates', 'view_invoices',
    'create_estimates', 'edit_estimates', 'convert_estimates', 'send_estimates',
    'create_invoices', 'edit_invoices', 'send_invoices'
  ];
  member_perms text[] := array[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses',
    -- Build 67a
    'view_estimates', 'view_invoices'
  ];
  granted_perms text[];
  perm text;
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id FROM public.user_organizations WHERE id = p_user_organization_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_default_permissions: user_organization % not found', p_user_organization_id;
  END IF;

  IF p_role = 'admin' THEN
    granted_perms := admin_perms;
  ELSIF p_role = 'crew_lead' THEN
    granted_perms := lead_perms;
  ELSE
    granted_perms := member_perms;
  END IF;

  FOREACH perm IN ARRAY all_perms LOOP
    INSERT INTO public.user_organization_permissions (user_organization_id, permission_key, granted)
    VALUES (p_user_organization_id, perm, perm = ANY(granted_perms))
    ON CONFLICT (user_organization_id, permission_key) DO UPDATE SET granted = excluded.granted;

    -- Legacy mirror — kept in sync per build48 plan
    INSERT INTO public.user_permissions (user_id, permission_key, granted)
    VALUES (v_user_id, perm, perm = ANY(granted_perms))
    ON CONFLICT (user_id, permission_key) DO UPDATE SET granted = excluded.granted;
  END LOOP;
END;
$$;

-- Backfill: re-run for every existing membership so new permission keys propagate.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, role FROM public.user_organizations LOOP
    PERFORM public.set_default_permissions(r.id, r.role);
  END LOOP;
END $$;

-- ============================================
-- AAA Disaster Recovery — Database Schema v1.0
-- Run this in the Supabase SQL Editor
-- ============================================
--
-- Multi-tenancy note: every table below carries `organization_id`
-- (uuid NOT NULL, FK -> organizations ON DELETE RESTRICT) and is guarded by a
-- per-tenant `tenant_isolation_<table>` RLS policy granted to `authenticated`.
-- Those objects assume the core multi-tenant schema already exists — the
-- `organizations` and `user_organizations` tables and the
-- `nookleus.active_organization_id()` helper (added Build 42–58). Several
-- columns/FKs also reference later-domain tables not defined here
-- (`referral_partners`, `photos`, `user_profiles`, `estimates`,
-- `invoice_sections`, `item_library`, `payment_requests`); run those domains'
-- schemas alongside this one.
--
-- Scope: this snapshot mirrors prod's table/column shape, constraints, indexes,
-- and RLS column-for-column. It deliberately does NOT reproduce the
-- cross-domain application triggers prod layers onto these tables (QuickBooks
-- sync, Stripe payment + invoice-status recompute, payer-type recompute,
-- referral-partner eligibility) — those are defined in their own build
-- migrations, not the core schema.

-- ============================================
-- 1. CONTACTS
-- ============================================
-- Columns are listed in production ordinal order so a fresh run mirrors prod
-- exactly. `full_name` sits late because the name-collapse migrations
-- (#109–#115) dropped the original first_name/last_name and added it then.
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text,
  email text,
  role text NOT NULL DEFAULT 'homeowner'
    CHECK (role IN ('homeowner', 'tenant', 'property_manager', 'adjuster', 'insurance', 'referral_contact')),
  company text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  title text,
  qb_customer_id text,                           -- QuickBooks customer link (#37)
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  full_name text NOT NULL,                        -- canonical customer name (#109)
  -- FK to a referral_partners row when role = 'referral_contact' (#250).
  referral_partner_id uuid REFERENCES referral_partners(id) ON DELETE SET NULL
);

-- ============================================
-- 2. JOB NUMBER SEQUENCE (resets yearly)
-- ============================================

-- Sequence for the numeric portion of job numbers
CREATE SEQUENCE job_number_seq START 1;

-- Function to generate job numbers like WTR-2026-0001
CREATE OR REPLACE FUNCTION generate_job_number(damage text)
RETURNS text AS $$
DECLARE
  prefix text;
  seq_num integer;
  current_yr text;
BEGIN
  -- Map damage type to prefix code
  prefix := CASE damage
    WHEN 'water' THEN 'WTR'
    WHEN 'fire' THEN 'FYR'
    WHEN 'mold' THEN 'MLD'
    WHEN 'storm' THEN 'STM'
    WHEN 'biohazard' THEN 'BIO'
    WHEN 'contents' THEN 'CTS'
    WHEN 'rebuild' THEN 'BLD'
    ELSE 'JOB'
  END;

  current_yr := extract(year FROM now())::text;
  seq_num := nextval('job_number_seq');

  RETURN prefix || '-' || current_yr || '-' || lpad(seq_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to reset the sequence each year (call via cron or manually Jan 1)
CREATE OR REPLACE FUNCTION reset_job_number_seq()
RETURNS void AS $$
BEGIN
  ALTER SEQUENCE job_number_seq RESTART WITH 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. JOBS
-- ============================================
-- job_number is unique per Organization (see jobs_org_job_number_key below),
-- not globally. The original status/damage_type CHECK constraints were dropped
-- in prod as those vocabularies grew; both are now free text validated by the
-- app. The legacy single-tenant adjuster_contact_id was replaced by
-- insurance_contact_id (#47) plus the job_adjusters join table.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number text NOT NULL,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  status text NOT NULL DEFAULT 'new',
  urgency text NOT NULL DEFAULT 'scheduled'
    CHECK (urgency IN ('emergency', 'urgent', 'scheduled')),
  damage_type text NOT NULL,
  damage_source text,
  property_address text NOT NULL,
  property_type text
    CHECK (property_type IN ('single_family', 'multi_family', 'commercial', 'condo')),
  property_sqft integer,
  property_stories integer,
  affected_areas text,
  insurance_company text,
  claim_number text,
  access_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  policy_number text,
  date_of_loss date,
  deductible numeric(10,2),
  hoa_name text,
  hoa_contact_name text,
  hoa_contact_phone text,
  hoa_contact_email text,
  has_signed_contract boolean NOT NULL DEFAULT false,
  has_pending_contract boolean NOT NULL DEFAULT false,
  estimated_crew_labor_cost numeric(10,2),
  payer_type text
    CHECK (payer_type IN ('insurance', 'homeowner', 'mixed')),
  qb_subcustomer_id text,                          -- QuickBooks sub-customer link (#37)
  has_pending_payment_request boolean NOT NULL DEFAULT false,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  deleted_at timestamptz,                          -- soft-delete (#66); NULL = live
  cover_photo_id uuid REFERENCES photos(id) ON DELETE SET NULL,
  insurance_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  referral_partner_id uuid REFERENCES referral_partners(id) ON DELETE SET NULL
);

-- Auto-generate job_number on insert using a trigger
CREATE OR REPLACE FUNCTION set_job_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := generate_job_number(NEW.damage_type);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_job_number();

-- ============================================
-- 4. JOB ACTIVITIES
-- ============================================
CREATE TABLE job_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  activity_type text NOT NULL
    CHECK (activity_type IN ('note', 'photo', 'milestone', 'insurance', 'equipment', 'expense')),
  title text NOT NULL,
  description text,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
);

-- ============================================
-- 5. INVOICES
-- ============================================
-- invoice_number is unique per Organization (invoices_org_invoice_number_key
-- below), not globally. `voided_by`/`created_by` reference user_profiles and
-- `converted_from_estimate_id` references estimates — both from later domains
-- (see the multi-tenancy / dependency note at the top of this file).
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  invoice_number text NOT NULL,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'voided')),
  issued_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  qb_invoice_id text,                              -- QuickBooks invoice link (#37)
  sent_at timestamptz,
  voided_at timestamptz,
  voided_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  due_date timestamptz,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(6,4) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  po_number text,
  memo text,
  has_payment_request boolean NOT NULL DEFAULT false,
  stripe_balance_remaining numeric(10,2),          -- Stripe partial-payment tracking (#39)
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL,                -- per-job display sequence
  title text NOT NULL,
  opening_statement text,
  closing_statement text,
  markup_type text NOT NULL DEFAULT 'none'
    CHECK (markup_type IN ('percent', 'amount', 'none')),
  markup_value numeric(10,2) NOT NULL DEFAULT 0,
  markup_amount numeric(10,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('percent', 'amount', 'none')),
  discount_value numeric(10,2) NOT NULL DEFAULT 0,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  adjusted_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  converted_from_estimate_id uuid REFERENCES estimates(id) ON DELETE SET NULL,
  void_reason text,
  created_by uuid REFERENCES user_profiles(id),
  last_sent_at timestamptz,
  last_sent_to_email text,
  deleted_at timestamptz,                          -- soft-delete (#67d); NULL = live
  delete_reason text
);

-- Auto-generate invoice numbers: INV-2026-0001
CREATE SEQUENCE invoice_number_seq START 1;

CREATE OR REPLACE FUNCTION set_invoice_number()
RETURNS trigger AS $$
DECLARE
  current_yr text;
  seq_num integer;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    current_yr := extract(year FROM now())::text;
    seq_num := nextval('invoice_number_seq');
    NEW.invoice_number := 'INV-' || current_yr || '-' || lpad(seq_num::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION set_invoice_number();

-- ============================================
-- 6. INVOICE LINE ITEMS
-- ============================================
-- The single-tenant invoice line-item table was replaced by
-- `invoice_line_items` (the invoice builder, #67). The old `xactimate_code` and
-- the generated `total` column are gone; `amount` is now a plain column the app
-- computes.
-- `section_id`/`library_item_id` reference invoice_sections and item_library
-- from the same invoice-builder domain (not defined in this core file).
CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES invoice_sections(id) ON DELETE CASCADE,
  library_item_id uuid REFERENCES item_library(id) ON DELETE SET NULL,
  unit text,
  code text,
  name text
);

-- ============================================
-- 7. PAYMENTS
-- ============================================
-- The source/method/status CHECKs were widened for Stripe payments (#39):
-- source gains 'stripe', method gains 'stripe_card'/'stripe_ach', status gains
-- 'refunded'. `payment_request_id` references payment_requests (Stripe domain).
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id),
  source text NOT NULL
    CHECK (source IN ('insurance', 'homeowner', 'other', 'stripe')),
  method text NOT NULL
    CHECK (method IN ('check', 'ach', 'venmo_zelle', 'cash', 'credit_card', 'stripe_card', 'stripe_ach')),
  amount numeric(10,2) NOT NULL,
  reference_number text,
  payer_name text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'pending', 'due', 'refunded')),
  notes text,
  received_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  qb_payment_id text,                              -- QuickBooks payment link (#37)
  stripe_payment_intent_id text,
  payment_request_id uuid REFERENCES payment_requests(id) ON DELETE SET NULL,
  stripe_charge_id text,
  stripe_fee_amount numeric(10,2),
  net_amount numeric(10,2),
  quickbooks_sync_status text
    CHECK (quickbooks_sync_status IN ('pending', 'synced', 'failed', 'not_applicable')),
  quickbooks_sync_attempted_at timestamptz,
  quickbooks_sync_error text,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
);

-- ============================================
-- AUTO-UPDATE updated_at TIMESTAMPS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_invoice_line_items_updated_at
  BEFORE UPDATE ON invoice_line_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (multi-tenant isolation)
-- ============================================
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Each core table is scoped to the caller's active Organization: the row's
-- organization_id must be non-null, equal to nookleus.active_organization_id(),
-- and the caller must belong to that Organization (user_organizations). USING
-- and WITH CHECK are identical so the same predicate gates reads, writes, and
-- inserts. Granted to the authenticated role, matching prod.
CREATE POLICY tenant_isolation_contacts ON contacts
  FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = contacts.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = contacts.organization_id
    )
  );

CREATE POLICY tenant_isolation_jobs ON jobs
  FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = jobs.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = jobs.organization_id
    )
  );

CREATE POLICY tenant_isolation_job_activities ON job_activities
  FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = job_activities.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = job_activities.organization_id
    )
  );

CREATE POLICY tenant_isolation_invoices ON invoices
  FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = invoices.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = invoices.organization_id
    )
  );

CREATE POLICY tenant_isolation_invoice_line_items ON invoice_line_items
  FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = invoice_line_items.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = invoice_line_items.organization_id
    )
  );

CREATE POLICY tenant_isolation_payments ON payments
  FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = payments.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = payments.organization_id
    )
  );

-- ============================================
-- INDEXES for common queries
-- ============================================
-- contacts
CREATE INDEX idx_contacts_organization_id ON contacts(organization_id);
CREATE INDEX idx_contacts_referral_partner_id ON contacts(referral_partner_id)
  WHERE referral_partner_id IS NOT NULL;

-- jobs (job_number is unique per Organization, not globally)
CREATE UNIQUE INDEX jobs_org_job_number_key ON jobs(organization_id, job_number);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_contact_id ON jobs(contact_id);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_insurance_contact_id ON jobs(insurance_contact_id);
CREATE INDEX idx_jobs_organization_id ON jobs(organization_id);
CREATE INDEX idx_jobs_org_deleted_at ON jobs(organization_id, deleted_at);
CREATE INDEX idx_jobs_referral_partner_id_live ON jobs(referral_partner_id)
  WHERE deleted_at IS NULL;

-- job_activities
CREATE INDEX idx_job_activities_job_id ON job_activities(job_id);
CREATE INDEX idx_job_activities_organization_id ON job_activities(organization_id);

-- invoices (invoice_number is unique per Organization; sequence_number per job)
CREATE UNIQUE INDEX invoices_org_invoice_number_key ON invoices(organization_id, invoice_number);
CREATE UNIQUE INDEX invoices_job_seq_unique ON invoices(job_id, sequence_number);
CREATE INDEX idx_invoices_job_id ON invoices(job_id);
CREATE INDEX idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX idx_invoices_org_deleted_at ON invoices(organization_id, deleted_at);

-- invoice_line_items
CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items(invoice_id, sort_order);
CREATE INDEX idx_invoice_line_items_organization_id ON invoice_line_items(organization_id);
CREATE INDEX idx_invoice_line_items_section_id ON invoice_line_items(section_id);
CREATE INDEX idx_invoice_line_items_library_item_id ON invoice_line_items(library_item_id);

-- payments (one Stripe PaymentIntent maps to at most one payment per Org)
CREATE UNIQUE INDEX payments_org_stripe_payment_intent_key
  ON payments(organization_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX idx_payments_job_id ON payments(job_id);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_payments_organization_id ON payments(organization_id);
CREATE INDEX idx_payments_payment_request_id ON payments(payment_request_id);
CREATE INDEX idx_payments_stripe_charge_id ON payments(stripe_charge_id);
CREATE INDEX idx_payments_stripe_payment_intent_id ON payments(stripe_payment_intent_id);

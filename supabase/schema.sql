-- ============================================
-- AAA Disaster Recovery — Database Schema v1.0
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. CONTACTS
-- ============================================
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  email text,
  role text NOT NULL DEFAULT 'homeowner'
    CHECK (role IN ('homeowner', 'tenant', 'property_manager', 'adjuster', 'insurance')),
  company text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number text UNIQUE NOT NULL,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'pending_invoice', 'completed', 'cancelled')),
  urgency text NOT NULL DEFAULT 'scheduled'
    CHECK (urgency IN ('emergency', 'urgent', 'scheduled')),
  damage_type text NOT NULL
    CHECK (damage_type IN ('water', 'fire', 'mold', 'storm', 'biohazard', 'contents', 'rebuild', 'other')),
  damage_source text,
  property_address text NOT NULL,
  property_type text
    CHECK (property_type IN ('single_family', 'multi_family', 'commercial', 'condo')),
  property_sqft integer,
  property_stories integer,
  affected_areas text,
  insurance_company text,
  claim_number text,
  adjuster_contact_id uuid REFERENCES contacts(id),
  access_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
    CHECK (activity_type IN ('note', 'photo', 'milestone', 'insurance', 'equipment')),
  title text NOT NULL,
  description text,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 5. INVOICES
-- ============================================
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  invoice_number text UNIQUE NOT NULL,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partial', 'paid')),
  issued_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
-- 6. LINE ITEMS
-- ============================================
CREATE TABLE line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  xactimate_code text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 7. PAYMENTS
-- ============================================
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id),
  source text NOT NULL
    CHECK (source IN ('insurance', 'homeowner', 'other')),
  method text NOT NULL
    CHECK (method IN ('check', 'ach', 'venmo_zelle', 'cash', 'credit_card')),
  amount numeric(10,2) NOT NULL,
  reference_number text,
  payer_name text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'pending', 'due')),
  notes text,
  received_date date,
  created_at timestamptz NOT NULL DEFAULT now()
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

-- ============================================
-- ROW LEVEL SECURITY (open for now, lock down later)
-- ============================================
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (will restrict with auth later)
CREATE POLICY "Allow all on contacts" ON contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on jobs" ON jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on job_activities" ON job_activities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on invoices" ON invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on line_items" ON line_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on payments" ON payments FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- INDEXES for common queries
-- ============================================
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_contact_id ON jobs(contact_id);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_job_activities_job_id ON job_activities(job_id);
CREATE INDEX idx_invoices_job_id ON invoices(job_id);
CREATE INDEX idx_payments_job_id ON payments(job_id);
CREATE INDEX idx_line_items_invoice_id ON line_items(invoice_id);

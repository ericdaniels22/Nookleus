-- ============================================
-- AAA Disaster Recovery — Photo System Schema
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. PHOTOS
-- ============================================
CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  annotated_path text,
  caption text,
  taken_at timestamptz,
  taken_by text NOT NULL DEFAULT 'Eric',
  media_type text NOT NULL DEFAULT 'photo'
    CHECK (media_type IN ('photo', 'video')),
  file_size integer,
  width integer,
  height integer,
  before_after_pair_id uuid REFERENCES photos(id),
  before_after_role text
    CHECK (before_after_role IN ('before', 'after')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. PHOTO TAGS
-- ============================================
CREATE TABLE photo_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  color text NOT NULL DEFAULT '#2B5EA7',
  created_by text NOT NULL DEFAULT 'Eric',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default tags
INSERT INTO photo_tags (name, color) VALUES
  ('Initial Damage', '#C41E2A'),
  ('Moisture Reading', '#2B5EA7'),
  ('Equipment Setup', '#633806'),
  ('Drying Progress', '#0F6E56'),
  ('Final Dry', '#085041'),
  ('Mold Found', '#27500A'),
  ('Repairs', '#6C5CE7'),
  ('Customer Approval', '#7A5E00'),
  ('Before', '#791F1F'),
  ('After', '#0F6E56');

-- ============================================
-- 3. PHOTO TAG ASSIGNMENTS (many-to-many)
-- ============================================
CREATE TABLE photo_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES photo_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(photo_id, tag_id)
);

-- ============================================
-- 4. PHOTO ANNOTATIONS
-- ============================================
CREATE TABLE photo_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  annotation_data jsonb NOT NULL DEFAULT '{}',
  created_by text NOT NULL DEFAULT 'Eric',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 5. PHOTO REPORT TEMPLATES
-- ============================================
CREATE TABLE photo_report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  audience text NOT NULL DEFAULT 'general'
    CHECK (audience IN ('adjuster', 'customer', 'internal', 'general')),
  sections jsonb NOT NULL DEFAULT '[]',
  cover_page jsonb NOT NULL DEFAULT '{"show_logo": true, "show_company": true, "show_date": true, "show_photo_count": true}',
  photos_per_page integer NOT NULL DEFAULT 2,
  created_by text NOT NULL DEFAULT 'Eric',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 6. PHOTO REPORTS
-- ============================================
CREATE TABLE photo_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  template_id uuid REFERENCES photo_report_templates(id),
  title text NOT NULL,
  report_number integer,                       -- per-Job number ("Report #1, #2, ..."); assigned in #400
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  sections jsonb NOT NULL DEFAULT '[]',
  pdf_path text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generated')),
  created_by text NOT NULL DEFAULT 'Eric',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz                       -- soft-delete for the recoverable trash (#402); NULL = not deleted
);

-- ============================================
-- AUTO-UPDATE updated_at TIMESTAMPS
-- ============================================
CREATE TRIGGER trg_photo_annotations_updated_at
  BEFORE UPDATE ON photo_annotations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_photo_report_templates_updated_at
  BEFORE UPDATE ON photo_report_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_photo_reports_updated_at
  BEFORE UPDATE ON photo_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (open for now)
-- ============================================
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on photos" ON photos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_tags" ON photo_tags FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_tag_assignments" ON photo_tag_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_annotations" ON photo_annotations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_report_templates" ON photo_report_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_reports" ON photo_reports FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_photos_job_id ON photos(job_id);
CREATE INDEX idx_photos_taken_at ON photos(taken_at DESC);
CREATE INDEX idx_photo_tag_assignments_photo_id ON photo_tag_assignments(photo_id);
CREATE INDEX idx_photo_tag_assignments_tag_id ON photo_tag_assignments(tag_id);
CREATE INDEX idx_photo_annotations_photo_id ON photo_annotations(photo_id);
CREATE INDEX idx_photo_reports_job_id ON photo_reports(job_id);

-- ============================================
-- STORAGE BUCKET FOR REPORT PDFs
-- ============================================
-- Run this in the Supabase SQL Editor to create the reports bucket:
--   INSERT INTO storage.buckets (id, name, public) VALUES ('reports', 'reports', true);
--   CREATE POLICY "Allow all on reports bucket" ON storage.objects FOR ALL USING (bucket_id = 'reports') WITH CHECK (bucket_id = 'reports');

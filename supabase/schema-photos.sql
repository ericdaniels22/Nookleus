-- ============================================
-- AAA Disaster Recovery — Photo System Schema
-- Run this in the Supabase SQL Editor
-- ============================================
--
-- Multi-tenancy note: every table below carries `organization_id`
-- (uuid NOT NULL, FK -> organizations) and is guarded by a per-tenant
-- `tenant_isolation_*` RLS policy. Those objects assume the core multi-tenant
-- schema already exists — the `organizations` and `user_organizations` tables
-- and the `nookleus.active_organization_id()` helper — just as this file
-- already assumes `jobs` and `update_updated_at()`. Run the core schema first.

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
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  uploaded_from text NOT NULL DEFAULT 'web',   -- 'web' | 'mobile' (free text; no CHECK in prod)
  client_capture_id text                       -- mobile offline-capture idempotency key (#65c)
);

-- ============================================
-- 2. PHOTO TAGS
-- ============================================
CREATE TABLE photo_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2B5EA7',
  created_by text NOT NULL DEFAULT 'Eric',
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id)
);

-- Tag names are unique per Organization, not globally (see the
-- photo_tags_org_name_key unique index below). Default tags are now seeded
-- per-Organization by the app, so the original global seed INSERT no longer
-- applies under multi-tenancy and is kept here only as a reference list:
--   INSERT INTO photo_tags (name, color) VALUES
--     ('Initial Damage', '#C41E2A'),
--     ('Moisture Reading', '#2B5EA7'),
--     ('Equipment Setup', '#633806'),
--     ('Drying Progress', '#0F6E56'),
--     ('Final Dry', '#085041'),
--     ('Mold Found', '#27500A'),
--     ('Repairs', '#6C5CE7'),
--     ('Customer Approval', '#7A5E00'),
--     ('Before', '#791F1F'),
--     ('After', '#0F6E56');

-- ============================================
-- 3. PHOTO TAG ASSIGNMENTS (many-to-many)
-- ============================================
CREATE TABLE photo_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES photo_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id)
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id)
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
  deleted_at timestamptz,                      -- soft-delete for the recoverable trash (#402); NULL = not deleted
  organization_id uuid NOT NULL REFERENCES organizations(id)
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
-- ROW LEVEL SECURITY (multi-tenant isolation)
-- ============================================
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_reports ENABLE ROW LEVEL SECURITY;

-- Each photo-domain table is scoped to the caller's active Organization: the
-- row's organization_id must be non-null, equal to
-- nookleus.active_organization_id(), and the caller must belong to that
-- Organization (user_organizations). USING and WITH CHECK are identical so the
-- same predicate gates reads, writes, and inserts.
CREATE POLICY tenant_isolation_photos ON photos
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photos.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photos.organization_id
    )
  );

CREATE POLICY tenant_isolation_photo_tags ON photo_tags
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_tags.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_tags.organization_id
    )
  );

CREATE POLICY tenant_isolation_photo_tag_assignments ON photo_tag_assignments
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_tag_assignments.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_tag_assignments.organization_id
    )
  );

CREATE POLICY tenant_isolation_photo_annotations ON photo_annotations
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_annotations.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_annotations.organization_id
    )
  );

CREATE POLICY tenant_isolation_photo_report_templates ON photo_report_templates
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_report_templates.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_report_templates.organization_id
    )
  );

CREATE POLICY tenant_isolation_photo_reports ON photo_reports
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_reports.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.organization_id = photo_reports.organization_id
    )
  );

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_photos_job_id ON photos(job_id);
CREATE INDEX idx_photos_taken_at ON photos(taken_at DESC);
CREATE INDEX idx_photo_tag_assignments_photo_id ON photo_tag_assignments(photo_id);
CREATE INDEX idx_photo_tag_assignments_tag_id ON photo_tag_assignments(tag_id);
CREATE INDEX idx_photo_annotations_photo_id ON photo_annotations(photo_id);
CREATE INDEX idx_photo_reports_job_id ON photo_reports(job_id);

-- Per-tenant lookup indexes (one per photo-domain table)
CREATE INDEX idx_photos_organization_id ON photos(organization_id);
CREATE INDEX idx_photo_tags_organization_id ON photo_tags(organization_id);
CREATE INDEX idx_photo_tag_assignments_organization_id ON photo_tag_assignments(organization_id);
CREATE INDEX idx_photo_annotations_organization_id ON photo_annotations(organization_id);
CREATE INDEX idx_photo_report_templates_organization_id ON photo_report_templates(organization_id);
CREATE INDEX idx_photo_reports_organization_id ON photo_reports(organization_id);

-- Tag names unique per Organization (replaces the old global UNIQUE(name))
CREATE UNIQUE INDEX photo_tags_org_name_key ON photo_tags(organization_id, name);

-- Mobile offline-capture idempotency: one row per (organization_id, client_capture_id)
CREATE UNIQUE INDEX photos_org_client_capture_id_key
  ON photos(organization_id, client_capture_id)
  WHERE client_capture_id IS NOT NULL;

-- Per-Job report numbers are unique among active (not-trashed) reports, so two
-- concurrent "Create report" clicks can't both mint the same display number
-- (#447 #1). Trashed and legacy-null rows are excluded, matching the
-- max-over-all numbering that never reuses a number (#400).
CREATE UNIQUE INDEX photo_reports_job_report_number_key
  ON photo_reports(job_id, report_number)
  WHERE deleted_at IS NULL AND report_number IS NOT NULL;

-- ============================================
-- STORAGE BUCKET FOR REPORT PDFs
-- ============================================
-- Run this in the Supabase SQL Editor to create the reports bucket:
--   INSERT INTO storage.buckets (id, name, public) VALUES ('reports', 'reports', true);
--   CREATE POLICY "Allow all on reports bucket" ON storage.objects FOR ALL USING (bucket_id = 'reports') WITH CHECK (bucket_id = 'reports');

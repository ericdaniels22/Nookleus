-- supabase/migration-build67c1-pdf-presets-and-bucket.sql
-- Build 67c1 — PDF Presets table, pdfs Storage bucket, default-preset seeding.
-- Spec: docs/superpowers/specs/2026-05-04-build-67c1-design.md

-- ============================================================================
-- 0. Drop placeholder table from build 67a foundation migration.
-- The v1 ~28-column shape is superseded by the slim 8-toggle spec locked in
-- build 67c1 brainstorm decision #1. Verified safe: 0 rows, no app-code
-- consumers (only a stale PdfPreset interface in src/lib/types.ts that T2
-- replaces). CASCADE removes the v1 indexes, RLS policy, and trigger created
-- in migration-build67a-estimates-foundation.sql:184-227.
-- ============================================================================
DROP TABLE IF EXISTS pdf_presets CASCADE;

-- ============================================================================
-- 1. pdf_presets
-- ============================================================================
CREATE TABLE pdf_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('estimate','invoice')),
  document_title text NOT NULL,
  show_markup boolean NOT NULL DEFAULT true,
  show_discount boolean NOT NULL DEFAULT true,
  show_tax boolean NOT NULL DEFAULT true,
  show_opening_statement boolean NOT NULL DEFAULT true,
  show_closing_statement boolean NOT NULL DEFAULT true,
  show_category_subtotals boolean NOT NULL DEFAULT false,
  show_code_column boolean NOT NULL DEFAULT true,
  show_notes_column boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_presets_org_doctype ON pdf_presets(organization_id, document_type);
CREATE UNIQUE INDEX idx_pdf_presets_org_default
  ON pdf_presets(organization_id, document_type)
  WHERE is_default = true;

ALTER TABLE pdf_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pdf_presets
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_pdf_presets_updated_at
  BEFORE UPDATE ON pdf_presets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 2. pdfs Storage bucket (private; signed URLs only)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdfs', 'pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for the pdfs bucket: org members read objects under their org prefix.
-- Service role (used by API routes for upload + signed URL generation) bypasses RLS.
CREATE POLICY "pdfs_org_members_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'pdfs'
    AND (storage.foldername(name))[1] = nookleus.active_organization_id()::text
  );

-- ============================================================================
-- 3. Seed two default presets (Estimate + Invoice) per existing organization.
-- ============================================================================
INSERT INTO pdf_presets (
  organization_id, name, document_type, document_title, is_default
)
SELECT id, 'Estimate (default)', 'estimate', 'Estimate', true
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM pdf_presets p
  WHERE p.organization_id = organizations.id
    AND p.document_type = 'estimate'
    AND p.is_default = true
);

INSERT INTO pdf_presets (
  organization_id, name, document_type, document_title, is_default
)
SELECT id, 'Invoice (default)', 'invoice', 'Invoice', true
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM pdf_presets p
  WHERE p.organization_id = organizations.id
    AND p.document_type = 'invoice'
    AND p.is_default = true
);

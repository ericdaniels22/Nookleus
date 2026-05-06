-- Build 15d: Contract template PDF-overlay builder.
--
-- Replaces Tiptap-authored contract templates with PDF-upload + positioned
-- overlay fields. Drops legacy authoring columns; adds PDF storage path,
-- per-page dimensions, the overlay-fields JSONB array, and a signer_count
-- column that supersedes default_signer_count.
--
-- contracts gets two adds: customer_inputs JSONB (captured at sign-time)
-- and reuses the existing signed_pdf_path for the stamped final PDF.
-- filled_content_html is retained for legacy already-signed contracts.

BEGIN;

-- contract_templates: drop legacy authoring columns
ALTER TABLE contract_templates
  DROP COLUMN IF EXISTS content,
  DROP COLUMN IF EXISTS content_html,
  DROP COLUMN IF EXISTS default_signer_count;

-- contract_templates: add PDF-overlay columns
ALTER TABLE contract_templates
  ADD COLUMN pdf_storage_path TEXT NULL,
  ADD COLUMN pdf_page_count INT NULL,
  ADD COLUMN pdf_pages JSONB NULL,
  ADD COLUMN overlay_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN signer_count INT NOT NULL DEFAULT 1;

-- Constraint: signer_count must be 1 or 2.
ALTER TABLE contract_templates
  ADD CONSTRAINT contract_templates_signer_count_check
  CHECK (signer_count IN (1, 2));

-- contracts: add customer-inputs column. signed_pdf_path already exists
-- (used by legacy HTML→PDF render path); we reuse it for stamped PDFs.
ALTER TABLE contracts
  ADD COLUMN customer_inputs JSONB NULL;

-- Index for lookups by template (used in editor for preview + by signing
-- route for stamping).
CREATE INDEX IF NOT EXISTS contract_templates_pdf_storage_path_idx
  ON contract_templates (pdf_storage_path)
  WHERE pdf_storage_path IS NOT NULL;

COMMIT;

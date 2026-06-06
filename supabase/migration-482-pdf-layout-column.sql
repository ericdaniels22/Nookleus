-- Issue #482 — Per-document PDF layout snapshot column.
--
-- ADR 0012 (a document's PDF layout is a per-document snapshot, resolved by
-- precedence): each of `estimates` and `invoices` gains a nullable `pdf_layout`
-- JSONB column holding the document's own complete look — all nine show/hide
-- switches plus the editable document-title text.
--
--   NULL  = "this document has no layout of its own; render from the
--            Organization's default preset" (the precedence fallback in
--            src/lib/pdf-layout.ts → resolveEffectiveLayout).
--   {...} = a complete DocumentPdfLayout snapshot, seeded from the effective
--            look the first time a switch is flipped, and from then on the
--            document follows only itself (snapshot, not a preset_id reference).
--
-- Both changes are additive and safe: a new nullable column with no default, so
-- every existing document keeps NULL and renders byte-identically from the
-- default preset (parity preserved — no backfill, no data rewrite).

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS pdf_layout jsonb;
ALTER TABLE invoices  ADD COLUMN IF NOT EXISTS pdf_layout jsonb;

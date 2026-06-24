-- ============================================
-- Build 85 Migration: #682 — Equipment pricing (pieces × days) columns
--
-- Adds the raw inputs for the "pieces × days" billing mode to estimate line
-- items. Per the data-model decision in issues #679/#682 this mode is an input
-- affordance plus a derived note, NOT a second pricing formula: pieces × days
-- collapses into the existing `quantity` (`quantity = pieces × days`), so the
-- universal `total = quantity × unit_price` and every downstream consumer
-- (subtotals, PDF, the estimate→invoice recompute) stay equipment-ignorant.
--
-- Three new columns on estimate_line_items, all additive/safe:
--   1. pricing_mode — 'standard' (default) or 'pieces_days'. NOT NULL with a
--      constant default, so existing rows backfill atomically (Postgres 11+
--      treats a constant default as a metadata-only change — no table rewrite).
--   2. pieces — the piece count. NULL in standard mode.
--   3. days   — the number of days. NULL in standard mode.
--
-- A CHECK constraint pins pricing_mode to the two known values (matching the
-- enum-like CHECK pattern on estimates.status, build80). The derived note lives
-- in the existing `note` column (#382), so nothing here touches notes.
--
-- Scope: ESTIMATE line items only. Invoice persistence + estimate→invoice
-- conversion of the mode is a separate slice (#679 children). The derived note
-- already survives conversion via the `note` column, so an invoice keeps the
-- correct quantity/note/total even without these columns.
--
-- All statements are idempotent. Run in the Supabase SQL Editor.
-- ============================================

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'standard';
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS pieces numeric;
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS days numeric;

-- Pin pricing_mode to the known values.
ALTER TABLE estimate_line_items
  DROP CONSTRAINT IF EXISTS estimate_line_items_pricing_mode_check;
ALTER TABLE estimate_line_items
  ADD CONSTRAINT estimate_line_items_pricing_mode_check
  CHECK (pricing_mode IN ('standard', 'pieces_days'));

-- ============================================
-- End of build85 migration.
-- ============================================

-- Issue #382 — Line-item notes: schema foundation.
--
-- ORDERING IS LOAD-BEARING. This migration must run BEFORE
-- migration-382b-copy-line-item-note.sql. 382b's CREATE OR REPLACE bodies read
-- and write the `note` columns added here; if 382b's functions are ever called
-- before this migration runs, they raise `column "note" does not exist`.
--
-- Three changes, all additive/safe:
--   1. estimate_line_items.note  — the per-line-item note (nullable).
--   2. invoice_line_items.note   — same, so the note survives conversion.
--   3. Repurpose the dormant pdf_presets "notes" toggle:
--        * rename show_notes_column -> show_item_notes (it now gates an italic
--          sub-line under each item, never a separate column);
--        * flip its default to true ("show item notes" defaults to on, #382);
--        * backfill every existing preset to true. The old column was an unused
--          placeholder (always empty, default false), so flipping it on is the
--          "default on" intent and surfaces no notes that weren't there before.

ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE invoice_line_items  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE pdf_presets RENAME COLUMN show_notes_column TO show_item_notes;
ALTER TABLE pdf_presets ALTER COLUMN show_item_notes SET DEFAULT true;
UPDATE pdf_presets SET show_item_notes = true;

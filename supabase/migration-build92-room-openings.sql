-- Build 92 — Room openings: doors and windows on a Room's walls, and net wall
-- area deducts them — #866, ADR 0024.
--
-- S6 lets a Room carry openings — doors and windows placed on its walls. Each
-- opening is a {type, width, height, wall_index, offset} object: `type` is
-- "door" or "window", width/height are its size in feet, and wall_index/offset
-- place it along a wall (walls indexed by their start corner, #862). The app
-- deducts every opening's area from the Room's GROSS wall area to get NET wall
-- area — the default wall measurement (#866). Because the app is the single
-- writer of the six cached measurement columns (build88), storing the openings
-- alongside the recomputed net keeps the two from ever drifting.
--
-- This is additive. A Room with no openings has an empty list and net = gross,
-- which is exactly what every existing Room already stores — so no backfill is
-- needed. Org-scoping and RLS are unchanged (no new table; the column rides on
-- `rooms`).

-- 1. The openings column. jsonb (not jsonb[]) holds the ordered array of opening
--    objects, written by the app via measureFootprint's input. DEFAULT '[]'
--    keeps the NOT NULL constraint satisfiable for existing rows and for any row
--    inserted before the app starts sending openings.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS openings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================================
-- ROLLBACK ------------------------------------------------------------------
-- ALTER TABLE rooms DROP COLUMN IF EXISTS openings;
-- ============================================================================

-- Build 89 — Room footprint: a hand-drawn polygon, not just width × length — #879, ADR 0024.
--
-- S2 generalizes a Room's shape from a rectangle to an arbitrary polygon
-- footprint (L-rooms, bays). The footprint — an ordered list of {x, y} corner
-- points on the Sketch's grid (1 unit = 1 ft), the walls being the edges of a
-- closed loop — becomes the source of truth for the Room's shape; the existing
-- width/length columns are demoted to a cached bounding box (still written by the
-- app for legacy readers and Floor roll-ups). The six measurement columns are
-- unchanged: they generalize cleanly (shoelace area, perimeter as edge sum).
--
-- This is additive and backfilled: every existing rectangle Room gets the
-- equivalent 4-point footprint derived from its own width/length, so nothing is
-- lost and no Room is left with an empty shape. Org-scoping and RLS are unchanged
-- (no new table; the column rides on `rooms`).

-- 1. The footprint column. jsonb (not jsonb[]) holds the ordered point array; the
--    app writes it via measureFootprint's input. DEFAULT '[]' keeps the NOT NULL
--    constraint satisfiable for the backfill and for any row inserted before the
--    app starts sending footprints.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS footprint jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Backfill existing rectangle Rooms. The 4 corners are walked from the origin
--    in the same winding the app's rectangleFootprint() uses:
--    (0,0) → (w,0) → (w,l) → (0,l). Only rooms whose footprint is still the empty
--    default are touched, so re-running is a no-op.
UPDATE rooms
SET footprint = jsonb_build_array(
  jsonb_build_object('x', 0,     'y', 0),
  jsonb_build_object('x', width, 'y', 0),
  jsonb_build_object('x', width, 'y', length),
  jsonb_build_object('x', 0,     'y', length)
)
WHERE jsonb_array_length(footprint) = 0;

-- ============================================================================
-- ROLLBACK ------------------------------------------------------------------
-- ALTER TABLE rooms DROP COLUMN IF EXISTS footprint;
-- ============================================================================

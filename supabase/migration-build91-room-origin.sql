-- Build 91 — Room origin: a Room's footprint is stored normalized, its position
-- kept separately — #890, ADR 0026.
--
-- The full-screen plan editor places many Rooms on one Floor and lets each be
-- dragged around freely. ADR 0026 splits a Room's shape from its position: the
-- footprint is stored NORMALIZED (its min corner at (0,0)), and a new `origin`
-- {x, y} records where that corner sits on the Floor. Moving a Room updates only
-- `origin`; the footprint — and therefore every cached measurement derived from
-- it — is position-invariant.
--
-- This is additive and backfilled. Existing (#879) Rooms stored their footprint
-- wherever it was drawn; the backfill normalizes each such footprint and lifts
-- the old min corner into `origin`, so the drawn placement is preserved exactly
-- (origin + normalized footprint reconstruct it). Org-scoping and RLS are
-- unchanged (no new table; the column rides on `rooms`).

-- 1. The origin column. jsonb holds the {x, y} position; DEFAULT (0,0) keeps the
--    NOT NULL constraint satisfiable for the backfill and for any row inserted
--    before the app starts sending an origin (it then means "at the Floor's own
--    origin", the pre-#890 behaviour).
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS origin jsonb NOT NULL DEFAULT '{"x": 0, "y": 0}'::jsonb;

-- 2. Backfill: normalize each Room's footprint and lift its old min corner into
--    `origin`. For a footprint drawn at min corner (mx, my): the shape shifts by
--    (-mx, -my) so its min corner lands at (0,0), and `origin` GAINS (mx, my).
--    Adding to the existing origin (rather than replacing it) makes this a fixed
--    point — once normalized the min corner is (0,0), so a re-run adds nothing.
--    Only Rooms whose min corner isn't already the origin are touched, so the
--    UPDATE is a true no-op on every run after the first (and skips the empty
--    default footprint, which has no corners to measure).
UPDATE rooms r
SET
  origin = jsonb_build_object(
    'x', (r.origin ->> 'x')::numeric + mins.min_x,
    'y', (r.origin ->> 'y')::numeric + mins.min_y
  ),
  footprint = (
    SELECT jsonb_agg(
      jsonb_build_object(
        'x', (pt.elem ->> 'x')::numeric - mins.min_x,
        'y', (pt.elem ->> 'y')::numeric - mins.min_y
      )
      ORDER BY pt.idx
    )
    FROM jsonb_array_elements(r.footprint) WITH ORDINALITY AS pt(elem, idx)
  )
FROM (
  SELECT rr.id,
         MIN((e ->> 'x')::numeric) AS min_x,
         MIN((e ->> 'y')::numeric) AS min_y
  FROM rooms rr, jsonb_array_elements(rr.footprint) AS e
  GROUP BY rr.id
) AS mins
WHERE r.id = mins.id
  AND (mins.min_x <> 0 OR mins.min_y <> 0);

-- ============================================================================
-- ROLLBACK ------------------------------------------------------------------
-- ALTER TABLE rooms DROP COLUMN IF EXISTS origin;
-- ============================================================================

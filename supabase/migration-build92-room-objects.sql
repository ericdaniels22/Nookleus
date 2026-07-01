-- Build 92 — Room objects: a Room's placed known objects (count-only) — #867, S7.
--
-- A Room carries an inventory of KNOWN objects — cabinets, appliances, fixtures
-- (CONTEXT.md "Room": a Room carries its detected objects). Each object is placed
-- on the plan and belongs to one known category. Objects are a COUNT source only:
-- an Estimate line item can pull an `object_count` for a category (M3), but an
-- object is NEVER billed for linear footage or area — so this table stores WHICH
-- category and WHERE it sits, and deliberately carries no area/length columns.
--
-- The pure inventory engine (M1) lives in src/lib/sketch/object-inventory.ts; this
-- is its M5 persistence. The later LiDAR mapper (Apple RoomPlan) will write its
-- detected objects into these same category rows, so `category` is the shared
-- vocabulary that capture path maps onto (kept in lockstep with OBJECT_CATEGORIES).
--
-- Follows the build88 convention: gen_random_uuid() PK · organization_id FK ON
-- DELETE CASCADE · idx on org · tenant_isolation RLS (organization_id =
-- nookleus.active_organization_id()) · updated_at trigger · timestamptz stamps.
-- Deleting a Room cascades its objects away (room_id FK ON DELETE CASCADE).

CREATE TABLE room_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- One of the known object categories. A CHECK pins the vocabulary at the DB so
  -- an unknown category can't be planted even by an RLS-bypassing path — the same
  -- list as OBJECT_CATEGORIES in object-inventory.ts (extend both together).
  category text NOT NULL,
  CONSTRAINT room_objects_category_known CHECK (category IN (
    'cabinets', 'refrigerator', 'stove', 'oven', 'dishwasher',
    'washer_dryer', 'sink', 'toilet', 'bathtub', 'furniture'
  )),
  -- Where the object sits within the Room's own (normalized) coordinate space —
  -- {x, y} in feet, mirroring rooms.origin. Placement only: it never enters a
  -- measurement or a bill. DEFAULT (0,0) keeps NOT NULL satisfiable for a Room
  -- object created before the app sends a position.
  position jsonb NOT NULL DEFAULT '{"x": 0, "y": 0}'::jsonb,
  -- Orientation of the placed glyph, in degrees. Placement fidelity for the plan
  -- editor (an appliance dragged in at an angle); never billed.
  rotation numeric(10,3) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_room_objects_org ON room_objects(organization_id);
CREATE INDEX idx_room_objects_room_id ON room_objects(room_id);

ALTER TABLE room_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON room_objects
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_room_objects_updated_at
  BEFORE UPDATE ON room_objects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- ROLLBACK ------------------------------------------------------------------
-- DROP TABLE IF EXISTS room_objects CASCADE;
-- ============================================================================

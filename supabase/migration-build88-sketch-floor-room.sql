-- Build 88 — Sketch surface + first rectangular Room (tracer bullet) — #860, ADR 0024.
--
-- The parametric measurement spine: a Sketch belongs 1:1 to a Job and organizes
-- one or more Floors, each holding measured Rooms. This is M5 (persistence) for
-- the engine whose pure geometry lives in src/lib/sketch/measure-room.ts (M1).
--
-- Three org-scoped tables, each following the build67a convention:
--   gen_random_uuid() PK · organization_id FK ON DELETE CASCADE · idx on org ·
--   tenant_isolation RLS (organization_id = nookleus.active_organization_id()) ·
--   updated_at trigger · timestamptz created_at/updated_at.
--
-- Units. The Sketch's linear unit is feet (see measure-room.ts). Every length,
-- height, thickness, area, and volume column below is in that unit (feet, sq ft,
-- cu ft). The Room's six measurement columns are a CACHED SNAPSHOT of M1's output
-- — the app is the single writer and recomputes them via measureRoom() on every
-- edit, so they never drift from width/length/effective-ceiling-height. They are
-- denormalized so an Estimate line item can pull a quantity without re-running the
-- engine (CONTEXT.md "Room": a re-pullable snapshot).

-- ============================================================================
-- 1. sketches — one per Job (1:1 via UNIQUE(job_id))
-- ============================================================================
CREATE TABLE sketches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- Forward placeholder for the LiDAR/Matterport capture path (ADR 0024's staged
  -- build): a hand-drawn Sketch leaves this NULL; a scanned one will point at the
  -- stored mesh. No behavior consumes it yet (#860 is the hand-drawn tracer).
  mesh_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A Job has at most one Sketch — its single measurement surface (CONTEXT.md
  -- "Sketch": belongs to exactly one Job).
  UNIQUE(job_id)
);
CREATE INDEX idx_sketches_org ON sketches(organization_id);

ALTER TABLE sketches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sketches
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_sketches_updated_at
  BEFORE UPDATE ON sketches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 2. floors — one level of a Sketch, carrying the defaults its Rooms inherit
-- ============================================================================
CREATE TABLE floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sketch_id uuid NOT NULL REFERENCES sketches(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Ground Floor',
  -- Level-wide defaults a Room inherits (CONTEXT.md "Floor"). default_ceiling_height
  -- is the Room's ceiling height unless the Room overrides it. The two wall
  -- thicknesses are stored for the snap/adjacency model (M-later) and are NOT
  -- consumed by M1's perimeter × height wall-area formula.
  default_ceiling_height numeric(10,3) NOT NULL DEFAULT 8,
  interior_wall_thickness numeric(10,3) NOT NULL DEFAULT 0.33,
  exterior_wall_thickness numeric(10,3) NOT NULL DEFAULT 0.5,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_floors_org ON floors(organization_id);
CREATE INDEX idx_floors_sketch_id ON floors(sketch_id);

ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON floors
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_floors_updated_at
  BEFORE UPDATE ON floors FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 3. rooms — a rectangular footprint + ceiling height, with cached measurements
-- ============================================================================
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  floor_id uuid NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Room',
  -- The footprint (this first Room is a rectangle: width × length).
  width numeric(10,3) NOT NULL DEFAULT 0,
  length numeric(10,3) NOT NULL DEFAULT 0,
  -- NULL → inherit the Floor's default_ceiling_height; a value overrides it.
  ceiling_height_override numeric(10,3),
  -- Cached M1 output (measureRoom). Recomputed by the app on every edit; never
  -- the source of truth, always derivable from the dimensions above + the
  -- effective ceiling height. numeric(14,3) holds large spaces without overflow.
  floor_area numeric(14,3) NOT NULL DEFAULT 0,
  ceiling_area numeric(14,3) NOT NULL DEFAULT 0,
  perimeter numeric(14,3) NOT NULL DEFAULT 0,
  gross_wall_area numeric(14,3) NOT NULL DEFAULT 0,
  net_wall_area numeric(14,3) NOT NULL DEFAULT 0,
  volume numeric(14,3) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rooms_org ON rooms(organization_id);
CREATE INDEX idx_rooms_floor_id ON rooms(floor_id);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rooms
  USING (organization_id = nookleus.active_organization_id())
  WITH CHECK (organization_id = nookleus.active_organization_id());

CREATE TRIGGER trg_rooms_updated_at
  BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- ROLLBACK ------------------------------------------------------------------
-- DROP TABLE IF EXISTS rooms CASCADE;
-- DROP TABLE IF EXISTS floors CASCADE;
-- DROP TABLE IF EXISTS sketches CASCADE;
-- ============================================================================

-- Self-contained schema for the embedded-postgres line-item Sketch-source
-- harness (#861, S2 "money slice"). Loaded by line-item-sketch-source.pg.test.ts
-- into a throwaway cluster; the LIVE migration-build90 is then applied on top to
-- add the `sketch_source` column.
--
-- NOT the Supabase stack: no PostgREST, no RLS, no role grants — the smallest
-- schema that lets a pull's freeze be exercised end to end. Column types match
-- prod (migration-build67a: numeric(10,2) money columns). The `sketch_source`
-- column is deliberately ABSENT here so the LIVE build90 migration is what adds
-- it (no copy-paste drift): the test proves the migration's column persists jsonb
-- and that the snapshot is frozen — decoupled from the source Room by design,
-- since there is no FK from sketch_source back to rooms (ADR 0004).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  job_id uuid,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE estimate_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Section',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES estimate_sections(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A minimal stand-in for the Sketch source Room (the real table is build88's,
-- carrying RLS and the full Floor → Sketch chain). Only the one cached
-- measurement the freeze reads is needed to prove the snapshot decouples from
-- it: after a pull copies net_wall_area into the line item, mutating this row
-- must not move the frozen quantity — there is deliberately no FK from
-- sketch_source to rooms.
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  net_wall_area numeric(14,3) NOT NULL DEFAULT 0
);

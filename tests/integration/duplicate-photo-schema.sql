-- Self-contained schema for the embedded-postgres duplicate_photo harness
-- (#519). Loaded by duplicate-photo.pg.test.ts into a throwaway cluster.
--
-- This is NOT the Supabase stack: there is no PostgREST, no RLS, and none of
-- the anon/authenticated/service_role grants the shared schema-photos.sql
-- carries. It is the smallest schema that lets the LIVE migration-519 function
-- run: the three photo tables it reads/writes, with the columns it touches,
-- typed to match the prod shape (supabase/schema-photos.sql).
--
-- Deliberate divergences from prod, all safe because the RPC never depends on
-- them:
--   * photos drops the NOT NULL job_id FK and the organization_id FK — a
--     fixture is just a bare photo row, no org/job chain to seed.
--   * before_after_pair_id is FK-LESS — duplicating an "after" copies its pair
--     link verbatim; a self-referential FK would force every fixture to also
--     seed the partner row just to exercise the copy.

-- gen_random_uuid() is core since PG 13; keep pgcrypto too for older binaries.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Photos: the function reads the source row and writes the duplicate. Columns
-- and CHECKs mirror prod (schema-photos.sql §1) minus the org/job/pair FKs.
CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  storage_path text NOT NULL,
  annotated_path text,
  caption text,
  taken_at timestamptz,
  taken_by text NOT NULL DEFAULT 'Eric',
  media_type text NOT NULL DEFAULT 'photo'
    CHECK (media_type IN ('photo', 'video')),
  file_size integer,
  width integer,
  height integer,
  before_after_pair_id uuid,
  before_after_role text
    CHECK (before_after_role IN ('before', 'after')),
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL,
  uploaded_from text NOT NULL DEFAULT 'web',
  client_capture_id text
);

-- Tags: read only to satisfy the assignment FK when a fixture seeds tags.
CREATE TABLE photo_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2B5EA7',
  created_by text NOT NULL DEFAULT 'Eric',
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL
);

-- Tag assignments: the join the function re-inserts for the duplicate. The
-- UNIQUE(photo_id, tag_id) mirrors prod so a double-link would be rejected.
CREATE TABLE photo_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES photo_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL,
  UNIQUE(photo_id, tag_id)
);

-- Minimal schema for the jobs→contacts embed integration tests (#283).
--
-- This is NOT a clone of production. It is the smallest schema that
-- reproduces the PostgREST `PGRST201` ambiguity that #282 fixed: two
-- foreign keys from `jobs` to `contacts` (`contact_id`, `insurance_contact_id`).
-- The six surface queries from #282 read against this skeleton.
--
-- Why not the prod schema dump? `supabase/schema.sql` is historical and
-- pre-dates most of the columns/RLS the prod stack carries, and the flat
-- `supabase/migration-*.sql` files don't sort into a clean replay order.
-- Reproducing prod faithfully would mean rebuilding the migration history
-- — a project larger than this slice. The ambiguity itself doesn't depend
-- on any of that; it depends only on the FK shape, which is what we set up
-- here.
--
-- RLS is intentionally NOT enabled: PostgREST embed disambiguation runs
-- before policy evaluation, so RLS-off makes the test surface smaller
-- without changing what's under test. Fixture inserts use the service-role
-- key per the issue.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Wipe-and-recreate so re-runs against the same stack are idempotent.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- Contacts: homeowner + insurance + adjuster rows live here.
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'homeowner'
    CHECK (role IN ('homeowner', 'tenant', 'property_manager', 'adjuster', 'insurance')),
  email text,
  phone text,
  company text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Jobs: TWO FKs to contacts is the whole point of the harness.
--   contact_id           — homeowner link (the one #282 pinned in every embed)
--   insurance_contact_id — added by migration 193; created the ambiguity
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number text NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  insurance_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Estimates: needs job_id + deleted_at to satisfy the trash listing query.
CREATE TABLE public.estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  estimate_number text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Invoices: same shape requirement as estimates.
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  invoice_number text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Job adjusters: needed by the Jarvis `get_job_context` embed, which pulls
-- `job_adjusters(*, adjuster:contacts!contact_id(*))`.
CREATE TABLE public.job_adjusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- PostgREST listens to NOTIFY pgrst on a schema-cache reload. Force one
-- here so the just-created tables and FKs are visible to embed parsing
-- on the very first request from the test process.
NOTIFY pgrst, 'reload schema';

-- issue #193 (PRD #47, slice 1) — link a job to its insurance company.
--
-- Insurance companies are contacts with role = 'insurance', a role the
-- schema already supports and that the Contacts page already creates.
-- This migration adds the job -> insurance contact link as a nullable
-- foreign key, mirroring the homeowner link (jobs.contact_id) rather
-- than a junction table: one insurer per job.
--
-- insurance_contact_id is nullable and references contacts(id)
-- ON DELETE SET NULL: deleting the linked contact reverts the job to
-- having no linked insurer rather than blocking the contact delete.
-- The job keeps its free-text insurance_company name snapshot
-- regardless, so the link can always be re-established.
--
-- No backfill: insurance_contact_id starts NULL for every existing job.
-- The existing free-text jobs.insurance_company column is untouched and
-- continues to serve every current reader (Jarvis context, CSV export,
-- report builder, report PDF, job card). Once a company is picked, that
-- column is written as a denormalized name snapshot of the contact.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS insurance_contact_id uuid
    REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_insurance_contact_id
  ON public.jobs (insurance_contact_id);

-- ROLLBACK ---
-- DROP INDEX IF EXISTS public.idx_jobs_insurance_contact_id;
-- ALTER TABLE public.jobs DROP COLUMN IF EXISTS insurance_contact_id;

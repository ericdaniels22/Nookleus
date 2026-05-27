-- issue #298 (PRD #297, slice B) — Job ↔ Referral Partner attribution.
--
-- A new nullable foreign key on `jobs` records the Referral Partner that
-- sent us each Job. Zero-or-one referrer per Job (Model A from PRD #297):
-- the simple shape is also the safe shape, because a single ADD-column is
-- the cheapest migration path out of, into a join table later if the
-- product ever needs multi-referrer attribution.
--
-- ON DELETE SET NULL means trashing a Partner does NOT touch the Job's FK
-- (trash is a soft-delete: `deleted_at IS NOT NULL`); only a hard delete
-- of the partner row nulls the column. This matches PRD #297 user stories
-- #13 (trashed partner: link still resolves during the grace period) and
-- #15 (hard-deleted partner: Job's referrer slot cleared, not blocked).
--
-- The partial index serves the lifetime-count query landing in slice C1
-- ("how many Jobs has this Partner sent us?"), which filters trashed Jobs
-- out: `count(*) ... where referral_partner_id = $1 AND deleted_at IS NULL`.
-- Partial-on-`deleted_at` keeps the index small (a healthy table is mostly
-- non-trashed rows, but the predicate matches Postgres' query plan exactly).
--
-- No backfill: every existing Job starts with `referral_partner_id = NULL`.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS referral_partner_id uuid
    REFERENCES public.referral_partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_referral_partner_id_live
  ON public.jobs (referral_partner_id)
  WHERE deleted_at IS NULL;

-- ROLLBACK ---
-- DROP INDEX IF EXISTS public.idx_jobs_referral_partner_id_live;
-- ALTER TABLE public.jobs DROP COLUMN IF EXISTS referral_partner_id;

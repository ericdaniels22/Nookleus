-- build77 (issue #160): add a user-chosen cover photo to jobs.
--
-- The cover photo is an existing photo, already attached to the job, that
-- the user promotes to represent the job visually. It is set from the
-- job's Photos tab and surfaced in the Jobs tab's Comfortable view
-- (parent feature #152). The app never auto-selects a cover — a job has
-- no cover until a user picks one.
--
-- cover_photo_id is nullable and references photos(id) ON DELETE SET NULL:
-- deleting the referenced photo silently reverts the job to having no
-- cover, rather than blocking the photo delete or leaving a dangling id.

ALTER TABLE public.jobs
  ADD COLUMN cover_photo_id uuid
    REFERENCES public.photos(id) ON DELETE SET NULL;

-- ROLLBACK ---
-- ALTER TABLE public.jobs DROP COLUMN cover_photo_id;

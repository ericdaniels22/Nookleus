-- issue #848 (PRD #804) — enforce one markup row per Photo.
--
-- Problem:   `photo_annotations` carried only a NON-unique index on photo_id
--            (idx_photo_annotations_photo_id). The markup save did a
--            find-then-insert with an unordered .limit(1); the load read the
--            newest row (order created_at desc). If two rows ever shared a
--            photo_id — two concurrent first-time saves both missing the
--            existing-row check, or a write-succeeded-but-response-dropped
--            retry — save and load could resolve DIFFERENT rows, and edits
--            written to the row the loader never returns silently "don't stick"
--            across reloads.
--
-- Fix:       De-dup any existing duplicates (keep the newest per photo_id),
--            then add a UNIQUE index on photo_annotations(photo_id). The app's
--            persist (persistPhotoMarkup) is switched in the same change to an
--            update-by-photo_id / upsert(..., { onConflict: 'photo_id' }) so
--            concurrent first-time saves converge onto the one canonical row
--            instead of inserting a second one.
--
-- Replaces:  the non-unique idx_photo_annotations_photo_id — the UNIQUE index
--            also backs the photo_id lookup, so the old one is dropped.
--
-- Idempotent: de-dup is a no-op once unique; CREATE UNIQUE INDEX IF NOT EXISTS
--            and DROP INDEX IF EXISTS are safe to re-run.
--
-- Note on CONCURRENTLY: not used. photo_annotations is small and the
--            ACCESS EXCLUSIVE lock is held for milliseconds; CONCURRENTLY can't
--            run inside the apply transaction anyway. Mirrors build46.
--
-- Prod-migration flow: run section 1 (read-only) FIRST and record its output on
--            the PR, then run section 2 (the gated apply) as one transaction.

-- ===========================================================================
-- 1. READ-ONLY PRE-CHECKS — SELECT-only, touches no rows. Paste output on the PR.
-- ===========================================================================

-- 1a. How many photos hold duplicate annotation rows, and how many rows the
--     de-dup in section 2 would delete (total_rows - distinct_photos).
select
  count(*)                                  as total_rows,
  count(distinct photo_id)                  as distinct_photos,
  count(*) - count(distinct photo_id)       as rows_to_delete
from public.photo_annotations;

-- 1b. The specific photo_ids that currently have more than one row, and how
--     many — these are the rows that diverged. Empty result = nothing to de-dup.
select photo_id, count(*) as row_count
from public.photo_annotations
group by photo_id
having count(*) > 1
order by row_count desc, photo_id;

-- ===========================================================================
-- 2. GATED APPLY — run as one transaction once section 1 looks right.
-- ===========================================================================
begin;

-- 2a. De-dup: keep the NEWEST row per photo_id, delete the rest. Newest =
--     greatest (created_at, id); the id tiebreak makes the survivor
--     deterministic even when two duplicates share a created_at timestamp.
delete from public.photo_annotations a
using public.photo_annotations b
where a.photo_id = b.photo_id
  and (
    b.created_at > a.created_at
    or (b.created_at = a.created_at and b.id > a.id)
  );

-- 2b. Gate: abort loudly if any photo still has >1 row, so the index build
--     below can't fail on a cryptic duplicate-key error (and the whole
--     transaction rolls back rather than half-applying).
do $$
declare
  remaining bigint;
begin
  select count(*) into remaining
  from (
    select photo_id from public.photo_annotations
    group by photo_id having count(*) > 1
  ) dupes;
  if remaining > 0 then
    raise exception 'photo_annotations still has % photo_id(s) with duplicate rows after de-dup', remaining;
  end if;
end $$;

-- 2c. Enforce one row per Photo. This UNIQUE index also serves the photo_id
--     lookup, so the old non-unique index is now redundant.
create unique index if not exists photo_annotations_photo_id_key
  on public.photo_annotations(photo_id);
drop index if exists public.idx_photo_annotations_photo_id;

commit;

-- ROLLBACK ---
-- Restore the non-unique index and drop the UNIQUE one. The de-dup is NOT
-- reversible — deleted duplicate rows were stale divergent copies and are not
-- restored (back them up before applying if that matters).
-- begin;
--   create index if not exists idx_photo_annotations_photo_id
--     on public.photo_annotations(photo_id);
--   drop index if exists public.photo_annotations_photo_id_key;
-- commit;

-- issue #857 (PRD #804) — one label per (organization_id, label).
--
-- Problem:   quick_pick_labels has no unique key (migration-819 says so in its
--            seed comment). The seed is guarded with a `where not exists`, but
--            that is racy: two concurrent seed runs can both pass the guard and
--            insert the same NULL-org defaults, and PostgREST inserts (the POST
--            route) can mint duplicate org-owned labels. Nothing at the data
--            layer stops a duplicate.
--
-- Fix:       De-dup any existing duplicates (keep the NEWEST row per
--            organization_id + label), then add a UNIQUE index on
--            (organization_id, label). The index is NULLS NOT DISTINCT so the
--            shared NULL-org defaults are de-duplicated too — under the default
--            NULLS DISTINCT, two (NULL, 'Source of loss') rows would NOT
--            conflict, which is exactly the duplicate-defaults case we need to
--            prevent. (Postgres 15 — see supabase/config.toml major_version.)
--
-- Safe to delete duplicates: a Quick-pick label is applied to an Annotation as
--            text (the phrase), never by id — no table carries a FK to
--            quick_pick_labels.id, so removing a duplicate row orphans nothing.
--
-- Idempotent: de-dup is a no-op once unique; CREATE UNIQUE INDEX IF NOT EXISTS
--            is safe to re-run.
--
-- Prod-migration flow: run section 1 (read-only) FIRST and record its output on
--            the PR, then run section 2 (the gated apply) as one transaction.
--            Mirrors migration-848.

-- ===========================================================================
-- 1. READ-ONLY PRE-CHECKS — SELECT-only, touches no rows. Paste output on the PR.
-- ===========================================================================

-- 1a. How many rows exist, how many distinct (organization_id, label) groups,
--     and how many rows the de-dup in section 2 would delete (total - distinct).
--     GROUP BY folds the NULL-org defaults into one group per label, matching
--     the NULLS NOT DISTINCT index built below.
select
  (select count(*) from public.quick_pick_labels) as total_rows,
  (select count(*) from (
     select organization_id, label
     from public.quick_pick_labels
     group by organization_id, label
   ) g) as distinct_groups,
  (select count(*) from public.quick_pick_labels)
    - (select count(*) from (
        select organization_id, label
        from public.quick_pick_labels
        group by organization_id, label
      ) g) as rows_to_delete;

-- 1b. The specific (organization_id, label) pairs that currently have more than
--     one row, and how many. Empty result = nothing to de-dup.
select organization_id, label, count(*) as row_count
from public.quick_pick_labels
group by organization_id, label
having count(*) > 1
order by row_count desc, label;

-- ===========================================================================
-- 2. GATED APPLY — run as one transaction once section 1 looks right.
-- ===========================================================================
begin;

-- 2a. De-dup: keep the NEWEST row per (organization_id, label), delete the rest.
--     `is not distinct from` makes NULL = NULL true, so two NULL-org defaults
--     with the same label collapse to one — matching NULLS NOT DISTINCT below.
--     Newest = greatest (created_at, id); the id tiebreak makes the survivor
--     deterministic even when two duplicates share a created_at timestamp.
delete from public.quick_pick_labels a
using public.quick_pick_labels b
where a.label = b.label
  and a.organization_id is not distinct from b.organization_id
  and (
    b.created_at > a.created_at
    or (b.created_at = a.created_at and b.id > a.id)
  );

-- 2b. Gate: abort loudly if any (organization_id, label) still has >1 row, so
--     the index build below can't fail on a cryptic duplicate-key error (and the
--     whole transaction rolls back rather than half-applying).
do $$
declare
  remaining bigint;
begin
  select count(*) into remaining
  from (
    select organization_id, label
    from public.quick_pick_labels
    group by organization_id, label
    having count(*) > 1
  ) dupes;
  if remaining > 0 then
    raise exception 'quick_pick_labels still has % (organization_id, label) group(s) with duplicate rows after de-dup', remaining;
  end if;
end $$;

-- 2c. Enforce one label per org (and one per shared default). NULLS NOT DISTINCT
--     so duplicate NULL-org defaults conflict too.
create unique index if not exists quick_pick_labels_org_label_key
  on public.quick_pick_labels (organization_id, label)
  nulls not distinct;

commit;

-- ROLLBACK ---
-- Drop the UNIQUE index. The de-dup is NOT reversible — deleted duplicate rows
-- were redundant copies and are not restored (back them up before applying if
-- that matters).
-- begin;
--   drop index if exists public.quick_pick_labels_org_label_key;
-- commit;

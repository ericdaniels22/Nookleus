-- issue #115 (PRD #109), full_name slice 6 — cleanup: drop the legacy columns.
--
-- Purpose:   The `contacts` table has finished moving from split first_name /
--            last_name columns to a single `full_name`. Every reader and
--            writer now uses `full_name`, so this migration removes the
--            transitional machinery installed by migration-110:
--              - the `contacts_sync_name` coexistence trigger + function;
--              - the legacy `first_name` / `last_name` columns;
--            and finalizes `full_name` as `NOT NULL`.
--
-- Depends on: migration-110 (added full_name + the coexistence trigger),
--            migration-111/112/114 (repointed readers/writers at full_name).
--            This is the last slice of PRD #109 — nothing else may read the
--            legacy columns after it runs.
--
-- Revert:    see -- ROLLBACK --- block at the bottom. The rollback restores
--            the columns and re-derives them from full_name, but the trigger
--            from migration-110 is NOT re-installed — re-run migration-110 if
--            full coexistence is needed again.

-- ---------------------------------------------------------------------------
-- 1. Drop the coexistence trigger + function. After this point no DB object
--    keeps full_name and the legacy columns in sync — safe only because every
--    writer now authors full_name directly.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS contacts_sync_name_trg ON public.contacts;
DROP FUNCTION IF EXISTS public.contacts_sync_name();

-- ---------------------------------------------------------------------------
-- 2. Assert every row has a non-empty full_name, then make it NOT NULL. The
--    coexistence trigger kept it populated; this is a belt-and-braces check
--    before the legacy columns (the only fallback) are dropped.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.contacts
     where full_name is null or btrim(full_name) = ''
  ) then
    raise exception 'migration-115: contacts has rows with a null/blank full_name — cannot drop legacy columns';
  end if;
end $$;

ALTER TABLE public.contacts ALTER COLUMN full_name SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Drop the legacy columns. full_name is now the sole customer-name column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts DROP COLUMN IF EXISTS first_name;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS last_name;

-- ROLLBACK ---
-- alter table public.contacts add column if exists first_name text;
-- alter table public.contacts add column if exists last_name  text;
-- update public.contacts
--    set first_name = coalesce(substring(btrim(regexp_replace(full_name, '\s+', ' ', 'g')) from '^(.+) [^ ]+$'),
--                              btrim(regexp_replace(full_name, '\s+', ' ', 'g'))),
--        last_name  = coalesce(substring(btrim(regexp_replace(full_name, '\s+', ' ', 'g')) from ' ([^ ]+)$'), '');
-- alter table public.contacts alter column first_name set not null;
-- alter table public.contacts alter column last_name  set not null;
-- alter table public.contacts alter column full_name drop not null;
-- -- re-run migration-110 to restore the coexistence trigger if needed.

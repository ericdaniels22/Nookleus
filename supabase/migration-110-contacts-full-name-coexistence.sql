-- issue #110 (PRD #109), full_name slice 1 — schema, backfill & coexistence.
--
-- Purpose:   The `contacts` table is moving from separate first_name/last_name
--            columns to a single `full_name`. This migration adds `full_name`,
--            backfills it, and installs a trigger that keeps `full_name` and
--            the legacy first_name/last_name columns mutually consistent — so
--            later slices can migrate readers/writers in any order without
--            breaking each other.
--
-- Bounded:   `full_name` is left NULLable here and the legacy columns remain.
--            The cleanup slice (issue #115) drops first_name/last_name, drops
--            the sync trigger, and makes `full_name` NOT NULL.
--
-- Mirrors:   The trigger's split/join logic mirrors splitName()/joinName() in
--            src/lib/contact-name.ts — keep the two in lockstep.
--
-- Depends on: nothing (first slice of the PRD).
-- Revert:    see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. Add the column (NULLable during coexistence).
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS full_name text;

-- ---------------------------------------------------------------------------
-- 2. Backfill from the legacy parts (joinName equivalent), then assert that
--    every row is populated. Runs before the trigger exists, so it is a plain
--    column write with no sync side effects.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.contacts
     set full_name = btrim(
       concat_ws(' ',
         nullif(btrim(coalesce(first_name, '')), ''),
         nullif(btrim(coalesce(last_name,  '')), '')
       )
     )
   where full_name is null;

  if exists (select 1 from public.contacts where full_name is null) then
    raise exception 'full_name backfill: contacts has rows with a null full_name';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Coexistence trigger function. On every insert/update it keeps full_name
--    and first_name/last_name consistent:
--      - if full_name is the value authored by this write → derive the legacy
--        parts from it (last-space split, splitName equivalent);
--      - otherwise the legacy parts are authoritative → derive full_name from
--        them (trimmed single-spaced join, joinName equivalent).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_sync_name()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_full          text;
  v_given         text;
  v_family        text;
  v_full_authored boolean;
BEGIN
  -- Did this write author full_name (vs. the legacy first_name/last_name)?
  IF TG_OP = 'INSERT' THEN
    v_full_authored := NEW.full_name IS NOT NULL
                       AND btrim(NEW.full_name) <> '';
  ELSE
    v_full_authored := NEW.full_name IS DISTINCT FROM OLD.full_name
                       AND NEW.full_name IS NOT NULL;
  END IF;

  IF v_full_authored THEN
    -- full_name authored → derive the legacy parts (splitName equivalent).
    v_full         := btrim(regexp_replace(NEW.full_name, '\s+', ' ', 'g'));
    NEW.full_name  := v_full;
    v_given        := substring(v_full from '^(.+) [^ ]+$');
    v_family       := substring(v_full from ' ([^ ]+)$');
    NEW.first_name := coalesce(v_given, v_full);
    NEW.last_name  := coalesce(v_family, '');
  ELSE
    -- Legacy parts authoritative → derive full_name (joinName equivalent).
    NEW.full_name := btrim(
      concat_ws(' ',
        nullif(btrim(coalesce(NEW.first_name, '')), ''),
        nullif(btrim(coalesce(NEW.last_name,  '')), '')
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The trigger. BEFORE so NEW is fully consistent before the row is written
--    and before any AFTER triggers (e.g. the QuickBooks enqueue trigger) see it.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS contacts_sync_name_trg ON public.contacts;
CREATE TRIGGER contacts_sync_name_trg
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_sync_name();

-- ROLLBACK ---
-- drop trigger if exists contacts_sync_name_trg on public.contacts;
-- drop function if exists public.contacts_sync_name();
-- alter table public.contacts drop column if exists full_name;

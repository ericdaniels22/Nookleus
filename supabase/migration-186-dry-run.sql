-- issue #186 (PRD #45) — Backfill contacts.phone to E.164: DRY RUN.
--
-- Purpose:   Read-only preview of the migration-186 backfill. Reports how
--            many contacts.phone rows would change, how many are already
--            canonical, and how many cannot be parsed (and so are left
--            untouched). Run this FIRST and record the output on the PR
--            before applying migration-186-backfill-contacts-phone-e164.sql.
--
-- Safety:    SELECT-only. Creates a session-local pg_temp helper that
--            vanishes when the connection closes. Touches no real rows.
--
-- Normalization mirrors normalizePhoneToE164() in src/lib/phone.ts
-- (issue #183): strip non-digits; 10 digits -> +1XXXXXXXXXX; 11 digits with
-- a leading 1 -> +XXXXXXXXXXX; anything else is unparseable.
--
-- Run:       psql -f supabase/migration-186-dry-run.sql
--            (or paste into the Supabase SQL editor).

create or replace function pg_temp.normalize_us_phone_e164(raw text)
  returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as digits)
  select case
           when length(digits) = 10 then '+1' || digits
           when length(digits) = 11 and left(digits, 1) = '1' then '+' || digits
         end
  from d;
$$;

-- Summary counts — paste this row on the PR.
with classified as (
  select phone, pg_temp.normalize_us_phone_e164(phone) as normalized
  from public.contacts
)
select
  count(*)                                                     as total_rows,
  count(*) filter (where phone is not null and phone <> '')     as non_empty_phone,
  count(*) filter (where normalized is not null
                     and phone is distinct from normalized)     as would_change,
  count(*) filter (where normalized is not null
                     and phone is not distinct from normalized) as already_canonical,
  count(*) filter (where phone is not null and phone <> ''
                     and normalized is null)                    as unparseable
from classified;

-- Why each unparseable row is unparseable — digit counts only, no raw
-- phone values, so the PR record stays free of contact PII.
select
  length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) as digit_count,
  count(*)                                                   as rows
from public.contacts
where phone is not null and phone <> ''
  and pg_temp.normalize_us_phone_e164(phone) is null
group by 1
order by 1;

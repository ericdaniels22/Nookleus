-- issue #186 (PRD #45) — Backfill existing contacts.phone values to E.164.
--
-- Purpose:    Rewrite every parseable contacts.phone value to canonical
--             E.164 (+1XXXXXXXXXX). Rows whose value cannot be parsed as a
--             valid 10-digit US number are left untouched. Rows already in
--             canonical form are skipped, so updated_at is not bumped
--             needlessly.
--
-- Depends on: issue #183 — the app now writes E.164 via normalizePhoneToE164()
--             in src/lib/phone.ts. This migration brings pre-#183 rows into
--             line so the whole app reads one phone format.
--
-- Normalization mirrors normalizePhoneToE164() in src/lib/phone.ts exactly:
--             strip non-digits; 10 digits -> +1XXXXXXXXXX; 11 digits with a
--             leading 1 -> +XXXXXXXXXXX; anything else -> unparseable (skip).
--             The rule is verified against the TS util's test battery in
--             supabase/migration-186-smoke-test.sql.
--
-- Idempotent: re-running changes nothing — the WHERE clause excludes rows
--             already equal to their normalized form.
--
-- Dry run:    supabase/migration-186-dry-run.sql reports the would-change and
--             unparseable counts; run it first and record the output on the
--             PR before applying this migration.
--
-- Revert:     Not exactly reversible — see the -- ROLLBACK -- note at the end.

do $$
declare
  v_would_change bigint;
  v_unparseable  bigint;
  v_changed      bigint;
begin
  -- Session-local helper: vanishes when the connection closes, so no
  -- permanent schema surface is added. Declared once here and used by both
  -- the pre-count and the UPDATE below, so the normalization rule lives in
  -- exactly one place within this migration.
  create or replace function pg_temp.normalize_us_phone_e164(raw text)
    returns text language sql immutable as $fn$
    with d as (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as digits)
    select case
             when length(digits) = 10 then '+1' || digits
             when length(digits) = 11 and left(digits, 1) = '1' then '+' || digits
           end
    from d;
  $fn$;

  select
    count(*) filter (
      where pg_temp.normalize_us_phone_e164(phone) is not null
        and phone is distinct from pg_temp.normalize_us_phone_e164(phone)),
    count(*) filter (
      where phone is not null and phone <> ''
        and pg_temp.normalize_us_phone_e164(phone) is null)
    into v_would_change, v_unparseable
  from public.contacts;

  raise notice 'migration-186: % row(s) to normalize, % unparseable (left as-is)',
    v_would_change, v_unparseable;

  update public.contacts
     set phone = pg_temp.normalize_us_phone_e164(phone),
         updated_at = now()
   where pg_temp.normalize_us_phone_e164(phone) is not null
     and phone is distinct from pg_temp.normalize_us_phone_e164(phone);

  get diagnostics v_changed = row_count;

  -- Safety assertion — the count and the UPDATE use an identical predicate
  -- in one transaction, so a mismatch means a concurrent write slipped in.
  if v_changed <> v_would_change then
    raise exception
      'migration-186: expected to change % row(s), changed % — aborting',
      v_would_change, v_changed;
  end if;

  raise notice 'migration-186: backfill complete — % row(s) normalized to E.164',
    v_changed;
end $$;

-- ROLLBACK -------------------------------------------------------------------
-- This migration is not exactly reversible: the original pre-normalization
-- formatting (parentheses, dashes, dots, leading "1 ") is not recorded
-- anywhere. The change is cosmetic, though — every backfilled value still
-- holds the same ten significant digits, only the punctuation changed. To
-- present a stored E.164 value in the old display style, format it with
-- formatPhoneNumber() from src/lib/phone.ts rather than reverting the data.
-- ----------------------------------------------------------------------------

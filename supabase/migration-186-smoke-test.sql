-- issue #186 (PRD #45) — contacts.phone E.164 backfill — migration smoke test.
--
-- Purpose:   Self-checking script that verifies the migration-186 backfill
--            logic. It is *not* part of the migration. It re-creates the
--            normalization helper, asserts it against a battery of inputs
--            mirroring normalizePhoneToE164()'s unit tests in
--            src/lib/phone.test.ts, then exercises the exact backfill UPDATE
--            against a temp table. Every assertion raises an exception on
--            failure, so a clean run prints only NOTICE lines and a failed
--            run terminates loudly.
--
-- Shape:     One transaction, rolled back at the end — the DB is unchanged.
--            No real rows are read or written; the backfill is exercised
--            against a seeded temp table shaped like public.contacts.
--
-- Run:       psql -f supabase/migration-186-smoke-test.sql
--            (or paste into the Supabase SQL editor).

begin;

create or replace function pg_temp.normalize_us_phone_e164(raw text)
  returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as digits)
  select case
           when length(digits) = 10 then '+1' || digits
           when length(digits) = 11 and left(digits, 1) = '1' then '+' || digits
         end
  from d;
$$;

-- ---------------------------------------------------------------------------
-- 1. Normalization parity — mirrors normalizePhoneToE164() in
--    src/lib/phone.test.ts. The SQL helper and the TS util must agree, or
--    stored data and app behavior drift apart.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fail text;
begin
  select string_agg(
           format('  %s: norm(%L) = %L, expected %L',
                  label, input, pg_temp.normalize_us_phone_e164(input), expected),
           e'\n')
    into v_fail
  from (values
    ('null input',               null::text,         null::text),
    ('empty string',             '',                 null),
    ('blank / whitespace',       '   ',              null),
    ('bare 10-digit',            '5551234567',       '+15551234567'),
    ('formatted display string', '(555) 123-4567',   '+15551234567'),
    ('dotted separators',        '555.123.4567',     '+15551234567'),
    ('11-digit country code',    '1 (555) 123-4567', '+15551234567'),
    ('already-canonical E.164',  '+15551234567',     '+15551234567'),
    ('too few digits',           '555123',           null),
    ('too many digits',          '5551234567890',    null),
    ('11-digit not cc-prefixed', '25551234567',      null)
  ) as cases(label, input, expected)
  where pg_temp.normalize_us_phone_e164(input) is distinct from expected;

  if v_fail is not null then
    raise exception e'migration-186 smoke: normalization parity failed:\n%', v_fail;
  end if;
  raise notice 'migration-186 smoke: normalization parity — 11 cases pass';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill behavior — seed a temp table shaped like contacts, run the
--    exact UPDATE from the migration, assert every row's outcome:
--      - parseable values are rewritten to E.164;
--      - an already-canonical value is left alone (updated_at not bumped);
--      - unparseable values are left untouched;
--      - a NULL phone is left untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  v_changed bigint;
  r record;
begin
  create temp table _smoke_contacts (id text, phone text, updated_at timestamptz)
    on commit drop;
  insert into _smoke_contacts values
    ('parseable-bare',    '5551234567',      timestamptz '2020-01-01'),
    ('parseable-fmt',     '(555) 987-6543',  timestamptz '2020-01-01'),
    ('parseable-cc',      '1-555-111-2222',  timestamptz '2020-01-01'),
    ('already-e164',      '+15553334444',    timestamptz '2020-01-01'),
    ('unparseable-short', '555',             timestamptz '2020-01-01'),
    ('unparseable-text',  'call the office', timestamptz '2020-01-01'),
    ('null-phone',        null,              timestamptz '2020-01-01');

  update _smoke_contacts
     set phone = pg_temp.normalize_us_phone_e164(phone),
         updated_at = now()
   where pg_temp.normalize_us_phone_e164(phone) is not null
     and phone is distinct from pg_temp.normalize_us_phone_e164(phone);
  get diagnostics v_changed = row_count;

  if v_changed <> 3 then
    raise exception 'migration-186 smoke: expected 3 row(s) changed, got %', v_changed;
  end if;

  for r in select id, phone, updated_at from _smoke_contacts loop
    case r.id
      when 'parseable-bare' then
        if r.phone is distinct from '+15551234567' then
          raise exception 'migration-186 smoke: parseable-bare = %, expected +15551234567', r.phone;
        end if;
      when 'parseable-fmt' then
        if r.phone is distinct from '+15559876543' then
          raise exception 'migration-186 smoke: parseable-fmt = %, expected +15559876543', r.phone;
        end if;
      when 'parseable-cc' then
        if r.phone is distinct from '+15551112222' then
          raise exception 'migration-186 smoke: parseable-cc = %, expected +15551112222', r.phone;
        end if;
      when 'already-e164' then
        if r.phone is distinct from '+15553334444' then
          raise exception 'migration-186 smoke: already-e164 phone changed to %', r.phone;
        end if;
        if r.updated_at <> timestamptz '2020-01-01' then
          raise exception 'migration-186 smoke: already-e164 updated_at bumped — not idempotent';
        end if;
      when 'unparseable-short' then
        if r.phone is distinct from '555' then
          raise exception 'migration-186 smoke: unparseable-short changed to %', r.phone;
        end if;
        if r.updated_at <> timestamptz '2020-01-01' then
          raise exception 'migration-186 smoke: unparseable-short updated_at bumped';
        end if;
      when 'unparseable-text' then
        if r.phone is distinct from 'call the office' then
          raise exception 'migration-186 smoke: unparseable-text changed to %', r.phone;
        end if;
      when 'null-phone' then
        if r.phone is not null then
          raise exception 'migration-186 smoke: null-phone changed to %', r.phone;
        end if;
      else
        raise exception 'migration-186 smoke: unexpected seed row %', r.id;
    end case;
  end loop;

  raise notice 'migration-186 smoke: backfill behavior — 7 rows pass (3 changed, 4 untouched)';
end $$;

rollback;

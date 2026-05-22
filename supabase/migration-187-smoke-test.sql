-- issue #187 (PRD #45) — form_config when_happened text->date — migration smoke test.
--
-- Purpose:   Self-checking script that verifies the migration-187 transform.
--            It is *not* part of the migration. It re-creates the transform
--            helper, asserts it against a battery of config shapes, then
--            exercises the exact migration UPDATE against a temp table shaped
--            like public.form_config. Every assertion raises an exception on
--            failure, so a clean run prints only NOTICE lines and a failed
--            run terminates loudly.
--
-- Shape:     One transaction, rolled back at the end — the DB is unchanged.
--            No real rows are read or written; the migration is exercised
--            against a seeded temp table.
--
-- Run:       psql -f supabase/migration-187-smoke-test.sql
--            (or paste into the Supabase SQL editor).

begin;

-- The transform helper, identical to the one in
-- migration-187-form-config-when-happened-date.sql and migration-187-dry-run.sql.
create or replace function pg_temp.flip_when_happened_type(cfg jsonb)
  returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(cfg->'sections') = 'array' then
      jsonb_set(cfg, '{sections}', (
        select coalesce(jsonb_agg(
          case
            when jsonb_typeof(section->'fields') = 'array' then
              jsonb_set(section, '{fields}', (
                select coalesce(jsonb_agg(
                  case
                    when field->>'id' = 'when_happened'
                      then jsonb_set(field, '{type}', '"date"'::jsonb)
                    else field
                  end
                  order by ford
                ), '[]'::jsonb)
                from jsonb_array_elements(section->'fields')
                     with ordinality as f(field, ford)
              ))
            else section
          end
          order by sord
        ), '[]'::jsonb)
        from jsonb_array_elements(cfg->'sections')
             with ordinality as s(section, sord)
      ))
    else cfg
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Transform parity — flip_when_happened_type() flips when_happened's type
--    to "date" and changes nothing else.
-- ---------------------------------------------------------------------------

-- C1: when_happened text -> date.
do $$
declare
  v_in  jsonb := '{"sections":[{"id":"damage_info","title":"Damage Information","fields":[
    {"id":"when_happened","type":"text","label":"When Did It Happen?","required":false}
  ]}]}';
  v_out jsonb := pg_temp.flip_when_happened_type(v_in);
begin
  if v_out #>> '{sections,0,fields,0,type}' is distinct from 'date' then
    raise exception 'smoke C1: when_happened type = %, expected "date"',
      v_out #>> '{sections,0,fields,0,type}';
  end if;
  raise notice 'smoke C1: when_happened text -> date — PASS';
end $$;

-- C2: sibling fields in the same section keep their own type.
do $$
declare
  v_in  jsonb := '{"sections":[{"id":"damage_info","title":"Damage Information","fields":[
    {"id":"damage_type","type":"pill","label":"Type of Damage"},
    {"id":"damage_source","type":"text","label":"Source of Damage"},
    {"id":"when_happened","type":"text","label":"When Did It Happen?"},
    {"id":"affected_areas","type":"text","label":"Affected Areas"}
  ]}]}';
  v_out jsonb := pg_temp.flip_when_happened_type(v_in);
begin
  if v_out #>> '{sections,0,fields,0,type}' is distinct from 'pill'
     or v_out #>> '{sections,0,fields,1,type}' is distinct from 'text'
     or v_out #>> '{sections,0,fields,2,type}' is distinct from 'date'
     or v_out #>> '{sections,0,fields,3,type}' is distinct from 'text' then
    raise exception 'smoke C2: sibling field types = %',
      (select jsonb_agg(f->>'type') from jsonb_array_elements(v_out#>'{sections,0,fields}') f);
  end if;
  raise notice 'smoke C2: sibling fields keep their type — PASS';
end $$;

-- C3: every other key inside the when_happened object is preserved — only
--     "type" changes.
do $$
declare
  v_field jsonb := '{"id":"when_happened","type":"text","label":"When Did It Happen?",
    "required":false,"is_default":true,"visible":true}';
  v_in  jsonb := jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('id','damage_info','fields', jsonb_build_array(v_field))));
  v_out_field jsonb := pg_temp.flip_when_happened_type(v_in) #> '{sections,0,fields,0}';
begin
  if v_out_field is distinct from (v_field || '{"type":"date"}'::jsonb) then
    raise exception 'smoke C3: when_happened object = %, expected only type flipped',
      v_out_field;
  end if;
  raise notice 'smoke C3: when_happened other keys preserved — PASS';
end $$;

-- C4: a config with no when_happened field is returned byte-for-byte unchanged.
do $$
declare
  v_in jsonb := '{"sections":[
    {"id":"caller_info","title":"Caller Information","fields":[
      {"id":"first_name","type":"text","label":"First Name"},
      {"id":"phone","type":"phone","label":"Phone"}]},
    {"id":"property","title":"Property Details","fields":[
      {"id":"property_address","type":"text","label":"Property Address"}]}
  ]}';
begin
  if pg_temp.flip_when_happened_type(v_in) is distinct from v_in then
    raise exception 'smoke C4: config without when_happened was modified — got %',
      pg_temp.flip_when_happened_type(v_in);
  end if;
  raise notice 'smoke C4: config without when_happened unchanged — PASS';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Migration behavior — seed a temp table shaped like public.form_config,
--    run the exact UPDATE from migration-187, and assert each row's outcome:
--      - a row whose when_happened is "text" is flipped to "date" and its
--        updated_at is bumped;
--      - a row whose when_happened is already "date" is left untouched
--        (config unchanged, updated_at NOT bumped);
--      - a row with no when_happened field is left untouched;
--    then re-run the UPDATE and assert it changes zero rows (idempotent).
-- ---------------------------------------------------------------------------
do $$
declare
  v_seed_ts constant timestamptz := timestamptz '2020-01-01';
  v_changed bigint;
  r record;
begin
  create temp table _smoke_form_config (id text, config jsonb, updated_at timestamptz)
    on commit drop;
  insert into _smoke_form_config values
    ('text-row', '{"sections":[
        {"id":"caller_info","fields":[{"id":"phone","type":"phone"}]},
        {"id":"damage_info","fields":[
          {"id":"damage_source","type":"text"},
          {"id":"when_happened","type":"text","label":"When Did It Happen?"}]}
      ]}', v_seed_ts),
    ('already-date', '{"sections":[
        {"id":"damage_info","fields":[{"id":"when_happened","type":"date"}]}
      ]}', v_seed_ts),
    ('no-when-happened', '{"sections":[
        {"id":"caller_info","fields":[{"id":"first_name","type":"text"}]}
      ]}', v_seed_ts);

  -- The exact UPDATE from migration-187-form-config-when-happened-date.sql.
  update _smoke_form_config
     set config = pg_temp.flip_when_happened_type(config),
         updated_at = now()
   where config is distinct from pg_temp.flip_when_happened_type(config);
  get diagnostics v_changed = row_count;

  -- C5: exactly the one text-row is flipped; the other two are untouched.
  if v_changed <> 1 then
    raise exception 'smoke C5: expected 1 row changed, got %', v_changed;
  end if;
  for r in select id, config, updated_at from _smoke_form_config loop
    case r.id
      when 'text-row' then
        if r.config #>> '{sections,1,fields,1,type}' is distinct from 'date' then
          raise exception 'smoke C5: text-row when_happened type = %, expected date',
            r.config #>> '{sections,1,fields,1,type}';
        end if;
        if r.updated_at <= v_seed_ts then
          raise exception 'smoke C5: text-row updated_at was not bumped';
        end if;
      when 'already-date' then
        if r.config #>> '{sections,0,fields,0,type}' is distinct from 'date' then
          raise exception 'smoke C5: already-date row config was corrupted';
        end if;
        if r.updated_at <> v_seed_ts then
          raise exception 'smoke C5: already-date updated_at was bumped — not idempotent';
        end if;
      when 'no-when-happened' then
        if r.updated_at <> v_seed_ts then
          raise exception 'smoke C5: no-when-happened updated_at was bumped';
        end if;
      else
        raise exception 'smoke C5: unexpected seed row %', r.id;
    end case;
  end loop;
  raise notice 'smoke C5: migration UPDATE — 3 rows (1 flipped, 2 untouched) — PASS';

  -- C6: re-running the migration changes nothing.
  update _smoke_form_config
     set config = pg_temp.flip_when_happened_type(config),
         updated_at = now()
   where config is distinct from pg_temp.flip_when_happened_type(config);
  get diagnostics v_changed = row_count;
  if v_changed <> 0 then
    raise exception 'smoke C6: re-run changed % row(s), expected 0', v_changed;
  end if;
  raise notice 'smoke C6: migration UPDATE is idempotent on re-run — PASS';
end $$;

rollback;

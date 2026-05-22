-- issue #187 (PRD #45) — flip when_happened "text" -> "date": DRY RUN.
--
-- Purpose:   Read-only preview of migration-187. Reports how many form_config
--            rows would change, how many already carry when_happened on
--            "date", and how many have no when_happened field at all. Run
--            this FIRST and record the output on the PR before applying
--            migration-187-form-config-when-happened-date.sql.
--
-- Safety:    SELECT-only. Creates a session-local pg_temp helper that
--            vanishes when the connection closes. Touches no real rows.
--
-- Transform rule mirrors flip_when_happened_type() in
-- migration-187-form-config-when-happened-date.sql exactly: walk
-- config->sections->fields, rewrite only the when_happened field's "type"
-- to "date", preserve everything else.
--
-- Run:       psql -f supabase/migration-187-dry-run.sql
--            (or paste into the Supabase SQL editor).

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

-- Summary counts — paste this row on the PR.
with classified as (
  select
    config is distinct from pg_temp.flip_when_happened_type(config) as would_change,
    exists (
      select 1
      from jsonb_array_elements(
             case when jsonb_typeof(config->'sections') = 'array'
                  then config->'sections' else '[]'::jsonb end) s
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(s->'fields') = 'array'
                  then s->'fields' else '[]'::jsonb end) f
      where f->>'id' = 'when_happened'
    ) as has_when_happened
  from public.form_config
)
select
  count(*)                                                        as total_rows,
  count(*) filter (where has_when_happened)                       as has_when_happened,
  count(*) filter (where would_change)                            as would_change,
  count(*) filter (where has_when_happened and not would_change)  as already_date,
  count(*) filter (where not has_when_happened)                   as no_when_happened
from classified;

-- when_happened.type breakdown across every row that carries the field.
-- Expected before applying: all rows on "text"; after: all on "date".
select f->>'type' as when_happened_type, count(*) as rows
from public.form_config fc
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(fc.config->'sections') = 'array'
       then fc.config->'sections' else '[]'::jsonb end) s
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(s->'fields') = 'array'
       then s->'fields' else '[]'::jsonb end) f
where f->>'id' = 'when_happened'
group by 1
order by 2 desc;

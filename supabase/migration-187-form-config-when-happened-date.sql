-- issue #187 (PRD #45) — flip when_happened "text" -> "date" in every existing
-- organization's saved form_config.
--
-- Purpose:    The intake-form builder seed was updated in issue #184 so newly
--             seeded orgs render the "When Did It Happen?" field with the new
--             masked-date component (form-config field type "date"). Orgs
--             created before #184 still carry the old type: "text" in their
--             stored form_config.config JSONB and would never get the date
--             renderer. This migration flips when_happened's "type" to "date"
--             in every existing form_config row that has the field.
--
-- Scope:      Only the when_happened field's "type" key is rewritten. Every
--             other field, every other key within when_happened, and the
--             section / field ordering are preserved. Rows with no
--             when_happened field are left untouched. The transform rule is
--             verified test-first in supabase/migration-187-smoke-test.sql.
--
-- Idempotent: re-running changes nothing — the WHERE clause excludes rows
--             that already equal their transformed form, so updated_at is
--             not bumped on rows already on "date" or with no when_happened.
--
-- Dry run:    supabase/migration-187-dry-run.sql reports the would-change
--             count; run it first and record the output on the PR before
--             applying this migration.
--
-- Revert:     Not cleanly auto-reversible — see the -- ROLLBACK -- note below.

do $$
declare
  v_would_change bigint;
  v_changed      bigint;
begin
  -- Session-local helper: vanishes when the connection closes, so no
  -- permanent schema surface is added. Declared once and used by both the
  -- pre-count and the UPDATE below, so the transform rule lives in exactly
  -- one place within this migration. It walks config->sections->fields,
  -- rewrites only the when_happened field's "type" to "date", and rebuilds
  -- both arrays in their original order. Identical to the helper in
  -- migration-187-smoke-test.sql and migration-187-dry-run.sql.
  create or replace function pg_temp.flip_when_happened_type(cfg jsonb)
    returns jsonb language sql immutable as $fn$
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
  $fn$;

  select count(*) filter (
           where config is distinct from pg_temp.flip_when_happened_type(config))
    into v_would_change
  from public.form_config;

  raise notice 'migration-187: % form_config row(s) to flip when_happened text -> date',
    v_would_change;

  update public.form_config
     set config = pg_temp.flip_when_happened_type(config),
         updated_at = now()
   where config is distinct from pg_temp.flip_when_happened_type(config);

  get diagnostics v_changed = row_count;

  -- Safety assertion — the pre-count and the UPDATE use an identical
  -- predicate within one transaction, so a mismatch means a concurrent write
  -- slipped in.
  if v_changed <> v_would_change then
    raise exception
      'migration-187: expected to change % row(s), changed % — aborting',
      v_would_change, v_changed;
  end if;

  raise notice 'migration-187: complete — % form_config row(s) updated to date',
    v_changed;
end $$;

-- ROLLBACK -------------------------------------------------------------------
-- Not cleanly auto-reversible. A blanket "flip when_happened date -> text"
-- would also downgrade orgs seeded *after* issue #184, whose form_config seed
-- already produces type: "date" — those were never "text" and must stay
-- "date". This migration does not record which rows it touched.
--
-- The change is config-only and low-risk: it swaps a single string within a
-- builder field. If a specific org's config must be reverted, edit that one
-- form_config row's when_happened.type back to "text" by id.
-- ----------------------------------------------------------------------------

-- Issue #352 — Backfill existing estimate templates into the #351 snapshot shape.
--
-- Purpose:    Walk every estimate_templates.structure JSONB tree (sections,
--             subsections, items) and write the flat snapshot fields #351 added
--             — name, description, code, unit, quantity, unit_price — onto every
--             item, so each item carries its own copy instead of resolving from
--             the library at apply/render time. After this runs, every (object)
--             item has all six keys present (some may be JSON null).
--
--             Per ADR 0004 each item is resolved with the SAME ladder
--             apply_template_to_estimate uses, minus the apply-time defaults
--             ('[unknown item]', qty 1, price 0) — the snapshot stores NULL
--             where nothing is known, and the RPC supplies those defaults later:
--               * library_item_id resolves to an active item_library row in the
--                 same org  -> name/code/unit from the library; description/
--                 quantity/unit_price take the user's *_override where set
--                 (an explicit edit wins), else the library value;
--               * library_item_id is NULL (Custom item)  -> description/quantity/
--                 unit_price from the *_override values where present; name/code/
--                 unit left NULL (these silently lost name/code/unit pre-#350);
--               * library_item_id set but its row is gone/inactive/foreign
--                 (deleted item)  -> same as Custom: copy what the structure
--                 preserved, leave the rest NULL.
--             Any flat field already present (a post-#351 authored template, or
--             a prior run of this migration) wins over everything — that is what
--             makes the backfill a snapshot and makes it idempotent.
--
-- Dirty data: this runs over arbitrary pre-#350 structure JSONB, which ADR 0004
--             warns is lossy. The rebuild is therefore defensive: absent,
--             JSON-null, or non-array items/subsections/sections normalize to an
--             empty array, and any section/subsection/item element that is not a
--             JSON object is left EXACTLY as found (never `||`-merged, which on a
--             non-object would concatenate into an array and corrupt the row).
--             A single malformed row never aborts the whole one-shot backfill;
--             malformed item elements left untouched are reported via a notice.
--
-- Mirrors:    The COALESCE(flat, *_override, library) ladder in
--             apply_template_to_estimate (migration-351-template-line-items-
--             snapshot.sql) and synthItemFromTemplate() in
--             src/lib/estimate-templates.ts. Keep the three in lockstep.
--
-- Depends on: #351 (migration-351) introduced the flat fields and the
--             dual-shape apply ladder. #353 later drops the *_override fallback
--             once this backfill has run everywhere.
--
-- Idempotent: re-running changes nothing. Each item prefers its existing flat
--             field, the array rebuild is order-stable, non-object elements pass
--             through unchanged, and the UPDATE's `is distinct from` guard skips
--             rows whose structure already equals the backfilled form (so
--             updated_at is not bumped needlessly).
--
-- Revert:     One-shot data migration. The pre-migration structure is not
--             recorded, so there is no automatic rollback; the change is
--             additive (it only fills the six flat keys), and apply/render still
--             read through the *_override fallback that remains until #353.

do $$
declare
  v_would_change bigint;
  v_changed      bigint;
  v_missing      bigint;
  v_skipped      bigint;
begin
  -- Session-local helpers (pg_temp.*): they vanish when the connection closes,
  -- so this migration adds no permanent schema surface.

  -- Coerce any jsonb to an array: absent (SQL NULL), explicit JSON null, and any
  -- non-array scalar/object all collapse to []. `coalesce(x->'k','[]')` is NOT
  -- enough — it only catches an absent key; an explicit `"k": null` yields the
  -- jsonb scalar null, which jsonb_array_elements() rejects.
  create or replace function pg_temp.as_jsonb_array(p jsonb)
    returns jsonb language sql immutable as $fn$
    select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end;
  $fn$;

  -- Resolve one structure item into its snapshot form. A non-object element
  -- (e.g. a JSON null left by dirty legacy data) is returned untouched — never
  -- `||`-merged, since `null || object` concatenates into an array. The library
  -- row is looked up live; when library_item_id is NULL or its row is
  -- gone/inactive/foreign, v_lib is a row of NULLs and every library rung below
  -- contributes NULL.
  create or replace function pg_temp.snapshot_item(p_item jsonb, p_org uuid)
    returns jsonb language plpgsql stable as $fn$
  declare
    v_lib_id uuid;
    v_lib    public.item_library%rowtype;
  begin
    if jsonb_typeof(p_item) is distinct from 'object' then
      return p_item;
    end if;

    v_lib_id := nullif(p_item->>'library_item_id', '')::uuid;
    if v_lib_id is not null then
      select * into v_lib
        from public.item_library
       where id = v_lib_id
         and is_active = true
         and organization_id = p_org;
    end if;

    -- to_jsonb(NULL) is JSON null, so every key is written even when unknown.
    return p_item || jsonb_build_object(
      'name',        to_jsonb(coalesce(nullif(p_item->>'name', ''),
                                       v_lib.name)),
      'description', to_jsonb(coalesce(nullif(p_item->>'description', ''),
                                       nullif(p_item->>'description_override', ''),
                                       v_lib.description)),
      'code',        to_jsonb(coalesce(nullif(p_item->>'code', ''),
                                       v_lib.code)),
      'unit',        to_jsonb(coalesce(nullif(p_item->>'unit', ''),
                                       v_lib.default_unit)),
      'quantity',    to_jsonb(coalesce(nullif(p_item->>'quantity', '')::numeric,
                                       nullif(p_item->>'quantity_override', '')::numeric,
                                       v_lib.default_quantity)),
      'unit_price',  to_jsonb(coalesce(nullif(p_item->>'unit_price', '')::numeric,
                                       nullif(p_item->>'unit_price_override', '')::numeric,
                                       v_lib.unit_price))
    );
  end;
  $fn$;

  -- Rebuild a whole structure: every OBJECT section keeps its other keys but gets
  -- its items (and each subsection's items) mapped through snapshot_item, order
  -- preserved by ordinality. Arrays are normalized via as_jsonb_array; non-object
  -- section/subsection elements pass through unchanged.
  create or replace function pg_temp.snapshot_structure(p_structure jsonb, p_org uuid)
    returns jsonb language sql stable as $fn$
    select jsonb_set(
      coalesce(p_structure, '{}'::jsonb),
      '{sections}',
      coalesce((
        select jsonb_agg(
                 case when jsonb_typeof(sec_elem) = 'object' then
                   sec_elem || jsonb_build_object(
                     'items', coalesce((
                       select jsonb_agg(pg_temp.snapshot_item(it_elem, p_org) order by it_ord)
                       from jsonb_array_elements(pg_temp.as_jsonb_array(sec_elem->'items'))
                              with ordinality as it(it_elem, it_ord)
                     ), '[]'::jsonb),
                     'subsections', coalesce((
                       select jsonb_agg(
                                case when jsonb_typeof(sub_elem) = 'object' then
                                  sub_elem || jsonb_build_object(
                                    'items', coalesce((
                                      select jsonb_agg(pg_temp.snapshot_item(sit_elem, p_org) order by sit_ord)
                                      from jsonb_array_elements(pg_temp.as_jsonb_array(sub_elem->'items'))
                                             with ordinality as sit(sit_elem, sit_ord)
                                    ), '[]'::jsonb)
                                  )
                                else sub_elem end
                                order by sub_ord
                              )
                       from jsonb_array_elements(pg_temp.as_jsonb_array(sec_elem->'subsections'))
                              with ordinality as sub(sub_elem, sub_ord)
                     ), '[]'::jsonb)
                   )
                 else sec_elem end
                 order by sec_ord
               )
        from jsonb_array_elements(pg_temp.as_jsonb_array(p_structure->'sections'))
               with ordinality as sec(sec_elem, sec_ord)
      ), '[]'::jsonb)
    );
  $fn$;

  -- Pre-count, so a row-count mismatch (a concurrent write) aborts the run.
  select count(*) into v_would_change
    from public.estimate_templates t
   where jsonb_typeof(t.structure->'sections') = 'array'
     and t.structure is distinct from pg_temp.snapshot_structure(t.structure, t.organization_id);

  raise notice 'migration-352: % template(s) to backfill', v_would_change;

  update public.estimate_templates t
     set structure = pg_temp.snapshot_structure(t.structure, t.organization_id)
   where jsonb_typeof(t.structure->'sections') = 'array'
     and t.structure is distinct from pg_temp.snapshot_structure(t.structure, t.organization_id);

  get diagnostics v_changed = row_count;

  if v_changed <> v_would_change then
    raise exception
      'migration-352: expected to change % template(s), changed % — aborting',
      v_would_change, v_changed;
  end if;

  -- Post-condition + dirty-data report, in one walk over every item element:
  --   v_missing = OBJECT items still lacking any of the six keys (must be 0);
  --   v_skipped = non-object item elements left untouched (informational).
  -- `?` tests key presence, not non-nullness.
  select
    count(*) filter (
      where jsonb_typeof(walk.item) = 'object'
        and not (
          walk.item ? 'name' and walk.item ? 'description' and walk.item ? 'code'
          and walk.item ? 'unit' and walk.item ? 'quantity' and walk.item ? 'unit_price'
        )),
    count(*) filter (where jsonb_typeof(walk.item) is distinct from 'object')
    into v_missing, v_skipped
  from public.estimate_templates t
  cross join lateral (
    select it as item
    from jsonb_array_elements(pg_temp.as_jsonb_array(t.structure->'sections')) s,
         jsonb_array_elements(pg_temp.as_jsonb_array(s->'items')) it
    union all
    select sit
    from jsonb_array_elements(pg_temp.as_jsonb_array(t.structure->'sections')) s,
         jsonb_array_elements(pg_temp.as_jsonb_array(s->'subsections')) sub,
         jsonb_array_elements(pg_temp.as_jsonb_array(sub->'items')) sit
  ) walk
  where jsonb_typeof(t.structure->'sections') = 'array';

  if v_missing > 0 then
    raise exception
      'migration-352: % template item(s) still missing flat snapshot fields after backfill',
      v_missing;
  end if;

  if v_skipped > 0 then
    raise notice
      'migration-352: left % malformed (non-object) item element(s) untouched — these need manual cleanup',
      v_skipped;
  end if;

  raise notice 'migration-352: backfill complete — % template(s) rewritten', v_changed;
end $$;

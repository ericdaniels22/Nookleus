-- issue #111 (PRD #109), full_name slice 2 — contract-template name rewrite.
--
-- Purpose:   Contract templates place a customer's name as one or two `merge`
--            overlay stamps at fixed coordinates. A split first-name +
--            last-name pair renders with an unwanted horizontal gap between
--            the two stamps. This migration collapses the split name into the
--            single `customer_name` merge field (which resolves from
--            contacts.full_name) across every existing
--            contract_templates.overlay_fields: the first-name stamp is
--            renamed to `customer_name` and the now-redundant last-name stamp
--            is dropped. A template carrying only a last-name stamp has it
--            renamed instead.
--
-- Mirrors:   rewriteOverlayNameFields() in
--            src/lib/contracts/template-name-rewrite.ts — keep the two in
--            lockstep. Name overlay fields are identified by their form_config
--            mapping (contact.first_name / contact.last_name), not by slug
--            string, because the slugs are org-specific.
--
-- Depends on: migration-110 (customer_name now resolves from contacts.full_name).
-- Revert:    one-shot data migration; the dropped last-name stamps cannot be
--            reconstructed, so there is no automatic rollback.

-- ---------------------------------------------------------------------------
-- 1. Pure rewrite helper (session-scoped). Mirrors the TS module: rename
--    first-name merge stamps to customer_name; drop last-name merge stamps
--    when a first-name stamp is present, otherwise rename them too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.rewrite_overlay_name_fields(
  p_overlay   jsonb,
  first_slugs text[],
  last_slugs  text[]
) RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  has_first boolean;
  result    jsonb := '[]'::jsonb;
  elem      jsonb;
  slug      text;
BEGIN
  IF p_overlay IS NULL OR jsonb_typeof(p_overlay) <> 'array' THEN
    RETURN p_overlay;
  END IF;

  has_first := EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_overlay) e
    WHERE e->>'type' = 'merge'
      AND e->>'mergeFieldName' = ANY(first_slugs)
  );

  FOR elem IN SELECT * FROM jsonb_array_elements(p_overlay) LOOP
    slug := elem->>'mergeFieldName';
    IF elem->>'type' = 'merge' AND slug = ANY(first_slugs) THEN
      result := result || jsonb_build_array(
        jsonb_set(elem, '{mergeFieldName}', '"customer_name"')
      );
    ELSIF elem->>'type' = 'merge' AND slug = ANY(last_slugs) THEN
      -- A first-name stamp already becomes customer_name (the full name), so
      -- an accompanying last-name stamp is redundant — drop it. With no
      -- first-name stamp, rename the lone last-name stamp instead.
      IF has_first THEN
        CONTINUE;
      END IF;
      result := result || jsonb_build_array(
        jsonb_set(elem, '{mergeFieldName}', '"customer_name"')
      );
    ELSE
      result := result || jsonb_build_array(elem);
    END IF;
  END LOOP;

  RETURN result;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Rewrite every org's contract templates, using that org's latest
--    form_config to identify which slugs are the first/last name fields.
--    A field's slug is `merge_field_slug` when set, else the field id.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org   uuid;
  v_first text[];
  v_last  text[];
begin
  for v_org in select distinct organization_id from public.contract_templates loop
    select
      array_agg(slug) filter (where maps_to = 'contact.first_name'),
      array_agg(slug) filter (where maps_to = 'contact.last_name')
      into v_first, v_last
    from (
      select coalesce(f->>'merge_field_slug', f->>'id') as slug,
             f->>'maps_to'                              as maps_to
      from public.form_config fc,
           jsonb_array_elements(fc.config->'sections') s,
           jsonb_array_elements(s->'fields')           f
      where fc.organization_id = v_org
        and fc.version = (
          select max(version) from public.form_config
          where organization_id = v_org
        )
    ) name_fields;

    update public.contract_templates
       set overlay_fields = pg_temp.rewrite_overlay_name_fields(
             overlay_fields,
             coalesce(v_first, '{}'::text[]),
             coalesce(v_last,  '{}'::text[])
           )
     where organization_id = v_org;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Safety assertion: no contract-template overlay may still reference a
--    first/last name slug from its org's latest form_config.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad int;
begin
  select count(*)
    into v_bad
  from public.contract_templates t,
       jsonb_array_elements(coalesce(t.overlay_fields, '[]'::jsonb)) ovl
  where ovl->>'type' = 'merge'
    and ovl->>'mergeFieldName' in (
      select coalesce(f->>'merge_field_slug', f->>'id')
      from public.form_config fc,
           jsonb_array_elements(fc.config->'sections') s,
           jsonb_array_elements(s->'fields')           f
      where fc.organization_id = t.organization_id
        and fc.version = (
          select max(version) from public.form_config
          where organization_id = t.organization_id
        )
        and f->>'maps_to' in ('contact.first_name', 'contact.last_name')
    );

  if v_bad > 0 then
    raise exception 'contract-template name rewrite: % overlay field(s) still reference a split first/last name slug', v_bad;
  end if;
end $$;

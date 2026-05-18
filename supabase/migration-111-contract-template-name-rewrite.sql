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
-- Slice order: name slugs are collected from EVERY form_config version of an
--            org, not just the latest. Slice #112 collapses the latest
--            form_config to a single contact.full_name field, which would
--            otherwise erase the mappings this migration needs — scanning all
--            versions makes #111 independent of whether #112 has run.
--
-- Depends on: migration-110 (customer_name now resolves from contacts.full_name).
-- Revert:    one-shot data migration; the dropped last-name stamps cannot be
--            reconstructed, so there is no automatic rollback.
--
-- Note:      The whole migration is a single do-block so it runs in one
--            session. The element rebuild is inlined rather than factored
--            into a helper function.

do $$
declare
  v_org   uuid;
  v_first text[];
  v_last  text[];
  v_bad   int;
begin
  -- 1. Rewrite each org's contract templates. A field's slug is
  --    `merge_field_slug` when set, else the field id; a slug that has ever
  --    mapped to contact.first_name / contact.last_name in any form_config
  --    version of the org is treated as a name slug.
  for v_org in select distinct organization_id from public.contract_templates loop
    select
      array_agg(distinct slug) filter (where maps_to = 'contact.first_name'),
      array_agg(distinct slug) filter (where maps_to = 'contact.last_name')
      into v_first, v_last
    from (
      select coalesce(f->>'merge_field_slug', f->>'id') as slug,
             f->>'maps_to'                              as maps_to
      from public.form_config fc,
           jsonb_array_elements(fc.config->'sections') s,
           jsonb_array_elements(s->'fields')           f
      where fc.organization_id = v_org
    ) name_fields;

    v_first := coalesce(v_first, '{}'::text[]);
    v_last  := coalesce(v_last,  '{}'::text[]);

    update public.contract_templates t
       set overlay_fields = (
         select coalesce(jsonb_agg(new_elem order by ord), '[]'::jsonb)
         from (
           select ord,
             case
               -- First-name stamp -> customer_name (resolves the full name).
               when elem->>'type' = 'merge'
                    and elem->>'mergeFieldName' = any(v_first)
                 then jsonb_set(elem, '{mergeFieldName}', '"customer_name"')
               -- Last-name stamp: redundant when a first-name stamp is also
               -- present (drop it); otherwise it is the only name field so
               -- rename it instead.
               when elem->>'type' = 'merge'
                    and elem->>'mergeFieldName' = any(v_last)
                 then case
                        when exists (
                          select 1
                          from jsonb_array_elements(t.overlay_fields) e2
                          where e2->>'type' = 'merge'
                            and e2->>'mergeFieldName' = any(v_first)
                        )
                          then null
                        else jsonb_set(elem, '{mergeFieldName}', '"customer_name"')
                      end
               else elem
             end as new_elem
           from jsonb_array_elements(t.overlay_fields)
                  with ordinality as a(elem, ord)
         ) rebuilt
         where new_elem is not null
       )
     where t.organization_id = v_org
       and jsonb_typeof(t.overlay_fields) = 'array';
  end loop;

  -- 2. Safety assertion: no contract-template overlay may still reference a
  --    first/last name slug from any form_config version of its org.
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
        and f->>'maps_to' in ('contact.first_name', 'contact.last_name')
    );

  if v_bad > 0 then
    raise exception 'contract-template name rewrite: % overlay field(s) still reference a split first/last name slug', v_bad;
  end if;
end $$;

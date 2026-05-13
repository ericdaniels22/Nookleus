-- Build 67 slice #67 — backfill merge_field_slug aliases on form_config rows.
--
-- Why: the new MergeFieldRegistry derives merge-field slugs from each
-- intake field's `id` unless an explicit `merge_field_slug` is set
-- (legacy alias takeover). Existing contract templates reference legacy
-- slugs like "customer_first_name", "customer_email", "customer_phone"
-- that don't match the corresponding intake field IDs ("first_name",
-- "email", "phone"). Without this backfill those overlay fields render
-- UNRESOLVED at preview and validation rejects future saves.
--
-- The id-matching fields (damage_type, property_type, property_address,
-- etc.) are pinned to their legacy slugs too so future intake authors
-- can rename the field id without breaking live contract templates.
--
-- Idempotent: only sets merge_field_slug when not already present.
-- Reversible: SET config = (... remove the slug keys ...).

DO $$
DECLARE
  fc record;
  new_sections jsonb;
  section jsonb;
  field jsonb;
  new_fields jsonb;
  new_field jsonb;
  alias_map jsonb := '{
    "first_name": "customer_first_name",
    "email": "customer_email",
    "phone": "customer_phone",
    "damage_type": "damage_type",
    "damage_source": "damage_source",
    "affected_areas": "affected_areas",
    "property_address": "property_address",
    "property_type": "property_type",
    "insurance_company": "insurance_company",
    "claim_number": "claim_number"
  }'::jsonb;
BEGIN
  FOR fc IN SELECT id, config FROM form_config LOOP
    new_sections := '[]'::jsonb;
    FOR section IN SELECT * FROM jsonb_array_elements(fc.config->'sections') LOOP
      new_fields := '[]'::jsonb;
      FOR field IN SELECT * FROM jsonb_array_elements(section->'fields') LOOP
        new_field := field;
        IF alias_map ? (field->>'id') AND NOT (field ? 'merge_field_slug') THEN
          new_field := new_field || jsonb_build_object(
            'merge_field_slug',
            alias_map->>(field->>'id')
          );
        END IF;
        new_fields := new_fields || jsonb_build_array(new_field);
      END LOOP;
      new_sections := new_sections || jsonb_build_array(
        jsonb_set(section, '{fields}', new_fields)
      );
    END LOOP;
    UPDATE form_config
      SET config = jsonb_set(fc.config, '{sections}', new_sections),
          updated_at = now()
      WHERE id = fc.id;
  END LOOP;
END $$;

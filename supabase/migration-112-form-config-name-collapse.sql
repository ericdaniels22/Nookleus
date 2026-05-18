-- issue #112 (PRD #109), full_name slice 3 — collapse intake form name fields.
--
-- Purpose:   The intake form is moving from two name fields (one mapped to
--            `contact.first_name`, one to `contact.last_name`) to a single
--            "Full Name" field mapped to `contact.full_name`. This migration
--            runs that collapse over every organization's live intake form.
--
-- Mirrors:   collapseNameFields() in src/lib/form-config-name-collapse.ts —
--            the anchor field (first-name when present, otherwise the lone
--            last-name field) becomes the "Full Name" field in place; the
--            other name field is dropped; the result is required if either
--            original field was required and carries merge slug
--            `customer_name`.
--
-- Scope:     Only the latest `form_config` version per organization — the one
--            the intake form and form builder actually load. Earlier versions
--            are left intact so the form_config version history (and the
--            restore flow) keep their pre-collapse snapshots.
--
-- Idempotent: a config with no `contact.first_name` / `contact.last_name`
--            field is skipped, so re-running is a no-op.
--
-- Depends on: migration-110 (the `full_name` column + coexistence trigger).
-- Revert:    restore the prior `form_config` version per org, or re-save the
--            intake form from the builder. The collapse is lossy (the second
--            name field's id/label are not recoverable) so there is no
--            in-place SQL rollback.

DO $$
DECLARE
  rec             record;
  section         jsonb;
  field           jsonb;
  new_sections    jsonb;
  new_fields      jsonb;
  collapsed       jsonb;
  has_first       boolean;
  has_last        boolean;
  first_required  boolean;
  last_required   boolean;
BEGIN
  -- Table aliases (t / t2) are kept distinct from the loop record variable
  -- so PL/pgSQL does not shadow the correlated subquery's column reference.
  FOR rec IN
    SELECT t.id, t.config
      FROM form_config t
     WHERE t.version = (
       SELECT max(t2.version)
         FROM form_config t2
        WHERE t2.organization_id = t.organization_id
     )
  LOOP
    -- Pass 1: detect the two name fields and their required flags.
    has_first := false;
    has_last := false;
    first_required := false;
    last_required := false;

    FOR section IN SELECT * FROM jsonb_array_elements(rec.config->'sections') LOOP
      FOR field IN SELECT * FROM jsonb_array_elements(section->'fields') LOOP
        IF field->>'maps_to' = 'contact.first_name' THEN
          has_first := true;
          first_required := coalesce((field->>'required')::boolean, false);
        ELSIF field->>'maps_to' = 'contact.last_name' THEN
          has_last := true;
          last_required := coalesce((field->>'required')::boolean, false);
        END IF;
      END LOOP;
    END LOOP;

    -- Already collapsed (or never had the name fields) — skip.
    CONTINUE WHEN NOT has_first AND NOT has_last;

    -- Pass 2: rebuild sections, collapsing the anchor field in place and
    -- dropping the other name field.
    new_sections := '[]'::jsonb;

    FOR section IN SELECT * FROM jsonb_array_elements(rec.config->'sections') LOOP
      new_fields := '[]'::jsonb;
      FOR field IN SELECT * FROM jsonb_array_elements(section->'fields') LOOP
        IF field->>'maps_to' = 'contact.first_name'
           OR (field->>'maps_to' = 'contact.last_name' AND NOT has_first) THEN
          -- Anchor field → collapsed "Full Name" field (keeps id + flags).
          collapsed := field || jsonb_build_object(
            'type', 'text',
            'label', 'Full Name',
            'maps_to', 'contact.full_name',
            'required', (first_required OR last_required),
            'merge_field_slug', 'customer_name'
          );
          new_fields := new_fields || jsonb_build_array(collapsed);
        ELSIF field->>'maps_to' = 'contact.last_name' THEN
          -- Non-anchor last-name field → dropped.
          CONTINUE;
        ELSE
          new_fields := new_fields || jsonb_build_array(field);
        END IF;
      END LOOP;
      new_sections := new_sections || jsonb_build_array(
        jsonb_set(section, '{fields}', new_fields)
      );
    END LOOP;

    UPDATE form_config
       SET config = jsonb_set(rec.config, '{sections}', new_sections),
           updated_at = now()
     WHERE id = rec.id;
  END LOOP;
END $$;

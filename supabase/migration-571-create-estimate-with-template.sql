-- Issue #571 — create_estimate_with_template: one RPC that creates a draft
-- estimate (default-title resolution + atomic numbering), optionally applies
-- a template (line-item snapshot per ADR 0004, which recomputes totals), and
-- returns the new estimate id. Replaces the create-and-redirect page's
-- multi-query TypeScript composition with a single transaction.
--
-- Idempotent: plain CREATE OR REPLACE FUNCTION; re-running installs the same body.

CREATE OR REPLACE FUNCTION public.create_estimate_with_template(
  p_job_id uuid,
  p_title text DEFAULT NULL,
  p_template_id uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org_id      uuid;
  v_title       text;
  v_number      text;
  v_seq         integer;
  v_estimate_id uuid;
BEGIN
  -- The job anchors everything: it scopes the org, and RLS scopes it to the
  -- caller when invoked as `authenticated` via PostgREST.
  SELECT organization_id INTO v_org_id FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Title: explicit (from the modal) > the org's standard title
  -- (company_settings) > the hard fallback. Blank counts as unset at every
  -- rung, mirroring the old create page's `(setting?.value) || "Estimate"`.
  v_title := NULLIF(btrim(COALESCE(p_title, '')), '');
  IF v_title IS NULL THEN
    SELECT NULLIF(btrim(COALESCE(value, '')), '') INTO v_title
      FROM company_settings
     WHERE organization_id = v_org_id AND key = 'default_estimate_title';
  END IF;
  v_title := COALESCE(v_title, 'Estimate');

  SELECT t.estimate_number, t.sequence_number
    INTO v_number, v_seq
    FROM generate_estimate_number(p_job_id) t;

  INSERT INTO estimates (
    organization_id, job_id, estimate_number, sequence_number, title, status, created_by
  ) VALUES (
    v_org_id, p_job_id, v_number, v_seq, v_title, 'draft', auth.uid()
  )
  RETURNING id INTO v_estimate_id;

  -- Template leg: delegate to apply_template_to_estimate (#382b), which
  -- copies the snapshot sections/items + statements and recomputes totals.
  -- Any guard it raises aborts the whole call — the draft above rolls back.
  IF p_template_id IS NOT NULL THEN
    PERFORM apply_template_to_estimate(v_estimate_id, p_template_id);
  END IF;

  RETURN v_estimate_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_estimate_with_template(uuid, text, uuid) TO authenticated;

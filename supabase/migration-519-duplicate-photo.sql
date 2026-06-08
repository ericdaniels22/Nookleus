-- Issue #519 — Duplicate (clean same-Job copy).
--
-- `duplicate_photo` is the deep module behind the viewer's Duplicate ⋯ More
-- action: it makes a fresh Photo row from a source, in the SAME Job. The
-- endpoint copies the clean ORIGINAL blob in Storage (never the drawings) to a
-- new path and hands that path in; this function writes the new row and
-- re-links the source's tags. Caption and Before/After (role + pairing) carry
-- over; the duplicate is a clean original, so it never inherits the annotation
-- render. Returns the new row so the endpoint can answer with it.

CREATE OR REPLACE FUNCTION public.duplicate_photo(
  p_source_photo_id uuid,
  p_new_storage_path text
)
 RETURNS photos
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_src photos%ROWTYPE;
  v_new photos%ROWTYPE;
BEGIN
  SELECT * INTO v_src FROM photos WHERE id = p_source_photo_id;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- annotated_path is omitted on purpose: the duplicate is a clean original,
  -- so it never inherits the source's annotation render. client_capture_id is
  -- omitted too — it is a per-capture idempotency key, and a duplicate is not a
  -- fresh capture. created_at defaults to now() so the copy sorts to the top of
  -- the Job's grid (ordered by created_at DESC).
  INSERT INTO photos (
    job_id, organization_id, storage_path, caption,
    before_after_role, before_after_pair_id,
    media_type, file_size, width, height, taken_by, taken_at
  )
  VALUES (
    v_src.job_id, v_src.organization_id, p_new_storage_path, v_src.caption,
    v_src.before_after_role, v_src.before_after_pair_id,
    v_src.media_type, v_src.file_size, v_src.width, v_src.height,
    v_src.taken_by, v_src.taken_at
  )
  RETURNING * INTO v_new;

  -- Re-apply the source's tags to the copy (same tag + org, new photo).
  INSERT INTO photo_tag_assignments (organization_id, photo_id, tag_id)
  SELECT organization_id, v_new.id, tag_id
    FROM photo_tag_assignments
   WHERE photo_id = v_src.id;

  RETURN v_new;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.duplicate_photo(uuid, text) TO authenticated;

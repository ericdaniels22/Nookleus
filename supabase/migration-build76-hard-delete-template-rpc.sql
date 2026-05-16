-- build76 (issue #76): add `hard_delete_contract_template(p_template_id uuid,
-- p_org_id uuid)` RPC.
--
-- Backs the new DELETE /api/settings/contract-templates/[id]/permanent route.
-- Permanently removes a contract template that an org admin no longer needs.
--
-- This RPC is the *authoritative* eligibility gate. The route runs an
-- advisory pre-check (the GET …/usage endpoint + the pure
-- `evaluateTemplateDeletion` module) to drive the confirm/block dialog, but
-- the RPC re-checks at delete time inside the transaction so a contract that
-- flips to `sent` between the dialog opening and the confirm cannot slip
-- through.
--
-- Eligibility rule (mirror of src/lib/contracts/template-deletion-eligibility.ts):
--   * `sent` / `viewed` referencing contract  -> BLOCK (RAISE).
--   * `draft` referencing contract            -> cascade-deleted here.
--   * `signed` / `expired` / `voided`         -> retained; the FK
--       contracts_template_id_fkey ON DELETE SET NULL (build76 FK migration)
--       nulls their template_id when the template row is deleted.
--
-- Cascade semantics from build33 / build68a:
--   contract_signers.contract_id -> ON DELETE CASCADE
--   contract_events.contract_id  -> ON DELETE CASCADE
-- so deleting a draft contract removes its signers + events in one statement.
-- No contract_events are written for the deleted drafts — by definition the
-- event log goes away with the contract (matches delete_contract / build68a).
--
-- The blocked path RAISEs with the recognizable token `template_delete_blocked`
-- in the message; the route handler matches that token to return HTTP 409
-- (anything else is a 500). The whole function runs in one transaction, so a
-- RAISE aborts before any draft is deleted.
--
-- p_org_id scopes both the template load and the final delete: a caller can
-- never delete a template outside its own organization. Referencing contracts
-- are matched by template_id alone — a contract always shares its template's
-- organization, so no separate org filter is needed on the contracts side.

CREATE OR REPLACE FUNCTION public.hard_delete_contract_template(
  p_template_id uuid,
  p_org_id uuid
)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_template_id uuid;
  v_blockers integer;
BEGIN
  SELECT id INTO v_template_id
    FROM public.contract_templates
    WHERE id = p_template_id AND organization_id = p_org_id;
  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'hard_delete_contract_template: template % not found in organization %', p_template_id, p_org_id;
  END IF;

  -- Authoritative re-check: refuse the delete while a customer is mid-signing.
  SELECT count(*) INTO v_blockers
    FROM public.contracts
    WHERE template_id = p_template_id
      AND status IN ('sent', 'viewed');
  IF v_blockers > 0 THEN
    RAISE EXCEPTION 'template_delete_blocked: % contract(s) referencing template % are still awaiting signature', v_blockers, p_template_id;
  END IF;

  -- Unsent drafts cascade-delete with the template (their signers + events
  -- go via the build33 ON DELETE CASCADE foreign keys).
  DELETE FROM public.contracts
    WHERE template_id = p_template_id
      AND status = 'draft';

  -- Delete the template row. The FK ON DELETE SET NULL nulls template_id on
  -- the surviving terminal (signed / expired / voided) contracts.
  DELETE FROM public.contract_templates
    WHERE id = p_template_id AND organization_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hard_delete_contract_template: template % vanished mid-delete', p_template_id;
  END IF;
END;
$function$;

-- ROLLBACK ---
-- DROP FUNCTION public.hard_delete_contract_template(uuid, uuid);

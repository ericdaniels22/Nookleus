-- build68a: add `delete_contract(p_contract_id uuid)` RPC.
--
-- Backs the new DELETE /api/contracts/[id] route landed in slice #61 of
-- the void / restore / permanently-delete lifecycle (issue #58 / #61).
-- A draft contract is a failed-send leftover — the row was created, the
-- confirmation email blew up, the contract never reached a customer. The
-- old "discard draft" flow routed drafts through `void_contract`, which
-- left a permanent crossed-out tombstone in the UI for a contract nobody
-- ever saw. The new behavior is a one-click hard-delete.
--
-- Cascade semantics already exist from build33:
--   contract_signers.contract_id  -> ON DELETE CASCADE
--   contract_events.contract_id   -> ON DELETE CASCADE
-- so a single transactional DELETE on `contracts` removes the row and
-- both its child collections in one statement, in one transaction.
--
-- The function captures job_id BEFORE the delete (otherwise the row is
-- gone by the time we'd compute it) and recomputes the owning job's
-- `has_pending_contract` flag afterwards — matching the convention used
-- by void_contract / mark_contract_sent / mark_contract_expired.
--
-- No organization_id parameter: the function operates on a single
-- contract by id, and the caller (service-role API route) does its own
-- auth check before invoking. There is no INSERT into contract_events
-- here — by definition the event log goes away with the contract — so
-- the build45/build59 tenant-isolation guards do not apply.

CREATE OR REPLACE FUNCTION public.delete_contract(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_job_id uuid;
BEGIN
  SELECT job_id INTO v_job_id FROM public.contracts WHERE id = p_contract_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'delete_contract: contract % not found', p_contract_id;
  END IF;

  DELETE FROM public.contracts WHERE id = p_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_contract: contract % vanished mid-delete', p_contract_id;
  END IF;

  UPDATE public.jobs
    SET has_pending_contract = EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.job_id = v_job_id
        AND c.status IN ('sent', 'viewed')
    )
    WHERE id = v_job_id;
END;
$function$;

-- ROLLBACK ---
-- DROP FUNCTION public.delete_contract(uuid);

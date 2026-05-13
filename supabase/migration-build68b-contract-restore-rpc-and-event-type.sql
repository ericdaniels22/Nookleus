-- build68b: add `restore_contract(p_contract_id uuid, p_restored_by uuid)`
-- RPC + extend contract_events.event_type CHECK to accept 'restored'.
--
-- Backs the new POST /api/contracts/[id]/restore route landed in slice
-- #62 of the void / restore / permanently-delete lifecycle (issue #58 /
-- #62). The route un-voids a contract back to the lifecycle status
-- implied by its existing timestamps (signed_at → 'signed', else
-- first_viewed_at → 'viewed', else sent_at → 'sent', else 'draft'). The
-- target-status derivation lives in two places by design: the
-- application-side pure function `computeRestoreTargetStatus` (used by
-- tests + future UI optimism) and this RPC body — both must stay in sync.
--
-- The contract_events.event_type CHECK constraint must accept 'restored'
-- before the new RPC can insert that event variant. The constraint name
-- is the inline auto-name from build33 (`contract_events_event_type_check`).
-- The live constraint already includes a superset of values beyond what
-- the build33 source file shows — paid/payment_failed/refunded/etc. were
-- added by later migrations. This migration preserves every existing
-- value and adds 'restored'.
--
-- No payment-block check on restore — restore is the opposite of
-- destruction.
--
-- Pattern mirrors build59's void_contract style:
--   * DECLARE v_org + RAISE-on-missing guard
--   * UPDATE WHERE status = 'voided' RETURNING job_id (RAISE if not found)
--   * Clear voided_at / voided_by / void_reason on the contracts row
--     (audit trail stays in contract_events; the row represents current
--     state, not history)
--   * INSERT contract_events with organization_id + v_org for tenant
--     isolation, metadata captures restored_by + target_status
--   * Recompute jobs.has_pending_contract

ALTER TABLE public.contract_events
  DROP CONSTRAINT IF EXISTS contract_events_event_type_check;

ALTER TABLE public.contract_events
  ADD CONSTRAINT contract_events_event_type_check
    CHECK (event_type IN (
      'created',
      'sent',
      'email_delivered',
      'email_opened',
      'link_viewed',
      'signed',
      'reminder_sent',
      'voided',
      'restored',
      'expired',
      'paid',
      'payment_failed',
      'refunded',
      'partially_refunded',
      'dispute_opened',
      'dispute_closed',
      'estimate_sent',
      'invoice_sent',
      'estimate_trashed',
      'estimate_restored',
      'estimate_purged',
      'invoice_trashed',
      'invoice_restored',
      'invoice_purged'
    ));

CREATE OR REPLACE FUNCTION public.restore_contract(p_contract_id uuid, p_restored_by uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org uuid;
  v_job_id uuid;
  v_signed_at timestamptz;
  v_first_viewed_at timestamptz;
  v_sent_at timestamptz;
  v_target text;
BEGIN
  SELECT organization_id, job_id, signed_at, first_viewed_at, sent_at
    INTO v_org, v_job_id, v_signed_at, v_first_viewed_at, v_sent_at
    FROM public.contracts
    WHERE id = p_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'restore_contract: contract % not found or missing organization_id', p_contract_id;
  END IF;

  -- Derive target lifecycle status from timestamp precedence.
  -- Mirror of src/lib/contracts/restore-target-status.ts.
  IF v_signed_at IS NOT NULL THEN
    v_target := 'signed';
  ELSIF v_first_viewed_at IS NOT NULL THEN
    v_target := 'viewed';
  ELSIF v_sent_at IS NOT NULL THEN
    v_target := 'sent';
  ELSE
    v_target := 'draft';
  END IF;

  UPDATE public.contracts
    SET status = v_target,
        voided_at = NULL,
        voided_by = NULL,
        void_reason = NULL
    WHERE id = p_contract_id AND status = 'voided';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_contract: contract % is not voided', p_contract_id;
  END IF;

  INSERT INTO public.contract_events (organization_id, contract_id, event_type, metadata)
  VALUES (
    v_org,
    p_contract_id,
    'restored',
    jsonb_build_object(
      'restored_by', p_restored_by,
      'target_status', v_target
    )
  );

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
-- DROP FUNCTION public.restore_contract(uuid, uuid);
--
-- ALTER TABLE public.contract_events
--   DROP CONSTRAINT IF EXISTS contract_events_event_type_check;
--
-- ALTER TABLE public.contract_events
--   ADD CONSTRAINT contract_events_event_type_check
--     CHECK (event_type IN (
--       'created', 'sent', 'email_delivered', 'email_opened',
--       'link_viewed', 'signed', 'reminder_sent', 'voided', 'expired',
--       'paid', 'payment_failed', 'refunded', 'partially_refunded',
--       'dispute_opened', 'dispute_closed',
--       'estimate_sent', 'invoice_sent',
--       'estimate_trashed', 'estimate_restored', 'estimate_purged',
--       'invoice_trashed', 'invoice_restored', 'invoice_purged'
--     ));

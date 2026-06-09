-- ============================================
-- Build 80 Migration: #567 — Simplify Estimate status
--
-- Realigns the estimates table with ADR 0007: the Estimate workflow is exactly
--   draft → sent → converted / voided
-- The retired `approved` / `rejected` states are dropped end-to-end. Build 67f
-- already removed the `estimate_not_approved` gate from
-- convert_estimate_to_invoice, so no live code produces those states anymore;
-- this migration remaps any rows that still carry them and then tightens the
-- status CHECK constraint so they can never reappear.
--
-- Remap rules (NEVER → converted — that must mean an Invoice was actually
-- created via convert_estimate_to_invoice):
--   approved → sent    (the estimate was sent; "approved" was just an ack)
--   rejected → voided  (a dead estimate; voided is its terminal state)
--
-- The `approved_at` / `rejected_at` columns are intentionally KEPT (nullable)
-- rather than dropped: they are simply no longer written. Dropping them would
-- churn live data and several PDF/test fixtures for no functional gain.
--
-- Deploy ordering: run this SQL BEFORE (or together with) the deploy that
-- narrows the EstimateStatus TypeScript union, so no remapped row is read by
-- code that no longer knows the old states. All statements are idempotent.
--
-- Run in Supabase SQL Editor.
-- ============================================

-- 1. Remap live rows while the OLD constraint still permits both endpoints.
--    Backfill the timestamp/reason a normal transition would have set so the
--    remapped rows are internally consistent with naturally-reached states.
--    (`updated_at` is bumped by the BEFORE UPDATE trigger.)

-- approved → sent: keep the existing sent_at; fall back to approved_at.
UPDATE estimates
   SET status  = 'sent',
       sent_at = COALESCE(sent_at, approved_at)
 WHERE status = 'approved';

-- rejected → voided: a voided estimate carries voided_at + void_reason.
UPDATE estimates
   SET status      = 'voided',
       voided_at   = COALESCE(voided_at, rejected_at, now()),
       void_reason = COALESCE(void_reason, 'Migrated from rejected (build80 / #567)')
 WHERE status = 'rejected';

-- 2. Tighten the status CHECK to the four surviving states. The original
--    constraint was the inline (auto-named) one from build67a.
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_status_check;
ALTER TABLE estimates ADD CONSTRAINT estimates_status_check
  CHECK (status IN ('draft', 'sent', 'converted', 'voided'));

-- ============================================
-- End of build80 migration.
-- ============================================

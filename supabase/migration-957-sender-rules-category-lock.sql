-- ============================================
-- Issue #957 Migration: move-to-bucket category lock
-- Run this in the Supabase SQL Editor
-- ============================================
--
-- Move-to-bucket (#957) lets a user file an email into any bucket, and — via a
-- one-tap "always file this sender here" — teach a Sender rule (a
-- `category_rules` row with match_type='sender_address') that re-files that
-- sender's existing mail and catches future mail through the classifier's
-- first-match precedence. No schema change is needed for the Sender rule
-- itself: it rides the existing org-scoped `category_rules` table.
--
-- What this migration adds is the "a manual move always wins" guarantee. A
-- moved email is locked so it never snaps back:
--   * the one-time per-account backfill (sync route, Pass 1 + Pass 2) skips
--     category_locked mail, so a future backfill reset (as #954 did) can't
--     reclassify an email the user moved into General;
--   * the Sender-rule re-file skips category_locked mail, so teaching a rule
--     never clobbers a different manual move for the same sender.
--
-- Additive and safe to re-run: NOT NULL DEFAULT false backfills every existing
-- row to "unlocked", matching today's behavior.

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS category_locked boolean NOT NULL DEFAULT false;

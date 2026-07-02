-- ============================================
-- Issue #954 Migration: Jobs bucket claim-signal re-backfill
-- Run this in the Supabase SQL Editor
-- ============================================
--
-- The `category` column is free text (no CHECK/enum), so adding the new
-- "jobs" bucket needs no column change — the classifier now emits "jobs"
-- for claim-looking mail (carrier/adjuster senders, claim-number patterns)
-- and for job-linked mail. This migration only re-triggers the one-time
-- per-account backfill so existing inboxes are re-filed through the
-- now-claim-aware classifier.
--
-- Reset the backfill flag on all accounts so the next sync re-runs the
-- backfill. It only touches emails still categorized as 'general'
-- (the filing fallback) — mail already sorted into promotions/social/
-- purchases by explicit rules is left untouched, preserving
-- rules-beat-heuristics. Existing job-linked mail and claim-looking mail
-- currently in 'general' move to 'jobs'.

UPDATE email_accounts SET category_backfill_completed_at = NULL;

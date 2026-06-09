-- ============================================
-- Build 82 Migration: #575 — Overhead & Profit on Invoices
--
-- Carries the build81 (#572) Markup split onto invoices: two independent
-- uplifts — Overhead and Profit ("10 & 10") — each applied on top of the RAW
-- Subtotal. Together they form the Markup: markup_amount = overhead_amount +
-- profit_amount.
--
-- Adds two new percent/value/amount triplets mirroring the existing
-- markup/discount triplets from build67a. The legacy markup_type/markup_value
-- columns are KEPT (NOT NULL, default none/0) but become write-dead — no live
-- code writes them after this build; the PUT route and the shared pricing
-- waterfall (#566) drive markup_amount from the two new legs instead.
--
-- markup_amount itself is retained and still maintained (= overhead + profit)
-- so every existing reader of markup_amount stays correct.
--
-- Companion: migration-build82b reworks convert_estimate_to_invoice to copy
-- the estimate's Overhead/Profit onto the new columns.
--
-- Deploy ordering: run this SQL BEFORE (or together with) the deploy that
-- starts reading/writing the overhead/profit columns. All statements are
-- idempotent.
--
-- Run in Supabase SQL Editor.
-- ============================================

-- 1. Add the Overhead + Profit triplets, mirroring the build67a markup triplet
--    (NOT NULL, default none/0/0, type CHECK). IF NOT EXISTS keeps re-runs safe.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS overhead_type text NOT NULL DEFAULT 'none'
    CHECK (overhead_type IN ('percent','amount','none')),
  ADD COLUMN IF NOT EXISTS overhead_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overhead_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_type text NOT NULL DEFAULT 'none'
    CHECK (profit_type IN ('percent','amount','none')),
  ADD COLUMN IF NOT EXISTS profit_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_amount numeric(10,2) NOT NULL DEFAULT 0;

-- 2. Backfill: carry any existing Markup onto the Overhead leg (Profit stays
--    none/0). markup_amount already equals overhead_amount after this (profit
--    is 0), so every downstream total is unchanged.
--
--    The `overhead_* = default` guard makes this idempotent AND safe: a second
--    run (or a run after the app has begun editing overhead) only touches rows
--    still at the freshly-added defaults, so it can never clobber an overhead
--    value set through the new API.
UPDATE invoices
   SET overhead_type   = markup_type,
       overhead_value  = markup_value,
       overhead_amount = markup_amount
 WHERE (markup_type <> 'none' OR markup_value <> 0 OR markup_amount <> 0)
   AND overhead_type = 'none'
   AND overhead_value = 0
   AND overhead_amount = 0;

-- ============================================
-- End of build82 migration.
-- ============================================

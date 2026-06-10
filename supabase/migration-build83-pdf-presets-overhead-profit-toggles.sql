-- ============================================
-- Build 83 Migration: #576 — Overhead & Profit on the customer PDF
--
-- The #572 markup split (Overhead + Profit, migration build81) gets its own
-- show/hide toggles on the customer-facing PDF, parallel to
-- show_markup/show_discount/show_tax. This adds the two toggle columns to
-- pdf_presets; the per-document side needs no DDL — a document's layout is a
-- JSON snapshot in its pdf_layout column (ADR 0012), and the app writes the
-- complete eleven-boolean shape there.
--
-- DEFAULT false is the point: existing presets (and the spec defaults for new
-- ones) keep rendering exactly as before — no legacy document or zero-amount
-- uplift sprouts a new totals row until someone turns it on.
--
-- Scope: both document types. #575 (migration build82) carried the same
-- overhead/profit triplets onto invoices so a converted Invoice prices exactly
-- as its Estimate did — the toggles apply to estimate and invoice presets alike.
--
-- Deploy ordering: run this SQL BEFORE (or together with) the deploy that
-- reads/writes the columns — resolveEffectiveLayout reads them off every
-- preset row. All statements are idempotent.
--
-- Run in Supabase SQL Editor.
-- ============================================

ALTER TABLE pdf_presets
  ADD COLUMN IF NOT EXISTS show_overhead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_profit boolean NOT NULL DEFAULT false;

-- ============================================
-- End of build83 migration.
-- ============================================

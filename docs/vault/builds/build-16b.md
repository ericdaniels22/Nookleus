---
build_id: 16b
title: Accounting dashboard
status: shipped
phase: accounting
started: null
shipped: 2026-04-19
guide_doc: "v1.6 §Build 16"
handoff: null
related: ["[[build-16a]]", "[[build-16c]]", "[[build-16d]]"]
---

#status/shipped #area/accounting #build/16b

## What shipped

`/accounting` dashboard with revenue/expense/margin stat cards, AR aging buckets, profitability per job, by-damage-type breakdown (Chart.js), CSV/ZIP export.

- **Migration:** [supabase/migration-build36-accounting.sql](../../../supabase/migration-build36-accounting.sql) — accounting columns on jobs, `view_accounting` permission, `payer_type` trigger.
- **Routes:** `/accounting`, `/api/accounting/summary`, `/api/accounting/profitability`, `/api/accounting/ar-aging`, `/api/accounting/expenses`, `/api/accounting/damage-type`, `/api/accounting/export/[type]`.
- **Job-detail:** Financials tab (relocates Billing + Expenses from Overview); payer_type badge; estimated crew labor cost row.
- Helpers: [src/components/accounting/](../../../src/components/accounting/), shared `requireViewAccounting` auth helper.
- Libraries added: `chart.js`, `react-chartjs-2`, `jszip`.

## Source

- Commit range: `6b53e1b` (spec) → `6640084` (final fix split)
- Migration: [supabase/migration-build36-accounting.sql](../../../supabase/migration-build36-accounting.sql)
- Guide: v1.6 §Build 16

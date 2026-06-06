---
build_id: 16a
title: Expenses, vendors & receipt capture
status: shipped
phase: accounting
started: null
shipped: 2026-04-18
guide_doc: "v1.6 §Build 16 (summary of v1.5)"
handoff: null
related: ["[[build-16b]]", "[[build-16c]]", "[[build-16d]]"]
---

#status/shipped #area/accounting #build/16a

## What shipped

Per-job expense logging with vendor catalog and receipt photo capture (compressed client-side).

- **Migration:** [supabase/migration-build35-expenses.sql](../../../supabase/migration-build35-expenses.sql) — `expenses`, `vendors`, `expense_categories`, `log_expenses` permission.
- **Routes:** `/settings/vendors`, `/settings/vendors/[id]`, `/settings/expense-categories`, `/api/expenses`, `/api/expenses/[id]`, `/api/expenses/[id]/receipt-url`, `/api/expenses/[id]/thumbnail-url`, `/api/expenses/by-job/[jobId]`, `/api/expenses/by-activity/[activityId]`, `/api/settings/vendors`, `/api/settings/expense-categories`.
- **Components:** vendor autocomplete, log expense modal, receipt detail modal, expenses section in job-detail.

## Source

- Commit range: `23a7701` (spec) → `18c68e5` (final fix), through PR #14
- Migration: [supabase/migration-build35-expenses.sql](../../../supabase/migration-build35-expenses.sql)
- Guide: v1.6 §Build 16 (v1.5 referenced; not in repo)

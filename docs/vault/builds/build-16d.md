---
build_id: 16d
title: Invoice + payment sync (QuickBooks)
status: shipped
phase: accounting
started: null
shipped: 2026-04-19
guide_doc: "v1.6 §Build 16"
handoff: null
related: ["[[build-16b]]", "[[build-16c]]", "[[build-17a]]", "[[build-17c]]"]
---

#status/shipped #area/accounting #area/quickbooks #area/invoices #build/16d

## What shipped

Invoices, manual payments, and bidirectional sync to QuickBooks. Invoice PDF generation, send/mark-sent/void flow, record-payment modal, sync-log admin UI, pre-launch checklist. Stripe webhook stub planted for [[build-17a]].

- **Migration:** [supabase/migration-build38-invoice-payment-sync.sql](../../../supabase/migration-build38-invoice-payment-sync.sql) — `invoices`, `payments`, invoice/payment columns, triggers, `invoice_email_settings`.
- **Routes:** `/invoices`, `/invoices/new`, `/invoices/[id]`, `/settings/invoices`, `/api/invoices`, `/api/invoices/[id]`, `/api/invoices/[id]/mark-sent`, `/api/invoices/[id]/pdf`, `/api/invoices/[id]/send`, `/api/invoices/[id]/void`, `/api/payments`, `/api/payments/[id]`, `/accounting/sync-log`, `/api/settings/invoice-email`.
- **Sync engine:** advisory-lock processor; invoice/payment/void modules with backoff; manual mark-synced + extended Fix modal (deposit/auth/duplicate classifications).
- **Stripe webhook stub:** signature verification + logging only — actual handler shipped in [[build-17a]]/[[build-17c]].

## Source

- Commit range: `d2975fb` (migration) → `70be0b3` (cents fix), through PR #18
- Migration: [supabase/migration-build38-invoice-payment-sync.sql](../../../supabase/migration-build38-invoice-payment-sync.sql)
- Guide: v1.6 §Build 16

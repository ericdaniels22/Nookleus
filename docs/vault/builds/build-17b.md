---
build_id: 17b
title: Public /pay page + payment emails
status: shipped
phase: payments
started: null
shipped: 2026-04-20
guide_doc: "v1.7 §Build 17"
handoff: null
related: ["[[build-17a]]", "[[build-17c]]"]
---

#status/shipped #area/payments #area/stripe #area/email #build/17b

## What shipped

Customer-facing `/pay/[token]` page with method selector (card vs ACH), success page, session reuse/regenerate. Branded payment-request email (Resend) with merge-fields, send-history badges, configurable per-org payment-email template.

- **Migration:** [supabase/migration-build40-payment-emails.sql](../../../supabase/migration-build40-payment-emails.sql) — `payment_email_settings`; relax `contract_events.contract_id`.
- **Routes:** `/pay/[token]`, `/pay/[token]/success`, `/settings/payments`, `/api/pay/[token]`, `/api/pay/[token]/checkout`, `/api/payment-requests/[id]/send`, `/api/settings/payment-email`.
- **Library added:** `resend`.

## Source

- Commit range: `362da6b` (migration) → `0a84f32` (AppShell /pay public-route bypass), through PR #20 + hotfix PR #21
- Migration: [supabase/migration-build40-payment-emails.sql](../../../supabase/migration-build40-payment-emails.sql)
- Guide: v1.7 §Build 17

---
build_id: 17c
title: Stripe webhook + receipts/refunds + QB bridge
status: shipped
phase: payments
started: null
shipped: 2026-04-21
guide_doc: "v1.7 §Build 17"
handoff: null
related: ["[[build-17a]]", "[[build-17b]]", "[[build-16c]]", "[[build-14g]]"]
---

#status/shipped #area/payments #area/stripe #area/quickbooks #build/17c

## What shipped

Full Stripe webhook handler, branded PDF receipts, refund flow, dispute tracking, in-app notifications fanout, and the Stripe→QuickBooks bridge (standalone deposits + Stripe fee posting).

- **Migration:** [supabase/migration-build41-webhook-receipts-refunds.sql](../../../supabase/migration-build41-webhook-receipts-refunds.sql) — webhook CHECKs, payments/payment_requests columns, `refunds`, `disputes`, extended `notifications`, template seeds.
- **Routes:** `/api/stripe/webhook`, `/api/stripe/webhook-secret`, `/api/payment-requests/[id]/refund`, `/api/payment-requests/[id]/refundable`, `/api/payment-requests/[id]/receipt-url`, `/api/payments/[id]/retry-qb-sync`.
- **Webhook handlers:** `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Idempotency via `stripe_events` (claim/markProcessed/releaseEvent helpers).
- **Branded receipts:** [pdf-lib](https://www.npmjs.com/package/pdf-lib) generator; suppresses Stripe's default customer receipt; Resend email with PDF attachment; non-WinAnsi text sanitization.
- **QB bridge:** standalone deposits, Stripe fee account posting; widened `qb_mappings.type` CHECK; manual retry endpoint.
- **Notifications unified** with legacy [[build-14g]] schema; admin fan-out for payment events.
- **Settings:** `/settings/stripe` webhook secret UI; `/settings/payments` editors for receipt/refund/internal templates.

## Source

- Commit range: `eb64bb9` (migration) → `cc50bec` (E2E hardening) → `f97bdf5` (receipt_email fix)
- Migration: [supabase/migration-build41-webhook-receipts-refunds.sql](../../../supabase/migration-build41-webhook-receipts-refunds.sql)
- Guide: v1.7 §Build 17

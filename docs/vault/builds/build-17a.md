---
build_id: 17a
title: Stripe Connect + payment requests
status: shipped
phase: payments
started: null
shipped: 2026-04-20
guide_doc: "v1.7 §Build 17"
handoff: null
related: ["[[build-17b]]", "[[build-17c]]", "[[build-16d]]"]
---

#status/shipped #area/payments #area/stripe #build/17a

## What shipped

Stripe Connect (Standard) flow: connect/disconnect, signed OAuth state, settings (payment methods, surcharge, ACH threshold). Payment requests via Checkout Sessions with token-based public access; deposit + invoice request modal; encrypted Stripe secret loading.

- **Migration:** [supabase/migration-build39-stripe-payments.sql](../../../supabase/migration-build39-stripe-payments.sql) — `stripe_connection`, `payment_requests`, `stripe_events` (idempotency, partial index for unprocessed); invoice/job flags.
- **Routes:** `/settings/stripe`, `/api/stripe/connect/start`, `/api/stripe/connect/callback`, `/api/stripe/disconnect`, `/api/stripe/settings`, `/api/payment-requests`, `/api/payment-requests/[id]`, `/api/payment-requests/[id]/void`.
- **Helpers:** Stripe client wrapper, signed OAuth state helper, payment-link JWT helper (reuses `SIGNING_LINK_SECRET` from contracts).
- Libraries added: `stripe`, `@stripe/stripe-js`.

## Source

- Commit range: `86fa608` (install) → `e627939` (settings polish), through PR #19
- Migration: [supabase/migration-build39-stripe-payments.sql](../../../supabase/migration-build39-stripe-payments.sql)
- Guide: v1.7 §Build 17

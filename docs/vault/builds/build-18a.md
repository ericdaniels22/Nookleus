---
build_id: 18a
title: Multi-tenant schema + backfill
status: shipped
phase: multi-tenant
started: null
shipped: 2026-04-22
guide_doc: null
plan_file: docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md
handoff: null
related: ["[[build-18b]]", "[[build-18c]]", "[[build-64]]", "[[2026-04-22-build52-null-tokens-lesson]]"]
---

#status/shipped #area/multi-tenant #build/18a

## What shipped

The multi-tenant schema refactor: organizations + memberships + per-org `organization_id` columns on every business table, with backfill, RLS policies (written but not yet enforced — that's [[build-18b]]), and a code sweep to thread `organization_id` through all writers.

Shipped over **9 migrations** — build42 through build50 — with three follow-on fixes (build51, build52, build53, build54).

- **Schema migrations (build42–build50):**
  - build42 — `organizations`, `user_organizations` (memberships + role), `nookleus` schema (`active_organization_id` from JWT). Seeds AAA + Test Company.
  - build43 — nullable `organization_id` columns on every business table.
  - build44 — backfill `organization_id` to AAA across existing data.
  - build45 — set `organization_id NOT NULL` + add foreign keys.
  - build46 — rework unique indexes to be per-org.
  - build47 — per-org number generator (jobs, invoices, contracts) replacing the global yearly sequence.
  - build48 — migrate `user_permissions` and per-user preferences into the new model. Rewrites `handle_new_user()` and `set_default_permissions()`.
  - build49 — RLS policies written but **not enforced** (transitional `permissive` mode).
  - build50 — storage migration tracking (per-org bucket prefix migration).
- **Follow-on fixes:**
  - build51 — PostgREST embedding fix on `user_organizations` FK.
  - build52 — backfill empty strings into `auth.users` token columns to fix GoTrue NULL panic. See [[2026-04-22-build52-null-tokens-lesson]].
  - build53 — transitional allow policies (cover the gap until 18b enforces real RLS).
  - build54 — patch the `qb_mappings` trigger to set `organization_id`.
- **Code sweep:** central helpers (`getActiveOrganizationId`, etc.); auth/permissions sweep; settings routes + reminders + company logo; contracts, email sync/accounts, photos, audit; core INSERTs + Stripe metadata + webhook org resolution; public routes scope `company_settings` to contract/request org; job-detail, reports, photo annotations, activity timeline; email send/drafts, record-payment, jarvis tools; marketing, job-files, contract-templates, intake form.

## Source

- Plan: [docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md](../../../docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md), [docs/superpowers/plans/build-18a-briefing.md](../../../docs/superpowers/plans/build-18a-briefing.md)
- Handoffs (older paths, pre-vault): [docs/build-18a-handoff.md](../../../docs/build-18a-handoff.md), [docs/build-18a-complete-handoff.md](../../../docs/build-18a-complete-handoff.md)
- Migration files: build42–build50, plus build51, build52, build53, build54
- Commit range: `d64f17d` (briefing/prompts) → `1b4004c` (Build 18a complete) → `c19278a` (build53/54 fixes)
- Guide: none (post-Build 17)

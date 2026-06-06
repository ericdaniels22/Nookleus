---
build_id: 18c
title: Workspace switcher + multi-tenant polish
status: shipped
phase: multi-tenant
started: null
shipped: 2026-04-26
guide_doc: null
handoff: null
related: ["[[build-18a]]", "[[build-18b]]", "[[build-64]]"]
---

#status/shipped #area/multi-tenant #build/18c

## What shipped

The workspace switcher UI for users with memberships in multiple orgs, plus public-route org resolution polish and SSR client fixes.

- **Migrations:**
  - build62 — `is_active` flag on `user_organizations` (one active per user).
  - build62b — `set_active_organization()` RPC that swaps the active flag and refreshes the JWT claim.
  - build63 — `user_profiles` SELECT policy fix (admins reading other users' profiles).
- **Code:** [src/components/workspace-switcher.tsx](../../../src/components/workspace-switcher.tsx) (moved into sidebar by `96ba027`); RLS-broken API routes fixed to use cookie-aware SSR client (`90d7405`); public-route audit.
- **Public route audit** surfaced [[build-64]] (missing `handle_new_user` trigger) as a follow-on.

## Source

- Migration files: build62, build62b, build63
- Commit range: `c84f652` (plan) → `dcf4127` (merge) → `90d7405` (SSR fix) → `9e986b2` (PR #39 JWT decode)
- Guide: none

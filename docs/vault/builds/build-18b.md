---
build_id: 18b
title: RLS enforcement + custom access token hook
status: shipped
phase: multi-tenant
started: null
shipped: 2026-04-23
guide_doc: null
handoff: null
related: ["[[build-18a]]", "[[build-18c]]", "[[build-64]]"]
---

#status/shipped #area/multi-tenant #area/rls #build/18b

## What shipped

Flips the multi-tenant infrastructure from "RLS written" to "RLS enforced." Drops the transitional allow-all policies, installs the GoTrue custom access token hook so JWTs carry `active_organization_id`, and patches the contract event RPCs to be organization-scoped.

- **Migrations build55–build60:**
  - build55 — `custom_access_token_hook()` GoTrue hook (mints `active_organization_id` claim).
  - build56 — drop redundant custom policies superseded by the new model.
  - build57 — drop the build53 allow-all transitional policies. RLS is now real.
  - build58 — drop the temporary `aaa_organization_id` helper from build42.
  - build59 — patch `contract_events` RPCs to set `organization_id`.
  - build60 — `auth.admin` read policy on `user_organizations` so the GoTrue hook can read memberships.
- **Code sweep:** `getActiveOrganizationId` decodes JWT directly (commit `ae580cc`), removing the prior `user_profiles` round-trip.

## Source

- Migration files: build55–build60
- Commit range: `c70abd5` (plan) → `2240df6` (session-c apply)
- Guide: none

---
build_id: 64
title: handle_new_user trigger restoration
status: shipped
phase: multi-tenant
started: 2026-04-26
shipped: 2026-04-26
guide_doc: null
handoff: null
related: ["[[build-18a]]", "[[build-18b]]", "[[build-18c]]", "[[build-14d]]"]
---

#status/shipped #area/multi-tenant #area/auth #build/64

## What shipped

A latent regression fix: the `on_auth_user_created` trigger on `auth.users` had been silently absent (the function `public.handle_new_user()` survived [[build-18a]] build48's rewrite, but the trigger calling it was dropped at some point). Surfaced during [[build-18c]] Session C as a `user_organizations_user_id_profile_fkey` FK violation when inviting a new user via `/settings/users`.

The fix is one idempotent `CREATE OR REPLACE TRIGGER` plus deletion of one orphaned `auth.users` row (`eric@testtesttest.com`) left over from the failed invite. **Zero application code changes.**

- **Migration:** [supabase/migration-build64-recreate-handle-new-user-trigger.sql](../../../supabase/migration-build64-recreate-handle-new-user-trigger.sql).
- **Rollback:** [supabase/build64-rollback.sql](../../../supabase/build64-rollback.sql).

## Source

- Commit: `1b287a4 build64: restore on_auth_user_created trigger on auth.users (#24)`
- Migration: [supabase/migration-build64-recreate-handle-new-user-trigger.sql](../../../supabase/migration-build64-recreate-handle-new-user-trigger.sql)
- Guide: none

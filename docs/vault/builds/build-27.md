---
build_id: 27
title: Email categories + rules engine
status: shipped
phase: email
started: null
shipped: null
guide_doc: null
handoff: null
related: ["[[build-12]]", "[[build-13]]", "[[build-28]]"]
---

#status/shipped #area/email #build/27

## What shipped

Configurable inbox categories (Promotions, Social, etc.) driven by rules: `sender_domain`, `sender_address`, `subject_pattern`. Auto-backfill historical emails on first sync.

- **Migration:** [supabase/migration-build27-categories.sql](../../../supabase/migration-build27-categories.sql) — `category` column on `emails`, `category_backfill_completed_at` on `email_accounts`, `category_rules` table with default seed.
- **Categorization:** [src/lib/email-categorizer.ts](../../../src/lib/) (referenced by sync) — `matchEmailToJob` made synchronous with pre-loaded cache.
- **UI:** [src/components/email-inbox.tsx](../../../src/components/email-inbox.tsx) — IconRail + CategoryTabs.

## Source

- Commits: `e914f1c feat(db): add category column, rules table, and default seed` → `41a5253 integrate IconRail and CategoryTabs into EmailInbox`
- Migration: [supabase/migration-build27-categories.sql](../../../supabase/migration-build27-categories.sql)
- Guide: none

---
build_id: 28
title: Email body-pattern rules + IMAP backfill
status: shipped
phase: email
started: null
shipped: null
guide_doc: null
handoff: null
related: ["[[build-12]]", "[[build-27]]"]
---

#status/shipped #area/email #build/28

## What shipped

Rule engine extension for `body_pattern` matches (in addition to sender/subject from [[build-27]]). Required IMAP header re-fetch for backfill since the original IMAP fetch hadn't pulled body text.

- **Migration:** [supabase/migration-build28-body-patterns.sql](../../../supabase/migration-build28-body-patterns.sql).
- **Sync fix later:** `84a5f32 fix(email): pass body_text to sync-time categorizer, restoring Promotions` — sync was passing the wrong field after a refactor.

## Source

- Commit: `194a107 feat(email): body_pattern rules + IMAP header re-fetch for backfill`
- Migration: [supabase/migration-build28-body-patterns.sql](../../../supabase/migration-build28-body-patterns.sql)
- Guide: none

---
build_id: 29
title: Configurable nav order
status: shipped
phase: settings
started: null
shipped: null
guide_doc: null
handoff: null
related: ["[[build-14a]]"]
---

#status/shipped #area/settings #area/nav #build/29

## What shipped

Admin-configurable sidebar navigation order persisted to DB. Builds on the static nav array; admins drag-reorder at `/settings/navigation`.

- **Migration:** [supabase/migration-build29-nav-order.sql](../../../supabase/migration-build29-nav-order.sql) — `nav_items` table.
- **Routes:** `/settings/navigation`, `/api/settings/nav-order`.
- **Provider:** `NavOrderProvider` context wired into the root layout.
- **Refactor:** extracted `navItems` array to a shared lib (commit `416b1bd`).

## Source

- Commits: `f9a4050` (migration) through `cd20d41` (per-call snapshot fix), PR #2
- Migration: [supabase/migration-build29-nav-order.sql](../../../supabase/migration-build29-nav-order.sql) — note the rename from build27 to build29 to avoid the email-categories collision (commit `b74d774`)
- Guide: none

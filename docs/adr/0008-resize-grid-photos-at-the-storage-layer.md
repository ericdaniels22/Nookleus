# 0008 — Resize grid photos at the storage layer via Supabase image transformation

**Status:** Accepted
**Date:** 2026-06-04

## Context

Issue #388. Viewing a Job's Photos is slow, and photos lower on the page often
paint *before* the ones at the top. Root cause: every square in every photo grid
downloads the **full-resolution original** (multi-MB camera files) — see
[job-photos-tab.tsx:513](../../src/components/job-photos-tab.tsx:513) — with no
size variant and no load priority, so whichever file happens to be smallest wins
the paint race. The `photos.thumbnail_path` column exists but is never written or
read; there is no thumbnail pipeline and no image transformation anywhere in the
codebase.

The grids need a small **preview** variant; the single-photo detail view, the
annotator, and PDF report generation must keep using full-resolution originals.

The app deploys to Vercel (Next.js 16, non-standard per `AGENTS.md`) and the iOS
app is a Capacitor WebView pointed at the live Vercel URL
([capacitor.config.ts:9](../../capacitor.config.ts:9)), so any web-side fix
reaches iOS unchanged. Supabase storage is on the **free plan**, where image
transformation is not available.

## Decision

**Resize grid photos at the storage layer using Supabase's image transformation
(`render/image`) endpoint, which requires upgrading the Supabase org to Pro.**

- All photo-grid URLs go through a single helper — `photoUrl(path, { size })` —
  replacing the ~5 hand-built `…/object/public/photos/${path}` strings. Grids
  request a preview size; detail / annotator / PDF request the original.
- A preview is `…/storage/v1/render/image/public/photos/{path}?width=…&quality=…&resize=cover`;
  the original is the existing `…/storage/v1/object/public/photos/{path}`.
- Because resizing follows whatever path the helper is given, an **annotated**
  photo's preview is the resized *annotated* image automatically — no separate
  thumbnail to regenerate on edit.
- **Prerequisite (user action, not the agent's):** upgrade Supabase org *AAA
  Disaster Recovery* to Pro (~$25/mo) and enable image transformation. The work
  is blocked on this.

## Consequences

- Recurring ~$25/mo Supabase Pro cost. Offset: Pro raises the bandwidth cap, and
  previews cut per-view bytes by ~99%, relieving the pressure the full-res grids
  put on the free plan's egress limit today.
- Grid image quality drops slightly (intended). The detail view, annotator, and
  PDF stay full-resolution, so report/print fidelity is unchanged.
- The fix benefits **all existing photos immediately** — no backfill, because
  transformation is on-the-fly from the original already in storage.
- The dead `photos.thumbnail_path` column stays dead; this approach needs no
  stored thumbnail. Dropping the column is a separate cleanup.
- Lock-in is mild: the helper is the single seam. Swapping to `next/image` or
  pre-generated thumbnails later means changing one function (plus, for pre-gen,
  a backfill).

## Alternatives considered

- **(A) Vercel image optimization via `next/image`.** No Supabase upgrade, likely
  $0 to start. Rejected as the primary path: the app runs a customized Next.js 16
  (`AGENTS.md` warns it is not stock), so `<Image>` carries integration risk;
  Vercel's free image quota caps distinct source images per month, which a
  photo-heavy disaster-recovery business could exceed and be pushed to a paid
  tier anyway; and it routes originals through Vercel's optimizer rather than
  keeping resizing next to the data. **Kept as the fallback** if the Pro cost is
  later judged not worth it — the `photoUrl` helper makes the switch a one-place
  change.
- **(C) Pre-generated thumbnails at upload + backfill.** No monthly fee on any
  plan. Rejected: most engineering (two upload paths — web and the mobile upload
  queue — plus a one-time backfill over existing photos), existing photos stay
  slow until the backfill runs, and an annotated photo would need its thumbnail
  regenerated on every edit. The owner chose predictable reliability over
  avoiding the $25/mo.
- **Only reorder loads, keep full-size images.** Rejected: fixes the ordering
  symptom but not "slow in general" — full-size images stay heavy.

See the **Photo** entry in [CONTEXT.md](../../CONTEXT.md).

# The full-screen Photo viewer replaces the Photo Details modal and stays separate from the Annotator

**Status:** Accepted
**Date:** 2026-06-08

## Context

Opening a photo today shows the centered **"Photo Details" modal**
([`photo-detail.tsx`](../../src/components/photo-detail.tsx), `PhotoDetailModal`):
a Base UI Dialog capped at `sm:max-w-5xl max-h-[90vh]` with the image on the left
and a fields column (caption, Before/After, tags, metadata, Delete, Save) on the
right. [Issue #469](https://github.com/ericdaniels22/Nookleus/issues/469) wants the
CompanyCam-style experience instead — the photo filling the screen on a black
backdrop, with the actions (Edit · Zoom · Download · Trash, plus a ⋯ More menu)
laid over the image and the rest of the metadata in a side panel (desktop) or
slide-up panels (phone).

The codebase already has a **second** full-screen photo surface: the fabric.js
**Annotator** ([`photo-annotator.tsx`](../../src/components/photo-annotator.tsx),
~2000 lines) — a non-destructive drawing canvas with its own prev/next, original-
resolution loading, dual-save (annotation JSON → `photo_annotations`, flattened PNG
→ `photos.annotated_path`), and a destructive crop path with `-original` backup.
The new viewer therefore lands next to an existing full-screen surface that does a
related-but-different job, and the obvious-looking move — fold drawing into the new
viewer so there is "one full-screen photo screen" — has to be weighed against the
cost of touching that delicate canvas code.

The grilling (see the **Photo viewer**, **Annotator**, and **Cover photo** entries
in [CONTEXT.md](../../CONTEXT.md)) also surfaced four capabilities that read as
adjacent but have **no backing tables or routes today**: per-photo Comments,
per-photo Tasks, a Description distinct from the existing caption, and a restorable
photo recycle bin (the `deleted_at` soft-delete pattern exists for `photo_reports`
per #402, but **not** for `photos` — photo delete is a hard delete).

## Decision

1. **Replace the modal with a full-screen Photo viewer.** `PhotoDetailModal` is
   retired; the full-screen **Photo viewer** becomes the single surface for viewing
   and acting on one Photo. Every field and action the modal carried (caption,
   Before/After, tags, metadata, Download, Delete, Set as cover) moves over as-is —
   this is a presentation change, not a re-modeling of the Photo.

2. **The viewer and the Annotator stay separate surfaces; Edit hands off.** The
   viewer does not absorb the fabric.js canvas. Its **Edit** action opens the
   existing Annotator on top, and leaving the Annotator returns to the viewer on the
   same photo. The two surfaces keep distinct jobs: the **Photo viewer** = view +
   quick actions; the **Annotator** = drawing. We accept two full-screen photo
   surfaces rather than refactoring the proven annotator into the new viewer.

3. **Reuse existing capabilities; only Zoom, Share, Duplicate, and a single-photo
   Save-to-device are net-new.** Navigation runs across **all** the job's photos
   newest-first across date dividers (mirroring the Annotator's prev/next); Set as
   cover reuses the [`job-photos-tab.tsx`](../../src/components/job-photos-tab.tsx)
   cover-photo feature; Download/Delete reuse current behavior. Delete stays a
   **permanent** hard delete with an "are you sure?" confirm and an Undo toast — no
   recycle bin in this change.

4. **The viewer renders the full-resolution image.** Consistent with
   [ADR 0008](0008-resize-grid-photos-at-the-storage-layer.md) — grids use
   `photoUrl(...,{size})` previews; the detail/annotator surfaces use originals via
   [`originalPhotoUrl`](../../src/lib/jobs/photo-url.ts). Share and Save export the
   **displayed** version (annotated if drawings exist, else original); **Duplicate**
   makes a clean same-job copy of the **original** that keeps tags + caption but
   **no drawings**.

5. **Comments, Tasks, a separate Description, and a photo recycle bin are
   explicitly out of scope** for #469 and tracked as their own follow-up issues.
   They are named here so a future reader knows the omission was deliberate, not an
   oversight, and that adding them means new tables, not just UI.

## Consequences

- **Two full-screen photo surfaces coexist by design.** A future engineer seeing
  the retired modal, a new viewer, *and* a separate 2000-line annotator should not
  "consolidate" them — the separation is the decision. The seam between them is the
  viewer's **Edit** → Annotator handoff.
- **Video rides the same viewer.** Video plays inline with scrub; Draw and Zoom are
  hidden for video; tags, Before/After, Share, Duplicate, Save, Delete, and
  prev/next still apply.
- **Delete remains destructive.** Because there is no `photos.deleted_at`, the Undo
  toast is the only recovery affordance until the recycle-bin follow-up lands; the
  confirm + toast are load-bearing, not cosmetic.
- **The deferrals are commitments, not rejections.** Each deferred capability is a
  filed follow-up; this ADR is the record that they were considered and consciously
  kept out of the first slice.

## Considered options

- **Merge drawing into the viewer (one full-screen photo screen).** Rejected: it
  forces a rewrite of the working, non-destructive fabric.js annotator (dual-save,
  crop-with-backup, its own navigation) for no user-visible gain over an Edit
  handoff, and risks regressing a surface that is already correct.
- **Keep the centered modal, just enlarge it.** Rejected: it cannot deliver the
  full-bleed black-backdrop viewing experience #469 asks for, and leaves the
  desktop/phone action layouts (overlaid toolbar, ⋯ More menu, phone slide-up
  panels) with nowhere to live.
- **Ship Comments / Tasks / Description / recycle bin alongside the viewer.**
  Rejected for this slice: each needs new persistence (tables + routes), which would
  balloon a UI change into a data-model change and delay the viewer the issue
  actually asked for.

See the **Photo viewer**, **Annotator**, and **Cover photo** entries in
[CONTEXT.md](../../CONTEXT.md).

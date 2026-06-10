# Add-photos dialog: fullscreen viewer, date groups, tag filter, sort

**Date:** 2026-06-10
**Status:** Approved design — ready for implementation plan
**Components:** `src/components/photo-report-add-photos-dialog.tsx`,
new `src/components/photo-report-picker-viewer.tsx`,
`src/components/photo-report-builder.tsx`,
`src/app/jobs/[id]/reports/[reportId]/page.tsx`

## Problem

The Photo Report builder's "+ Add Photos" picker (#552,
`photo-report-add-photos-dialog.tsx`) is a flat thumbnail grid. On a Job with
hundreds of photos it is hard to use:

- Thumbnails are small (96px) and there is **no way to look at a photo
  properly** before deciding to add it — unlike the Photos tab, where clicking
  a photo opens the fullscreen `PhotoViewer`.
- The whole tile is the toggle, so there is no dedicated checkbox affordance,
  and **no bulk selection** — every photo is an individual click.
- Photos appear as one undifferentiated wall: **no date grouping, no tag
  filter, no sort control**, all of which the Photos tab has
  (`job-photos-tab.tsx`).

We want the picker to feel like a small Photos tab: date-grouped, filterable,
with corner checkboxes for (bulk) selection and a click-to-view fullscreen
viewer — while keeping the picker's existing semantics intact.

## Invariants preserved (unchanged behavior)

- **Ordered selection.** `selected` stays an ordered `string[]`: pick order =
  the order photos land in the Section = the order the PDF numbers them.
- **One-Section invariant.** A photo already in the target Section is not
  selectable ("In this section"); a photo in another Section is selectable and
  labelled "In {section}" — adding it moves it (`addPhotosToSection` dedupes).
- The footer ("Cancel" / "Add N photos") and the `onAdd(photoIds)` contract
  are unchanged.

## Design

### 1. Dialog layout and toolbar

The dialog widens from `sm:max-w-2xl` to `sm:max-w-4xl` to fit date groups.
Under the header sits a small toolbar:

```
Add photos
Select photos to add to "Roof damage". A photo used in another section moves here.
[ Tags ▾ ]  [ Newest first ⇅ ]
──────────────────────────────────────────────
Tuesday, June 9th, 2026                    [☐]   ← group checkbox
[▣1] [▣2] [☐ ] [☐ ] [☐ ] ...
Monday, June 8th, 2026                     [☐]
[☐ ] [☐ ] ...
```

- **Tags** — a dropdown with one checkbox row per Organization tag (color dot
  + name), same look and semantics as the Photos tab's Tags filter: a photo is
  shown if it has **any** of the checked tags; with no tags checked, all
  photos show. Filtering is client-side on
  `photo.photo_tag_assignments[].tag_id`.
- **Sort** — a single toggle button, "Newest first" ⇄ "Oldest first",
  defaulting to newest first (the order the page already supplies). It
  reverses both group order and photo order within each day.
- **Filters never clear the selection.** A selected photo hidden by a filter
  stays in `selected` (its number is simply not visible until the filter
  shows it again), and "Add N photos" still adds it. This differs from the
  Photos tab (which clears selection on filter change) on purpose: in the
  picker, selection is a cart being filled across filter views, not a
  transient bulk-action target.

### 2. Date groups

Photos group by `created_at` day using the Photos tab's exact pattern:
key `format(date, "yyyy-MM-dd")`, header label `"EEEE, MMMM do, yyyy"`.

Each group header carries a **group checkbox** — the primary bulk-select
tool:

- Checked state: checked when **all selectable** photos of that day (visible
  under the current filter, excluding "In this section" photos) are selected.
- Clicking when not-all-selected **appends** the day's unselected selectable
  photos to `selected` in grid order; clicking when all-selected removes the
  day's photos from `selected`. (Append-in-grid-order keeps the ordered-
  selection semantics: a day-check acts like clicking each photo left to
  right.)
- A day whose photos are all "In this section" shows a disabled checkbox.

### 3. Photo tiles

Each tile changes from "whole tile = toggle" to two affordances:

- **Checkbox, top-right corner, always visible** (not hover-only — this is
  the primary selection affordance the user asked for). Unselected: an empty
  circle (`border-2 border-white/80` over a slight dark scrim for contrast on
  any photo). Selected: filled primary circle showing the **pick number**
  (`selected.indexOf(id) + 1`) — the existing numbered badge moves from
  top-left to top-right and becomes the checkbox itself.
- **Clicking the photo body opens the fullscreen viewer** at that photo
  (no longer toggles selection).

Status rules per tile:

| Photo state        | Checkbox          | Body click   | Bottom label      |
| ------------------ | ----------------- | ------------ | ----------------- |
| free               | shown, toggles    | opens viewer | none              |
| in another Section | shown, toggles    | opens viewer | "In {section}"    |
| in this Section    | none, tile dimmed | opens viewer | "In this section" |

"In this section" photos stay viewable fullscreen (you may want to look at
them for context) but remain unselectable, as today.

### 4. Fullscreen viewer (new component)

A new, small, view-only component — `photo-report-picker-viewer.tsx`,
target ≈200 lines — **not** a modification of the 1500-line `PhotoViewer`
and not an extraction from it (two consumers; the shared logic already lives
in pure modules — see the third-consumer heuristic). It reuses:

- `@/lib/jobs/photo-zoom-transform` — `FIT`, `ZOOM_STEP`, `zoomBy`,
  `doubleTap`, `pan`, `Transform`, `ViewportContext`, `Focal`
- `@/lib/jobs/photo-viewer-navigation` — `nextPhotoIndex`, `prevPhotoIndex`,
  `hasNext`, `hasPrev`
- `@/lib/jobs/photo-url` — `photoUrl(photo, supabaseUrl, "full")`

Rendering and interactions mirror the desktop `PhotoViewer`:

- `fixed inset-0 z-[90] bg-black` (same layer as `PhotoViewer`), image
  `object-contain` with `translate(...) scale(...)` transform. shadcn's
  `DialogContent` sits at `z-50`, so `z-[90]` covers the dialog and its
  overlay.
- **Render through `createPortal(..., document.body)`.** shadcn's
  `DialogContent` centres itself with a CSS `translate` transform; a
  transformed ancestor becomes the containing block for `fixed` children, so
  a viewer rendered inline inside the dialog would be positioned relative to
  the dialog box, not the viewport. The portal escapes that.
- **Zoom:** scroll wheel (`Math.exp(-e.deltaY * 0.0015)` about the cursor),
  double-click (`doubleTap`), +/− toolbar buttons (`zoomBy` with `ZOOM_STEP`
  about the viewport centre), drag-to-pan when `scale > 1`.
- **Navigation:** ◀ ▶ buttons and Arrow keys, over the **filtered + sorted**
  flat list currently shown in the grid (what you see is what you flip
  through). No wrap-around (`hasPrev`/`hasNext`), same as the Photos tab.
- **Selection in the viewer:** top-right shows the same checkbox (empty
  circle / numbered fill) plus the status text where applicable ("In this
  section" — checkbox hidden; "In {section}"). Toggling updates the same
  `selected` array; the grid reflects it on close.
- **Close:** ✕ button or Escape returns to the grid with selection intact.

The viewer is **view-only + select**: no caption editing, no tag editing, no
delete, no annotate, no info panel.

**Escape layering.** Radix's Dialog closes on Escape by default. While the
viewer is open, `DialogContent` gets
`onEscapeKeyDown={(e) => { if (viewerOpen) { e.preventDefault(); closeViewer(); } }}`
so the first Escape closes only the viewer and a second Escape closes the
dialog.

### 5. Data plumbing

The builder page currently fetches photos with `.select("*")` and passes no
tags. Two server-side changes in
`src/app/jobs/[id]/reports/[reportId]/page.tsx`:

1. Photo query becomes `.select("*, photo_tag_assignments(tag_id)")` —
   the same shape the Photos tab uses (`job-photos-tab.tsx:97`), typed as
   `Photo & { photo_tag_assignments?: { tag_id: string }[] }` (the `Photo`
   type does not carry assignments).
2. New query `supabase.from("photo_tags").select("*").order("name")`
   (RLS scopes to the active org — same pattern as `job-detail.tsx:208`),
   `.returns<PhotoTag[]>()`.

Both thread through new optional props:
`PhotoReportBuilder` gains `tags?: PhotoTag[]` (default `[]`) and passes it
to `AddPhotosDialog`, which gains the same prop. Optional-with-default keeps
existing call sites and tests compiling; when the Organization has no tags
the Tags dropdown is not rendered at all.

No new API routes, no schema changes, no writes.

## Component boundaries

- **`AddPhotosDialog`** owns: selection state, filter/sort state, grouping,
  the grid, and `viewerIndex` state (null = closed). It computes the
  filtered+sorted flat list once and feeds both the grouped grid and the
  viewer from it.
- **`PickerPhotoViewer`** (new) is controlled and stateless about selection:
  props ≈ `{ photos, index, onIndexChange, supabaseUrl, selectedNumber:
  number | null, status: "free" | "in-target" | "elsewhere", elsewhereTitle?,
  onToggleSelect, onClose }`. Internal state is only the zoom `Transform`.
  It resets to `FIT` on photo change.
- Grouping/filter/sort helpers are plain functions local to the dialog file
  (single consumer today; promote to `@/lib/jobs/` only if a third consumer
  appears).

## Testing

Extend `src/components/photo-report-builder-desktop.test.tsx` (the existing
picker tests) and/or a colocated dialog test file, mirroring its patterns:

- **Tile affordances:** clicking the checkbox toggles selection (numbered
  badge appears, footer count updates); clicking the photo body opens the
  viewer instead of toggling.
- **Ordered selection preserved:** checking A then B then un-checking A
  renumbers B to 1; `onAdd` receives ids in pick order (regression guard).
- **Date groups:** photos render under the correct day headers; the group
  checkbox selects all selectable photos of the day, excludes "In this
  section" photos, and unchecks them on second click.
- **Tag filter:** checking a tag hides non-matching photos; selection made
  before filtering survives the filter and is included in `onAdd`.
- **Sort toggle:** "Oldest first" reverses group order.
- **Viewer:** opens at the clicked photo; Arrow keys navigate the filtered
  list; the in-viewer checkbox toggles the same selection; "In this section"
  photos show status and no checkbox.
- **Escape layering:** with the viewer open, Escape closes the viewer and the
  dialog stays open; a second Escape closes the dialog.

Pure zoom/navigation math is already covered by
`photo-zoom-transform.test.ts` / `photo-viewer-navigation.test.ts` — no new
unit tests there. Suite is known-red on main; verify touched files only.

## Out of scope

- Any change to `photo-viewer.tsx` (the Photos tab viewer) or extraction of a
  shared viewer component.
- Editing tools in the picker viewer (caption, tags, delete, annotate,
  before/after pairing).
- Date-range pickers or a Users filter in the picker (Tags + sort only).
- Mobile builder / tray behavior.
- Persisting filter or sort preferences.

# Photo report builder: click-to-enlarge, annotate, and show annotations

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation plan
**Components:** `src/components/photo-report-builder.tsx`,
`src/components/photo-annotator.tsx`,
`src/components/photo-viewer.tsx` (reused, no change)

## Problem

Three adjustments to the Photo Report builder's per-Section photo grid (the
thumbnails under each Section, rendered by `SortableSection` /
`DraggablePhoto`):

1. **No way to look at a photo properly.** The Section thumbnails are
   drag-to-reorder tiles with a remove (✕) overlay, but clicking one does
   nothing. While building a report the user wants to click a photo to enlarge
   it and to annotate / edit it.
2. **Thumbnails are small.** The grid is
   `minmax(96px,1fr)` (~6–7 per row); the user wants them a bit bigger so
   they are easier to see at a glance.
3. **Annotations don't reliably show.** The user expects a photo's saved
   annotations to appear on its Section thumbnail.

Investigation of #3 found the thumbnail already prefers the annotated render
on a clean load — `photoUrl()` resolves `annotated_path || storage_path`
(`src/lib/jobs/photo-url.ts:77`) and the page's photo query
(`.select("*, photo_tag_assignments(tag_id)")`, `page.tsx:64`) includes
`annotated_path` via `*`. So a *first-time* annotation does show after a hard
refresh. The real failures are two:

- **Gap A — no live update.** The builder receives `photos` as a static
  server prop with no client refetch, so an annotation saved from within the
  builder does not appear until a full page reload.
- **Gap B — re-annotation staleness.** The annotator writes the flattened PNG
  to a *stable* path `{storage_path}-annotated.png` with `upsert: true` and no
  cache-busting. Supabase's CDN caches by path (~1 hr), so **re-annotating** a
  photo serves the previous render even after a reload, until the cache
  expires. This also affects the existing Photos-tab / job-detail annotate
  flow.

## Invariants preserved (unchanged behavior)

- **Drag-to-reorder still works.** dnd-kit's `PointerSensor` uses
  `activationConstraint: { distance: 4 }`, so a clean tap (no 4px movement)
  fires the new click handler while a drag still reorders. Click and drag
  coexist with no mode toggle.
- **Dangling photo ids stay harmless.** The Section grid already skips a
  `photo_id` missing from `photosById`
  (`photo-report-builder.tsx:1033–1035`, `if (!photo) return null`), and the
  reducer keeps the raw id in `photo_ids` so positions stay aligned. Deleting
  a photo from the reused viewer therefore cannot crash the builder.
- **Auto-save semantics unchanged.** The debounced report auto-save (#441) and
  the Generate flush are untouched. `router.refresh()` re-runs the server
  component for fresh `photos`, but the `useReducer` Section state seeds from
  props only on mount, so a refreshed `report`/`photos` prop never clobbers
  in-flight Section edits.
- **The annotator's public contract is unchanged.** `annotated_path` remains
  the single source of truth read by `photoUrl()` everywhere; only the *value*
  it points at changes per save. No caller of `photoUrl` changes.

## Design

### 1. Bigger thumbnails (#2)

In `SortableSection`, the Section photo grid changes from
`grid-cols-[repeat(auto-fill,minmax(96px,1fr))]` to
**`minmax(120px,1fr)`** (`photo-report-builder.tsx:1032`). ~5 per row on a
desktop builder column — a modest, "a bit bigger" bump. Click-to-enlarge (#1)
covers true detail, so the grid stays compact.

Out of scope: the Cover-photo picker grid and the phone PhotoTray (both
`minmax(72px,1fr)`) stay as-is — the request points at the Section grid.

### 2. Click to enlarge + annotate (#1)

**Reuse the full `PhotoViewer` and `PhotoAnnotator` as-is** — no new
components, mirroring the wiring `job-detail.tsx` already uses (≈ lines
1101–1134). The Section grid is page-level (not inside the transformed,
modal add-photos dialog that forced the picker's separate view-only
`PickerPhotoViewer`), so `PhotoViewer`'s self-contained
`fixed inset-0 z-[90]` overlay (`photo-viewer.tsx:781`) drops in exactly as it
does on the Photos tab — no portal or nested-dialog workaround needed.

`PhotoViewer` is **always mounted with `open` toggled** (it seeds position from
`initialPhotoIndex` during render and survives across opens —
`photo-viewer.tsx:147–167`), so the builder mounts one instance and toggles
`open` rather than conditionally rendering it.

**Click behavior (Approach A — viewer first, edit inside):**

- A new `onClick` on the `DraggablePhoto` tile opens `PhotoViewer` at the
  clicked photo. The tile keeps its drag listeners and ✕ remove button; the
  4px activation constraint keeps tap-to-open and drag-to-reorder distinct.
  (The ✕ button keeps its own `stopPropagation` so removing a photo never
  opens the viewer.)
- **Navigation is Section-scoped.** The viewer receives only the clicked
  Section's resolved photos, so ◀ ▶ / arrow keys stay within that Section
  rather than wandering the whole Job. The array is the Section's `photo_ids`
  resolved through `photosById` with dangling ids dropped:
  `section.photo_ids.map((id) => photosById.get(id)).filter(Boolean)`, and the
  initial index is the clicked photo's position within that filtered array.
- **Edit lives inside the viewer.** `PhotoViewer`'s existing Draw/Edit button
  fires `onAnnotate(photo, url)` (`photo-viewer.tsx:919`, and the phone layout
  at 1128) → the builder opens `PhotoAnnotator` for that photo. The heavy
  Fabric canvas loads only when the user chooses to annotate.

**Reused viewer brings its full toolset** — zoom/pan, navigation, caption and
tag editing, delete (with Undo), and annotate — matching the Photos-tab
experience. Caption/tag/delete edits are fine in the builder because every
mutation routes through `onUpdated` (see #3 Gap A) and deletes degrade
gracefully via the dangling-id guard.

**Type note:** the builder's `photos` are `PickerPhoto`
(`Photo & { photo_tag_assignments?: { tag_id: string }[] }`), structurally
assignable to `PhotoViewer`'s `photos: Photo[]` prop. The builder already
holds `tags: PhotoTag[]` (→ `allTags`), `supabaseUrl`, and `jobCoverPhotoId`
(→ `coverPhotoId`) — every `PhotoViewer` prop is already on hand.

### 3. Show the annotations (#3)

**Gap A — live update.** Wire `PhotoViewer.onUpdated` and
`PhotoAnnotator.onSaved` to **`router.refresh()`**
(`next/navigation`). This re-runs the builder server component, which re-fetches
`photos` with the fresh `annotated_path`; because `photosById` is rebuilt every
render (`photo-report-builder.tsx:207`), the Section thumbnails re-resolve
immediately to the annotated render. The `useReducer` Section state is
unaffected (initial-arg seeding runs only on mount), so unsaved Section edits
survive the refresh.

> Validation: per `AGENTS.md`, confirm `router.refresh()` semantics (server
> refetch + client state preservation) against `node_modules/next/dist/docs/`
> before writing it. If this Next build's `router.refresh()` does not preserve
> `useReducer` state across the refetch, fall back to lifting `photos` into
> builder `useState` and patching the single changed photo from the
> annotator's save result. `router.refresh()` is the preferred, minimal
> approach.

**Gap B — re-annotation staleness (cache-bust).** In the annotator's save flow
— the upload that produces the flattened annotated PNG and sets
`photos.annotated_path` — change the destination from the stable
`{storage_path}-annotated.png` to a **unique path per save**, e.g.
`{storage_path without ext}-annotated-{token}.png` where `token` is a
per-save uniqueness token (e.g. `Date.now().toString(36)`; `Date.now()` is
available in component code — the no-`Date.now` restriction is the Workflow
sandbox only). Then, after the `photos` row update to the new path succeeds,
**best-effort delete the prior `annotated_path` file** (the value before this
save) when it existed and differs.

Because the URL changes with the path, the CDN serves the fresh render with no
query-param hack, no schema change (the `photos` table has no `updated_at` to
hang a `&v=` token on), and no change to `photoUrl()` or any of its many
callers — `annotated_path` already flows everywhere. Deleting the prior file
keeps Storage tidy and is safe: nothing but the just-updated `annotated_path`
references it, and already-generated report PDFs embed image bytes (react-pdf
DCTDecode), so they are unaffected by deleting the source object.

Scope note: only the annotated-render upload that feeds `photos.annotated_path`
changes. Any other uploads in the annotator (e.g. annotation source assets)
are untouched; the implementation plan pinpoints the exact call.

## Component boundaries / data flow

- **`PhotoReportBuilder`** owns new view state: `viewer` (`null` =
  closed, else `{ photos: Photo[]; index: number }`), `annotatorPhoto`
  (`Photo | null`), and `annotatorOpen`. It passes an open-viewer callback
  down through `SortableSection` → `DraggablePhoto`. It renders one mounted
  `PhotoViewer` and one `PhotoAnnotator`, wiring `onUpdated`/`onSaved` →
  `router.refresh()` and `onAnnotate` → set `annotatorPhoto` + open the
  annotator.
- **`SortableSection`** computes its own Section-scoped resolved photo list
  (it already maps `section.photo_ids` through `photosById`) and, on a tile
  click, calls the open-viewer callback with that list and the clicked index.
- **`DraggablePhoto`** gains an `onClick` (tile body) that invokes the
  callback; drag listeners and the ✕ button are unchanged.
- **`PhotoViewer`** and **`PhotoAnnotator`** are reused unmodified; they remain
  controlled by the builder's view state.
- **`photo-annotator.tsx`** changes only its annotated-render save: unique
  destination path + best-effort delete of the prior annotated file.

No new API routes. No schema changes. No change to `page.tsx` (it already
selects `annotated_path` and passes `tags`/`jobCoverPhotoId`). No change to
`photo-url.ts`.

## Error handling

- **Prior-file delete is best-effort:** wrapped in try/catch and logged; a
  leftover orphan object is harmless and never fails the save.
- **Upload failure keeps the existing `annotated_path`** (current behavior) —
  the row is only updated after a successful upload, so a failed save leaves
  the previous annotation intact and visible.
- **`router.refresh()` failure is non-fatal:** the annotation is already
  persisted, so it appears on the next load; the save is not reported as
  failed.
- **Delete-from-viewer of a Section photo** leaves a dangling id that the grid
  already skips; after `router.refresh()` the tile simply disappears.

## Testing

`npx vitest` is broken here — run `npm test -- <file>`. The full suite is
known-flaky (worker pollution); verify touched files in isolation.

- **`photo-report-builder` tests** (`photo-report-builder-desktop.test.tsx`,
  mirroring its patterns):
  - Tapping a Section thumbnail opens the viewer at that photo; the viewer
    receives the Section's photos (Section-scoped navigation), not the whole
    Job.
  - The ✕ remove button still removes without opening the viewer.
  - Grid renders at the larger column size (assert the class /
    `minmax(120px` token).
- **`photo-annotator` tests:** the annotated-render save writes a **unique**
  path (two saves of the same photo produce different `annotated_path`
  values) and best-effort deletes the prior file; a delete failure does not
  fail the save (mock Storage). Existing annotator / job-detail tests must
  still pass.
- **Manual:** thumbnails are noticeably bigger; click → viewer → Edit →
  annotator; a newly saved annotation appears on the thumbnail immediately
  (Gap A); **re-annotating** the same photo shows the new render without a
  stale flash (Gap B).

## Out of scope

- The Cover-photo picker grid and the phone PhotoTray (sizing and click
  behavior).
- Any change to `PhotoViewer` itself (it is reused unmodified) or to the
  view-only `PickerPhotoViewer` used by the add-photos dialog.
- Pruning dangling `photo_ids` from Sections after a delete (the existing
  skip-on-missing behavior is sufficient).
- A migration to add `photos.updated_at` / `annotated_at` (the unique-path
  approach makes it unnecessary).
- Mobile/phone-specific builder layout beyond what reuse already provides.

# The annotator auto-saves as a split write: a cheap debounced markup upsert on every edit, the expensive flattened render rebuilt only on leave/close

**Status:** Accepted
**Date:** 2026-06-30 — backfill documenting the as-built decision shipped in
issue #807 (PR #827), parent epic #804. The build was implemented and merged
against "ADR 0024" but the file was never written; this records it.

The **photo annotator** has no explicit **Save** button — edits persist on their
own. It does so as a **split write**: every edit debounces a *cheap* upsert of
the editable **markup** (`photo_annotations.annotation_data`), while the
*expensive* **flattened render** (the **Annotated Photo** — a PNG flattened from
the canvas, uploaded to Storage and pointed to by `photos.annotated_path`) is
rebuilt only when the editor **leaves** the photo or **closes** the dialog.
Success is silent; failure retries with backoff and only warns on a durable
outage. This is worth recording because "auto-save" reads as if it should be one
write per edit — and that single obvious design is exactly the one that does not
scale.

## Context

A markup edit (drop an arrow, type a label, renumber) is tiny: it serializes to
a small JSON envelope. Flattening the canvas to a full-resolution PNG, uploading
it to Storage, and repointing the Photo's `annotated_path` is heavy by
comparison — and it is what the **Photo Report** and the contract/report PDFs
actually render. The two have wildly different costs and wildly different read
deadlines:

- The **markup** is the source of truth for what the editor sees and for
  reloading the canvas. It must survive an unexpected exit (tab close, an iOS
  background, a crash) — so it has to be written *during* editing, not only at
  the end.
- The **flattened render** is a leave-time artifact. Nothing reads it *while*
  you are still editing; it only needs to be current by the time someone views
  the photo outside the annotator.

Writing the flattened render on every keystroke would flatten + upload a
full-res PNG dozens of times per session — slow, costly, and a constant churn of
Storage objects, all to produce intermediate renders no one ever looks at.
Writing *nothing* until close would lose every in-progress edit to an
unexpected teardown. Neither end of the spectrum is acceptable, so the write is
split by cost and by read deadline.

## Decision

1. **Two writes, not one.** The editable markup and the flattened render are
   persisted by separate paths with separate cadences:
   - `persistPhotoMarkup` — the *cheap* half. Upserts only
     `photo_annotations.annotation_data` (find the row by `photo_id`, update in
     place, or insert). Never touches Storage or `annotated_path`.
   - `persistAnnotatedRender` — the *expensive* half. Flattens the canvas to a
     PNG, uploads it, and repoints `photos.annotated_path` (story 25).

2. **The markup is debounced ~1s on every edit.** Each commit schedules the
   markup upsert on a `MARKUP_DEBOUNCE_MS = 1000` debounce, so a flurry of
   strokes collapses into one write that still feels instant. A fresh edit
   mid-debounce supersedes the pending one.

3. **The flattened render is rebuilt only on leave/close** — never on a
   keystroke. `flushAndRebuild` runs on exactly two host triggers: advancing to
   another photo (it rebuilds the *outgoing* photo) and closing the dialog. It
   first snapshots the live pixels, then flushes any pending markup, then
   rebuilds — so closing/leaving feels instant while the render finishes in the
   background.

4. **A pending write belongs to the photo it was queued for.** The leave path
   passes the *outgoing* photo explicitly so a write that lands after the host
   has advanced cannot be misattributed to the next photo. A first-time
   annotation's author is resolved lazily, only on insert (issue #808), so a
   re-save skips the auth round-trip.

5. **Success is silent; failure retries, then warns once.** Both halves share a
   retry-then-warn contract with an exponential backoff (1s → 2s → 4s, capped at
   `MAX_BACKOFF_MS = 30s`):
   - **Markup:** up to `MAX_MARKUP_RETRIES = 3` retries. A transient blip
     recovers silently; a durable failure drops the edit and warns once
     ("Couldn't save your annotations…").
   - **Rebuild:** up to `MAX_REBUILD_RETRIES = 3` retries. `persistAnnotatedRender`
     throws *without* touching the row, so every failed attempt leaves the prior
     render intact. On exhaustion it warns *and* rethrows; the leave/close caller
     clears its dirty flag only on success, so a rejected rebuild stays dirty and
     a later leave/close re-attempts it rather than masking the loss.

6. **Teardown flushes only the cheap half.** On unmount, `pagehide` (tab
   close / refresh / nav), and `visibilitychange → hidden` (the common iOS
   background exit), a best-effort *synchronous* markup flush fires and is not
   awaited. The expensive rebuild is deliberately left to the explicit close
   handler, which runs while the page is still alive.

## Consequences

- **The two stores diverge briefly, by design.** The markup row is current
  within ~1s of an edit; the flattened `annotated_path` is stale until the next
  leave/close. Anything that reads the flattened render (Photo Report, PDFs)
  sees the last *rebuilt* version, not in-progress edits. This is accepted — the
  flattened render is explicitly a leave-time artifact, and the markup it is
  regenerated from is already safely saved.
- **A durable markup outage loses that edit** (after warning), whereas a durable
  rebuild outage does **not** lose anything: the dirty flag survives and a later
  leave/close re-attempts the rebuild from the markup that is already persisted.
- **An unexpected teardown keeps your markup but not a fresh render.** If the
  page dies before an explicit close, the cheap flush still lands the markup; the
  `annotated_path` simply stays stale until the photo is next opened and left,
  at which point the rebuild runs from the saved markup. No annotation is lost.
- **No "Save" button, and none is needed.** The UX promise is that work persists
  on its own; the split write is what makes that promise affordable.

## Considered options

- **One write per edit (flatten + upload on every stroke).** Rejected: flattening
  and uploading a full-res PNG dozens of times a session is slow and costly and
  churns Storage objects, all to produce intermediate renders nobody reads.
- **Save only on close (no debounced markup).** Rejected: an unexpected teardown
  — tab close, iOS background, crash — loses every in-progress edit. The markup
  must be durable *during* editing, not only at the end.
- **Debounce the flattened render too (rebuild on the same ~1s timer).**
  Rejected: the render is the expensive half; debouncing only changes *how
  often* the costly op fires, not that it fires far more than the once-per-leave
  it actually needs.
- **An explicit Save button.** Rejected: the annotator's contract is auto-save;
  users expect their work to persist without pressing anything.
- **Flush the expensive rebuild on teardown too.** Rejected: teardown paths
  (`pagehide`, `visibilitychange`) can't reliably run an async upload, so
  teardown is limited to the cheap synchronous markup flush, with the rebuild
  left to the still-alive close handler.

---

**Numbering note.** `0021` is **not** an intentional gap — it is a *second*
missing ADR. `CONTEXT.md` links to
`docs/adr/0021-financials-tab-job-profit-and-collection-ring.md` (the
Financials-tab job-profit / collection-ring decision) in two places, but that
file was never written (no git history for it). Backfilling it is out of scope
for this issue (#851) and should be tracked separately. Note also that this ADR
took the number `0024` that the auto-save build had cited in code since #807; a
later, unrelated **Sketch** ADR had briefly occupied `0024` and was renumbered
to `0025` so the as-built citations resolve correctly.

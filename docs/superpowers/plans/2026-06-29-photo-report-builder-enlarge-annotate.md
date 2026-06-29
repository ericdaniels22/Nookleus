# Photo Report Builder — Enlarge, Annotate, Show Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Photo Report builder, make Section thumbnails bigger, let a click enlarge/annotate a photo by reusing the existing viewer + annotator, and make saved annotations show immediately (live-refresh) and on re-annotation (cache-bust).

**Architecture:** No new UI components. The builder mounts the existing `PhotoViewer` (enlarge/zoom/navigate, with a Draw/Edit button) and `PhotoAnnotator` (Fabric editor) and toggles them open from a thumbnail click — mirroring `job-detail.tsx`. After either saves, the builder calls `router.refresh()` to re-fetch the server component's photos. Re-annotation staleness is fixed by writing the flattened render to a **unique Storage path per save** (extracted into a pure helper) and best-effort deleting the prior file, so the CDN can't serve a stale render.

**Tech Stack:** Next.js App Router (modified build — read bundled docs before Next APIs), React (`useReducer`/`useState`), Supabase Storage + Postgres, dnd-kit, Fabric.js (annotator, dynamically imported), Vitest + Testing Library.

## Global Constraints

- Run a single test file with `npm test -- <path>` — the repo's `npm test` is `vitest run`; `npx vitest run <file>` is broken in this environment.
- The full unit suite is flaky (worker-sharding pollution). Verify only the **touched** files in isolation; do not gate on a green full suite.
- Typecheck with `npx tsc --noEmit`.
- This is a **modified Next.js** build (AGENTS.md). `router.refresh()` was validated against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`: it re-fetches data + re-renders Server Components and **preserves** client React state (`useState`/`useReducer`). Import `useRouter` from `next/navigation`.
- Stay on branch `feat/report-builder-enlarge-annotate`. The repo is under OneDrive — do NOT switch branches or `git stash -u` (it corrupts files mid-sync); commit per task on the current branch.
- `Date.now()` is allowed in component/library code (the no-`Date.now` rule is only for Workflow scripts).

---

## File Structure

- **Create** `src/lib/jobs/annotated-path.ts` — pure helper that builds the per-save annotated-render Storage path. One responsibility: path derivation (testable without Fabric).
- **Create** `src/lib/jobs/annotated-path.test.ts` — unit tests for the helper.
- **Modify** `src/components/photo-annotator.tsx` — the annotated-render save (lines 1603–1625) uses the helper's unique path and best-effort deletes the prior render.
- **Modify** `src/components/photo-report-builder.tsx` — bigger Section grid; click a thumbnail to open `PhotoViewer`; mount `PhotoViewer` + `PhotoAnnotator`; `router.refresh()` on save.
- **Modify** `src/components/photo-report-builder-desktop.test.tsx` — add `next/navigation` mock + viewer/annotator stubs; add the new behavior tests.
- **Modify** `src/components/photo-report-builder.test.tsx` — add `refresh` to its `next/navigation` mock and stub the two heavy islands to `null`.

---

## Task 1: `buildAnnotatedPath` helper (cache-bust path)

**Files:**
- Create: `src/lib/jobs/annotated-path.ts`
- Test: `src/lib/jobs/annotated-path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildAnnotatedPath(storagePath: string, token: string): string` — returns the original path with its final extension replaced by `-annotated-${token}.png`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/jobs/annotated-path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAnnotatedPath } from "./annotated-path";

describe("buildAnnotatedPath", () => {
  it("replaces the final extension with a token-suffixed -annotated.png", () => {
    expect(buildAnnotatedPath("job-1/abc.jpg", "k1")).toBe(
      "job-1/abc-annotated-k1.png",
    );
  });

  it("varies the path by token so re-annotation can't be served from CDN cache", () => {
    const a = buildAnnotatedPath("job-1/abc.jpg", "k1");
    const b = buildAnnotatedPath("job-1/abc.jpg", "k2");
    expect(a).not.toBe(b);
  });

  it("strips only the final extension (handles dotted names)", () => {
    expect(buildAnnotatedPath("job-1/a.b.heic", "k1")).toBe(
      "job-1/a.b-annotated-k1.png",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/jobs/annotated-path.test.ts`
Expected: FAIL — cannot resolve `./annotated-path` / `buildAnnotatedPath is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/jobs/annotated-path.ts`:

```ts
/**
 * Build the Storage path for a photo's flattened annotated render.
 *
 * A UNIQUE path per save (the `token`) is what cache-busts the render: Supabase
 * Storage's CDN keys its cache by path, so re-annotating to a *stable*
 * `-annotated.png` served the previous render until the cache aged out. Varying
 * the path makes every save a guaranteed cache miss — no query-param hack, and
 * `annotated_path` already flows to every `photoUrl()` caller, so nothing
 * downstream changes.
 *
 * Mirrors the original derivation (replace the final extension); paths without an
 * extension are returned unchanged, as before. Storage paths always carry one.
 */
export function buildAnnotatedPath(storagePath: string, token: string): string {
  return storagePath.replace(/\.[^.]+$/, `-annotated-${token}.png`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/jobs/annotated-path.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/annotated-path.ts src/lib/jobs/annotated-path.test.ts
git commit -m "feat(photos): per-save annotated-render path helper (cache-bust)"
```

---

## Task 2: Annotator writes a unique render path + deletes the prior

**Files:**
- Modify: `src/components/photo-annotator.tsx` (import near line 7; save block lines 1603–1625)

**Interfaces:**
- Consumes: `buildAnnotatedPath(storagePath, token)` from Task 1.
- Produces: no new exports. Behavior change: each annotation save sets `photos.annotated_path` to a fresh unique path and best-effort removes the prior annotated file.

> **Why no unit test here:** `handleSave` runs on a live Fabric canvas (`canvas.toDataURL`, `fetch(dataUrl)`, `fabricRef.current`) that cannot be instantiated in jsdom. The cache-bust *logic* is unit-tested via `buildAnnotatedPath` (Task 1); this task wires it in and is verified by typecheck + manual steps. Do NOT add a brittle whole-Fabric mock.

- [ ] **Step 1: Add the helper import**

In `src/components/photo-annotator.tsx`, immediately after the existing line 7 import:

```ts
import { originalPhotoUrl } from "@/lib/jobs/photo-url";
```

add:

```ts
import { buildAnnotatedPath } from "@/lib/jobs/annotated-path";
```

- [ ] **Step 2: Replace the annotated-render save block**

Replace this exact block (currently lines 1603–1625):

```ts
      // Export flattened annotated PNG
      try {
        canvas.discardActiveObject();
        canvas.renderAll();

        const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const annotatedPath = currentPhoto.storage_path.replace(
          /\.[^.]+$/,
          "-annotated.png"
        );
        await supabase.storage.from("photos").upload(annotatedPath, blob, {
          upsert: true,
          contentType: "image/png",
        });
        await supabase
          .from("photos")
          .update({ annotated_path: annotatedPath })
          .eq("id", currentPhoto.id);
      } catch {
        console.log("Could not export annotated image. JSON annotations saved.");
      }
```

with:

```ts
      // Export the flattened annotated PNG to a UNIQUE path per save: Supabase
      // Storage's CDN keys its cache by path, so re-annotating to the old stable
      // `-annotated.png` served the previous render until the cache aged out. A
      // per-save path is a guaranteed cache miss. After the row points at the new
      // file, best-effort delete the prior one so superseded renders don't pile
      // up in Storage (a failed delete is harmless — it leaves an orphan, never a
      // stale render).
      try {
        canvas.discardActiveObject();
        canvas.renderAll();

        const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const previousAnnotatedPath = currentPhoto.annotated_path;
        const annotatedPath = buildAnnotatedPath(
          currentPhoto.storage_path,
          Date.now().toString(36),
        );
        await supabase.storage.from("photos").upload(annotatedPath, blob, {
          upsert: true,
          contentType: "image/png",
        });
        await supabase
          .from("photos")
          .update({ annotated_path: annotatedPath })
          .eq("id", currentPhoto.id);
        if (previousAnnotatedPath && previousAnnotatedPath !== annotatedPath) {
          try {
            await supabase.storage
              .from("photos")
              .remove([previousAnnotatedPath]);
          } catch (err) {
            console.warn("Could not delete previous annotated render:", err);
          }
        }
      } catch {
        console.log("Could not export annotated image. JSON annotations saved.");
      }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from `photo-annotator.tsx` or the new import).

- [ ] **Step 4: Re-run the helper test (guards the logic this task relies on)**

Run: `npm test -- src/lib/jobs/annotated-path.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Manual verification (record results in the commit/PR)**

With the app running and `NEXT_PUBLIC_PHOTO_RESIZE_ENABLED` at its usual value:
1. Open a photo (job-detail or, after Task 4, the builder), annotate, Save → the annotation appears.
2. Re-open the same photo, change the annotation, Save → the **new** render appears (no stale flash).
3. In Supabase Storage `photos/`, confirm the photo has exactly one `*-annotated-*.png` (the prior one was removed).

- [ ] **Step 6: Commit**

```bash
git add src/components/photo-annotator.tsx
git commit -m "fix(annotator): unique render path per save + delete prior (cache-bust re-annotation)"
```

---

## Task 3: Bigger Section thumbnails (#2)

**Files:**
- Modify: `src/components/photo-report-builder.tsx:1032` (the Section grid template)
- Test: `src/components/photo-report-builder-desktop.test.tsx`

**Interfaces:**
- Consumes: existing `makeReport` / `makePhoto` / `renderBuilder` test helpers in the desktop test file.
- Produces: none.

> Note: at this task the builder does NOT yet import `useRouter`/`PhotoViewer`/`PhotoAnnotator` (Task 4 adds those), so this test needs no `next/navigation` mock or island stubs yet.

- [ ] **Step 1: Write the failing test**

In `src/components/photo-report-builder-desktop.test.tsx`, add this describe block at the end of the file (after the last existing `describe`):

```ts
describe("PhotoReportBuilder — Section thumbnail size (#2)", () => {
  it("renders the Section photo grid at the larger 120px min column", () => {
    const report = makeReport({
      sections: [
        { id: "sec-a", title: "Roof", description: "", photo_ids: ["p1"] },
      ],
    });
    const { container } = renderBuilder(report, [makePhoto("p1")]);
    expect(container.querySelector('[class*="minmax(120px"]')).not.toBeNull();
    expect(container.querySelector('[class*="minmax(96px"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/photo-report-builder-desktop.test.tsx -t "larger 120px"`
Expected: FAIL — the grid still uses `minmax(96px,1fr)`, so the `minmax(120px` query is null.

- [ ] **Step 3: Change the grid template**

In `src/components/photo-report-builder.tsx`, line 1032, replace:

```tsx
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
```

with:

```tsx
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/photo-report-builder-desktop.test.tsx -t "larger 120px"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/photo-report-builder.tsx src/components/photo-report-builder-desktop.test.tsx
git commit -m "feat(report-builder): enlarge Section thumbnails to 120px columns (#2)"
```

---

## Task 4: Click a thumbnail to enlarge + annotate, with live refresh (#1, #3)

**Files:**
- Modify: `src/components/photo-report-builder.tsx` (imports; new state + `openPhotoViewer`; `SortableSection` + `DraggablePhoto` props; img `onClick`; mount `PhotoViewer` + `PhotoAnnotator`)
- Modify: `src/components/photo-report-builder-desktop.test.tsx` (add `next/navigation` mock + viewer/annotator stubs + tests)
- Modify: `src/components/photo-report-builder.test.tsx` (add `refresh` to nav mock; stub the two islands)

**Interfaces:**
- Consumes: `PhotoViewer` default export — props `{ open, onOpenChange, photos: Photo[], initialPhotoIndex, allTags: PhotoTag[], supabaseUrl, coverPhotoId: string | null, jobName?, onUpdated: () => void, onAnnotate: (photo: Photo, url: string) => void }`. `PhotoAnnotator` default export — props `{ open, onOpenChange, photos: Photo[], initialPhotoIndex, onSaved: () => void }`. `useRouter` from `next/navigation` (`.refresh()`).
- Produces: none (internal builder wiring).

### Test infrastructure first

- [ ] **Step 1: Add the `next/navigation` mock + island stubs to the desktop test file**

In `src/components/photo-report-builder-desktop.test.tsx`, just after the existing `const h = vi.hoisted(...)` block (ends line 34), add:

```ts
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
```

Then, right after the `@dnd-kit/sortable` mock (ends line 128), add the two stubs (heavy islands — the annotator dynamically imports Fabric on open; stub them like the tiptap/pdf-preview stubs above, capturing the props the builder passes):

```ts
let capturedViewerProps: any = null;
vi.mock("@/components/photo-viewer", () => ({
  default: (props: any) => {
    capturedViewerProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="photo-viewer-stub">
        <button
          data-testid="viewer-annotate"
          onClick={() =>
            props.onAnnotate(props.photos[props.initialPhotoIndex], "annot-url")
          }
        />
        <button data-testid="viewer-updated" onClick={() => props.onUpdated()} />
      </div>
    );
  },
}));

let capturedAnnotatorProps: any = null;
vi.mock("@/components/photo-annotator", () => ({
  default: (props: any) => {
    capturedAnnotatorProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="photo-annotator-stub">
        <button data-testid="annotator-save" onClick={() => props.onSaved()} />
      </div>
    );
  },
}));
```

- [ ] **Step 2: Write the failing behavior tests**

In `src/components/photo-report-builder-desktop.test.tsx`, add this describe block at the end of the file:

```ts
describe("PhotoReportBuilder — enlarge & annotate a Section photo (#1, #3)", () => {
  beforeEach(() => {
    capturedViewerProps = null;
    capturedAnnotatorProps = null;
    nav.refresh.mockClear();
  });

  function reportWith(ids: string[]): PhotoReport {
    return makeReport({
      sections: [
        { id: "sec-a", title: "Roof", description: "", photo_ids: ids },
      ],
    });
  }

  function sectionEl() {
    return screen.getByLabelText("Section heading").closest("section")!;
  }

  it("opens the viewer scoped to the Section at the clicked photo", () => {
    renderBuilder(reportWith(["p1", "p2"]), [makePhoto("p1"), makePhoto("p2")]);
    const imgs = within(sectionEl()).getAllByAltText("Photo");
    fireEvent.click(imgs[1]);
    expect(capturedViewerProps.open).toBe(true);
    expect(capturedViewerProps.photos.map((p: Photo) => p.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(capturedViewerProps.initialPhotoIndex).toBe(1);
  });

  it("removes a photo via the X overlay without opening the viewer", () => {
    renderBuilder(reportWith(["p1"]), [makePhoto("p1")]);
    const section = sectionEl();
    fireEvent.click(
      within(section).getByLabelText("Remove photo from report"),
    );
    expect(within(section).queryByAltText("Photo")).toBeNull();
    expect(capturedViewerProps?.open ?? false).toBe(false);
  });

  it("opens the annotator from the viewer's Edit and refreshes after a save", () => {
    renderBuilder(reportWith(["p1"]), [makePhoto("p1")]);
    fireEvent.click(within(sectionEl()).getByAltText("Photo"));
    fireEvent.click(screen.getByTestId("viewer-annotate"));
    expect(capturedAnnotatorProps.open).toBe(true);
    expect(capturedAnnotatorProps.photos.map((p: Photo) => p.id)).toEqual([
      "p1",
    ]);
    expect(capturedAnnotatorProps.initialPhotoIndex).toBe(0);
    fireEvent.click(screen.getByTestId("annotator-save"));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the builder after a viewer edit/delete", () => {
    renderBuilder(reportWith(["p1"]), [makePhoto("p1")]);
    fireEvent.click(within(sectionEl()).getByAltText("Photo"));
    fireEvent.click(screen.getByTestId("viewer-updated"));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/components/photo-report-builder-desktop.test.tsx -t "enlarge & annotate"`
Expected: FAIL — clicking a thumbnail does nothing yet (`capturedViewerProps` stays null / `open` undefined), and there is no viewer/annotator mount.

### Implement the builder wiring

- [ ] **Step 4: Add imports**

In `src/components/photo-report-builder.tsx`, after the existing line 4 import:

```tsx
import Link from "next/link";
```

add:

```tsx
import { useRouter } from "next/navigation";
```

Then, after the `AddPhotosDialog` import (line 50):

```tsx
import { AddPhotosDialog } from "@/components/photo-report-add-photos-dialog";
```

add:

```tsx
import PhotoViewer from "@/components/photo-viewer";
import PhotoAnnotator from "@/components/photo-annotator";
```

- [ ] **Step 5: Add viewer/annotator state + the open handler**

In `src/components/photo-report-builder.tsx`, immediately after the `pickerSectionIndex` state declaration (ends line 196):

```tsx
  const [pickerSectionIndex, setPickerSectionIndex] = useState<number | null>(
    null,
  );
```

add:

```tsx
  const router = useRouter();

  // Click-to-enlarge / annotate (#1): the section-scoped photo set the viewer
  // navigates, the index it opens on, and whether it's open. A tap on a Section
  // thumbnail opens the viewer; the viewer's Edit button hands a Photo to the
  // annotator. After either saves, router.refresh() re-runs the server component
  // so the freshly annotated render replaces the original on the thumbnail (#3) —
  // useReducer state (the Sections being edited) survives the refetch.
  const [viewerPhotos, setViewerPhotos] = useState<Photo[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [annotatorOpen, setAnnotatorOpen] = useState(false);
  const [annotatorPhoto, setAnnotatorPhoto] = useState<Photo | null>(null);

  const openPhotoViewer = useCallback(
    (sectionPhotos: Photo[], index: number) => {
      setViewerPhotos(sectionPhotos);
      setViewerIndex(index);
      setViewerOpen(true);
    },
    [],
  );
```

- [ ] **Step 6: Pass the handler to `SortableSection` at its render site**

In `src/components/photo-report-builder.tsx`, in the Sections map (lines 682–692), add the `onOpenViewer` prop:

```tsx
                  <SortableSection
                    key={section.id}
                    index={index}
                    section={section}
                    photosById={photosById}
                    supabaseUrl={supabaseUrl}
                    dispatch={dispatch}
                    photosPerPage={state.photosPerPage}
                    desktopSelected={selectedId === section.id}
                    onOpenPicker={() => setPickerSectionIndex(index)}
                    onOpenViewer={openPhotoViewer}
                  />
```

- [ ] **Step 7: Mount `PhotoViewer` + `PhotoAnnotator` at the end of the root `<div>`**

In `src/components/photo-report-builder.tsx`, immediately after the `AddPhotosDialog` block closes (line 793, `)}`), and before the root closing `</div>` (line 794), add:

```tsx
      <PhotoViewer
        open={viewerOpen}
        onOpenChange={(open) => {
          if (!open) setViewerOpen(false);
        }}
        photos={viewerPhotos}
        initialPhotoIndex={viewerIndex}
        allTags={tags}
        supabaseUrl={supabaseUrl}
        coverPhotoId={jobCoverPhotoId}
        // Re-fetch the server component so a caption/tag edit or delete made in
        // the viewer reflects on the builder's thumbnails (#3). A delete leaves a
        // dangling id the grid already skips (line ~1035).
        onUpdated={() => router.refresh()}
        // Keep the viewer mounted underneath; the annotator opens on top and
        // closing it returns to the viewer on the same Photo.
        onAnnotate={(photo) => {
          setAnnotatorPhoto(photo);
          setAnnotatorOpen(true);
        }}
      />
      <PhotoAnnotator
        open={annotatorOpen}
        onOpenChange={(val) => {
          setAnnotatorOpen(val);
          if (!val) setAnnotatorPhoto(null);
        }}
        photos={viewerPhotos}
        initialPhotoIndex={viewerPhotos.findIndex(
          (p) => p.id === annotatorPhoto?.id,
        )}
        // Show the new annotation immediately (#3): re-fetch the server
        // component's photos so the annotated render replaces the original.
        onSaved={() => router.refresh()}
      />
```

- [ ] **Step 8: Add `onOpenViewer` to `SortableSection`'s props + compute the section-scoped list**

In `src/components/photo-report-builder.tsx`, in `SortableSection`'s prop list, after `onOpenPicker` (lines 911–912):

```tsx
  /** Open the "+ Add Photos" picker targeting this Section (#552). */
  onOpenPicker: () => void;
```

add:

```tsx
  /** Open the section-scoped photo viewer at a tapped thumbnail (#1). */
  onOpenViewer: (photos: Photo[], index: number) => void;
```

and add `onOpenViewer` to the destructured params (after `onOpenPicker,` at line 890):

```tsx
  onOpenPicker,
  onOpenViewer,
```

Then, immediately before the `return (` of `SortableSection` (after the `fit` computation, ~line 955), add:

```tsx
  // The Section's photos that actually resolve, in grid order — the set the
  // viewer navigates when a thumbnail is tapped (dangling ids are skipped, so
  // the viewer's index matches what's on screen).
  const sectionPhotos = section.photo_ids
    .map((id) => photosById.get(id))
    .filter((p): p is Photo => !!p);
```

- [ ] **Step 9: Pass `onOpen` to each `DraggablePhoto`**

In `src/components/photo-report-builder.tsx`, in the Section grid map (lines 1036–1045), add the `onOpen` prop:

```tsx
              <DraggablePhoto
                key={photoId}
                photo={photo}
                sectionIndex={index}
                photoIndex={photoIndex}
                supabaseUrl={supabaseUrl}
                dispatch={dispatch}
                onOpen={() =>
                  onOpenViewer(
                    sectionPhotos,
                    sectionPhotos.findIndex((p) => p.id === photo.id),
                  )
                }
              />
```

- [ ] **Step 10: Add `onOpen` to `DraggablePhoto` and wire the image click**

In `src/components/photo-report-builder.tsx`, in `DraggablePhoto`'s prop list, after `dispatch` (lines 1089–1091):

```tsx
  dispatch: React.Dispatch<
    Parameters<typeof photoReportBuilderReducer>[1]
  >;
```

add:

```tsx
  /** Open the enlarged viewer for this photo (#1). */
  onOpen: () => void;
```

and add `onOpen` to the destructured params (after `dispatch,` at line 1082):

```tsx
  supabaseUrl,
  dispatch,
  onOpen,
```

Then add `onClick={onOpen}` to the `<img>` (lines 1111–1117). The drag listeners stay on the same element; the `PointerSensor` `distance: 4` constraint (line 321) means a clean tap fires `onClick` while a 4px+ drag still reorders. The X button is a separate sibling element, so it is unaffected:

```tsx
      <img
        src={photoUrl(photo, supabaseUrl, "grid")}
        alt={photo.caption || "Photo"}
        className="h-full w-full cursor-grab touch-none object-cover"
        onClick={onOpen}
        {...attributes}
        {...listeners}
      />
```

- [ ] **Step 11: Update the original builder test's mocks**

In `src/components/photo-report-builder.test.tsx`, update the existing `next/navigation` mock (lines 50–52) to include `refresh`:

```tsx
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
```

and add two minimal island stubs alongside the other `vi.mock` calls in that file (the builder now imports them; stub to `null` so the real heavy components never load):

```tsx
vi.mock("@/components/photo-viewer", () => ({ default: () => null }));
vi.mock("@/components/photo-annotator", () => ({ default: () => null }));
```

- [ ] **Step 12: Run the new tests to verify they pass**

Run: `npm test -- src/components/photo-report-builder-desktop.test.tsx -t "enlarge & annotate"`
Expected: PASS (4 tests).

- [ ] **Step 13: Run both builder test files in full to catch regressions**

Run: `npm test -- src/components/photo-report-builder-desktop.test.tsx`
Then: `npm test -- src/components/photo-report-builder.test.tsx`
Expected: PASS (all tests in both files, including the Task 3 grid test).

- [ ] **Step 14: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add src/components/photo-report-builder.tsx src/components/photo-report-builder-desktop.test.tsx src/components/photo-report-builder.test.tsx
git commit -m "feat(report-builder): click a Section photo to enlarge + annotate, live-refresh on save (#1, #3)"
```

---

## Manual end-to-end verification (after all tasks)

With the app running, open a Photo Report builder for a job with photos:
1. Section thumbnails are visibly bigger (~5 per row).
2. Click a thumbnail → the viewer opens enlarged; prev/next stays within that Section.
3. In the viewer, click Draw/Edit → the annotator opens on that photo; add markup; Save → the thumbnail shows the annotation **without a manual page reload**.
4. Re-open and re-annotate the same photo, Save → the **updated** annotation shows (no stale render).
5. Edit a caption or delete a photo from the viewer → the builder reflects it after the save (a deleted photo's tile disappears; no crash).

---

## Self-Review

**Spec coverage:**
- #2 bigger thumbnails → Task 3 (grid `minmax(120px)`) + test. ✓
- #1 click to enlarge + annotate → Task 4 (mount `PhotoViewer`/`PhotoAnnotator`, img `onClick`, section-scoped list) + tests. ✓
- #3 Gap A live update → Task 4 (`router.refresh()` on `onUpdated`/`onSaved`) + tests. ✓
- #3 Gap B re-annotation cache-bust → Task 1 (helper) + Task 2 (unique path + delete prior). ✓
- Spec "no schema / no `photo-url.ts` / no `page.tsx` change" → none planned. ✓
- Spec "reuse `PhotoViewer` unmodified; delete safe via dangling-id guard" → honored (no viewer edits; guard noted). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the one non-TDD task (Task 2) states why and gives concrete typecheck + manual steps. ✓

**Type consistency:** `openPhotoViewer(photos: Photo[], index: number)` matches `SortableSection.onOpenViewer` and the `DraggablePhoto.onOpen` call site; `buildAnnotatedPath(storagePath, token)` signature matches Task 1's export and Task 2's call; `PhotoViewer`/`PhotoAnnotator` prop names match the verified component signatures (`onUpdated`, `onAnnotate`, `onSaved`, `initialPhotoIndex`, `coverPhotoId`, `allTags`). ✓

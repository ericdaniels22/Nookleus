# Add-photos Dialog Viewer / Date Groups / Tag Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Photo Report builder's "+ Add Photos" picker into a small Photos tab: corner checkboxes (incl. per-day bulk select), date groups, a Tags filter + Newest/Oldest sort, and a click-to-view fullscreen view-only photo viewer.

**Architecture:** A new small `PickerPhotoViewer` component renders as a **nested Base UI Dialog** (this repo's `components/ui/dialog` is Base UI — `@base-ui/react/dialog` — **not** Radix/shadcn) so it escapes the picker popup's CSS-transform containing block AND stays interactive past Base UI's modal pointer-blocking. It reuses the three existing pure modules (`photo-zoom-transform`, `photo-viewer-navigation`, `photo-url`). The dialog itself gains grouping/filter/sort as local plain functions, keeps its ordered `string[]` selection (pick order = Section order = PDF numbering order), and the builder page threads a new optional `tags` prop down. Spec: `docs/superpowers/specs/2026-06-10-add-photos-dialog-viewer-design.md`.

**Tech Stack:** Next.js (App Router, see AGENTS.md warning), React 19, Base UI dialog, Tailwind, date-fns, Supabase JS, Vitest + React Testing Library (jsdom, **no jest-dom matchers** — use `toBeTruthy()`/`toBe()`/spies).

---

## Worker notes (read before Task 1)

- **The test suite, `tsc --noEmit`, and `npm run lint` are all known-red on clean main** (Node-25 localStorage artifact, flaky State-Farm tests, ~34 clustered tsc errors mostly PDF/`@react-pdf`, repo-wide `react-hooks/set-state-in-effect` lint). Verify only the files this plan touches add no new failures. The two test files this plan runs must be fully green.
- **Multi-agent repo:** branches move under you. Create a feature branch first (`git checkout -b feat/picker-viewer`) and re-check `git branch` before every commit.
- **Commit messages:** single-line `-m` is fine; for multi-line use `git commit -F <file>` (here-strings through the Bash tool mangle the subject).
- **Base UI, not Radix:** there is no `onEscapeKeyDown` prop. The dialog Root is `modal: true` by default (focus trap + scroll lock + outside pointer interactions disabled). Escape is handled by a **document-level** keydown listener (`useDismiss`), so `fireEvent.keyDown(document.body, { key: "Escape" })` works in jsdom.
- **AGENTS.md:** this Next.js version has breaking changes. Task 5 touches a server page but only changes Supabase query calls inside an existing, working server component — no Next.js API surface changes. If you must touch anything Next-specific beyond that, read the relevant guide in `node_modules/next/dist/docs/` first.

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/components/photo-report-picker-viewer.tsx` | Create | Fullscreen view-only viewer (nested Base UI dialog, zoom/nav/select) |
| `src/components/photo-report-picker-viewer.test.tsx` | Create | Viewer unit tests (standalone, controlled props) |
| `src/components/photo-report-add-photos-dialog.tsx` | Modify | Tiles → checkbox + body-click-view; date groups; Tags filter + sort; viewer wiring; Escape-layer guard |
| `src/components/photo-report-builder-desktop.test.tsx` | Modify | Rework 3 existing picker tests; add group/filter/sort/viewer/Escape tests |
| `src/components/photo-report-builder.tsx` | Modify | Thread `tags?: PhotoTag[]` through to the dialog |
| `src/app/jobs/[id]/reports/[reportId]/page.tsx` | Modify | Photo query joins `photo_tag_assignments(tag_id)`; new `photo_tags` fetch |

Names used consistently throughout (do not drift):

- testids: `picker-photo-${id}` (tile container `div`), `picker-select-${id}` (corner checkbox `button`), `viewer-select` (in-viewer checkbox), `picker-group-${yyyy-MM-dd}` (day `section`)
- aria-labels: `"View photo"`, `"Select photo"` / `"Deselect photo"`, `"Previous photo"`, `"Next photo"`, `"Zoom in"`, `"Zoom out"`, `"Close viewer"`, `"Photo viewer"` (the viewer dialog), `` `Select all photos from ${group.label}` ``
- exported types: `PickerPhotoViewerProps`, `PickerViewerStatus` (viewer file); `PickerPhoto` (dialog file, Task 4)

---

### Task 1: `PickerPhotoViewer` — the fullscreen view-only viewer

**Files:**
- Create: `src/components/photo-report-picker-viewer.test.tsx`
- Create: `src/components/photo-report-picker-viewer.tsx`

- [ ] **Step 1: Write the failing test file**

Create `src/components/photo-report-picker-viewer.test.tsx` with exactly:

```tsx
// The Add-photos picker's fullscreen viewer (view-only + select): a nested
// Base UI dialog showing the full-resolution photo, paging with buttons and
// Arrow keys over whatever flat list the picker hands it, zooming via the pure
// photo-zoom-transform module, and mirroring the picker's selection state.
// No jest-dom matchers (none configured) — toBeTruthy()/toBe()/spies.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import type { Photo } from "@/lib/types";
import {
  PickerPhotoViewer,
  type PickerPhotoViewerProps,
} from "./photo-report-picker-viewer";

function makePhoto(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption: null,
    width: 4000,
    height: 3000,
    created_at: "2026-06-09T10:00:00",
    ...overrides,
  } as Photo;
}

const photos = ["p1", "p2", "p3"].map((id) => makePhoto(id));

function renderViewer(overrides: Partial<PickerPhotoViewerProps> = {}) {
  const props: PickerPhotoViewerProps = {
    photos,
    index: 0,
    onIndexChange: vi.fn(),
    supabaseUrl: "https://example.supabase.co",
    selectedNumber: null,
    status: "free",
    onToggleSelect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<PickerPhotoViewer {...props} />);
  return props;
}

afterEach(() => cleanup());

describe("PickerPhotoViewer — rendering & navigation", () => {
  it("shows the photo full-resolution (object URL, not the grid render URL)", () => {
    renderViewer({ index: 1 });
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe(
      "https://example.supabase.co/storage/v1/object/public/photos/job-1/p2.jpg",
    );
  });

  it("renders as a dialog named 'Photo viewer' on a fullscreen black layer above the picker", () => {
    renderViewer();
    const dialog = screen.getByRole("dialog", { name: "Photo viewer" });
    expect(dialog.className).toContain("z-[90]");
    expect(dialog.className).toContain("bg-black");
  });

  it("hides Previous on the first photo and Next on the last; clicks page the index", () => {
    const first = renderViewer({ index: 0 });
    expect(screen.queryByRole("button", { name: "Previous photo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(first.onIndexChange).toHaveBeenCalledWith(1);
    cleanup();

    const last = renderViewer({ index: 2 });
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(last.onIndexChange).toHaveBeenCalledWith(1);
  });

  it("Arrow keys page the index", () => {
    const props = renderViewer({ index: 1 });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(props.onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(props.onIndexChange).toHaveBeenLastCalledWith(0);
  });
});

describe("PickerPhotoViewer — selection & close", () => {
  it("the corner checkbox mirrors the selection: empty when unselected, numbered when selected", () => {
    const props = renderViewer();
    const box = screen.getByTestId("viewer-select");
    expect(box.getAttribute("aria-pressed")).toBe("false");
    expect(box.textContent).toBe("");
    fireEvent.click(box);
    expect(props.onToggleSelect).toHaveBeenCalledWith("p1");
    cleanup();

    renderViewer({ selectedNumber: 3 });
    const numbered = screen.getByTestId("viewer-select");
    expect(numbered.getAttribute("aria-pressed")).toBe("true");
    expect(numbered.textContent).toBe("3");
  });

  it("an in-this-section photo shows the status and no checkbox; used-elsewhere shows both", () => {
    renderViewer({ status: "in-target" });
    expect(screen.getByText("In this section")).toBeTruthy();
    expect(screen.queryByTestId("viewer-select")).toBeNull();
    cleanup();

    renderViewer({ status: "elsewhere", elsewhereTitle: "Gutters" });
    expect(screen.getByText("In Gutters")).toBeTruthy();
    expect(screen.getByTestId("viewer-select")).toBeTruthy();
  });

  it("✕ and Escape both close", () => {
    const props = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    // Base UI's useDismiss listens for Escape at the document level; the
    // nested dialog's onOpenChange(false) is the close path.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});

describe("PickerPhotoViewer — zoom", () => {
  // jsdom gives every element a 0×0 rect; the zoom math needs a real viewport.
  // Stub a 1000×800 surface (origin 0,0) so focal points equal clientX/clientY,
  // and the 4000×3000 photo fits at scale 0.25 (fitted 1000×750). Mirrors
  // photo-viewer.test.tsx's zoom describe.
  let rectSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({
        width: 1000,
        height: 800,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
  });
  afterEach(() => rectSpy.mockRestore());

  const img = () => screen.getByRole("img") as HTMLImageElement;
  const scaleOf = (el: HTMLElement) => {
    const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 1;
  };
  const offsetXOf = (el: HTMLElement) => {
    const m = /translate\((-?[\d.]+)px/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 0;
  };

  it("＋ magnifies; − is disabled at fit and brings a zoomed photo back", () => {
    renderViewer();
    expect(scaleOf(img())).toBe(1);
    const zoomOut = () =>
      screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement;
    expect(zoomOut().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomedIn = scaleOf(img());
    expect(zoomedIn).toBeGreaterThan(1);
    expect(zoomOut().disabled).toBe(false);

    fireEvent.click(zoomOut());
    expect(scaleOf(img())).toBeLessThan(zoomedIn);
  });

  it("scroll-wheel up magnifies about the cursor", () => {
    renderViewer();
    fireEvent.wheel(img(), { deltaY: -200, clientX: 500, clientY: 400 });
    expect(scaleOf(img())).toBeGreaterThan(1);
  });

  it("double-click snaps to zoomed, and again back to fit", () => {
    renderViewer();
    fireEvent.doubleClick(img(), { clientX: 500, clientY: 400 });
    expect(scaleOf(img())).toBe(2);
    fireEvent.doubleClick(img(), { clientX: 500, clientY: 400 });
    expect(scaleOf(img())).toBe(1);
  });

  it("drag pans only when zoomed", () => {
    renderViewer();

    // At fit, dragging does nothing.
    fireEvent.mouseDown(img(), { clientX: 500, clientY: 400 });
    fireEvent.mouseMove(img(), { clientX: 450, clientY: 400 });
    fireEvent.mouseUp(img());
    expect(offsetXOf(img())).toBe(0);

    // Zoomed (1.5× of fit → 1500×1125 in a 1000×800 viewport), a 50px-left
    // drag pans the image.
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.mouseDown(img(), { clientX: 500, clientY: 400 });
    fireEvent.mouseMove(img(), { clientX: 450, clientY: 400 });
    expect(offsetXOf(img())).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/photo-report-picker-viewer.test.tsx`
Expected: FAIL — `Failed to resolve import "./photo-report-picker-viewer"` (the component doesn't exist yet).

- [ ] **Step 3: Write the component**

Create `src/components/photo-report-picker-viewer.tsx` with exactly:

```tsx
"use client";

// The Add-photos picker's fullscreen viewer: view-only + select. NOT a
// modification or extraction of the 1500-line PhotoViewer (two consumers;
// the shared logic already lives in pure modules — third-consumer heuristic).
// See docs/superpowers/specs/2026-06-10-add-photos-dialog-viewer-design.md §4.
//
// Rendered as a NESTED Base UI dialog: the picker dialog's popup centres
// itself with a CSS translate transform (a transformed ancestor would become
// the containing block for a `fixed` element rendered inline), and the picker
// dialog is modal — Base UI disables pointer interaction on everything outside
// its own dialog stack, so a plain createPortal(document.body) overlay would
// paint but never receive clicks. A nested Root + Portal + Popup escapes the
// transform, stays interactive, and takes over the focus trap while open.
// As the topmost dialog in the stack it also receives Escape first.

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/jobs/photo-url";
import {
  FIT,
  ZOOM_STEP,
  doubleTap,
  pan,
  zoomBy,
  type Focal,
  type Transform,
  type ViewportContext,
} from "@/lib/jobs/photo-zoom-transform";
import {
  hasNext,
  hasPrev,
  nextPhotoIndex,
  prevPhotoIndex,
} from "@/lib/jobs/photo-viewer-navigation";
import type { Photo } from "@/lib/types";

export type PickerViewerStatus = "free" | "in-target" | "elsewhere";

export interface PickerPhotoViewerProps {
  /** The filtered + sorted flat list the picker grid currently shows. */
  photos: Photo[];
  /** Index of the photo on screen, within `photos`. */
  index: number;
  onIndexChange: (index: number) => void;
  supabaseUrl: string;
  /** 1-based pick number when the photo is selected, else null. */
  selectedNumber: number | null;
  status: PickerViewerStatus;
  /** The other Section's title when status is "elsewhere". */
  elsewhereTitle?: string;
  onToggleSelect: (photoId: string) => void;
  onClose: () => void;
}

export function PickerPhotoViewer({
  photos,
  index,
  onIndexChange,
  supabaseUrl,
  selectedNumber,
  status,
  elsewhereTitle,
  onToggleSelect,
  onClose,
}: PickerPhotoViewerProps) {
  const photo = photos[index];

  const [transform, setTransform] = useState<Transform>(FIT);
  // Fresh photo, fresh framing — adjusted during render (not an effect) so
  // the old photo's zoom never paints on the new one.
  const [transformPhotoId, setTransformPhotoId] = useState<string | undefined>(
    photo?.id,
  );
  if (photo && photo.id !== transformPhotoId) {
    setTransformPhotoId(photo.id);
    setTransform(FIT);
  }

  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const isZoomed = transform.scale > 1;

  // Arrow keys page through the same list the grid shows. Escape is the
  // nested dialog's own dismissal (topmost in the Base UI stack).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        onIndexChange(nextPhotoIndex(index, photos.length));
      } else if (e.key === "ArrowLeft") {
        onIndexChange(prevPhotoIndex(index));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, photos.length, onIndexChange]);

  function viewportCtx(): ViewportContext | null {
    const el = surfaceRef.current;
    if (!el || !photo) return null;
    const rect = el.getBoundingClientRect();
    const imageW = photo.width ?? imgRef.current?.naturalWidth ?? rect.width;
    const imageH = photo.height ?? imgRef.current?.naturalHeight ?? rect.height;
    if (!rect.width || !rect.height || !imageW || !imageH) return null;
    return { imageW, imageH, viewportW: rect.width, viewportH: rect.height };
  }

  function focalFrom(clientX: number, clientY: number): Focal {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  const viewportCentre = (ctx: ViewportContext): Focal => ({
    x: ctx.viewportW / 2,
    y: ctx.viewportH / 2,
  });

  function zoomStep(direction: 1 | -1) {
    const ctx = viewportCtx();
    if (!ctx) return;
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setTransform((t) => zoomBy(t, factor, viewportCentre(ctx), ctx));
  }

  function onWheel(e: React.WheelEvent) {
    const ctx = viewportCtx();
    if (!ctx) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setTransform((t) => zoomBy(t, factor, focalFrom(e.clientX, e.clientY), ctx));
  }

  function onDoubleClick(e: React.MouseEvent) {
    const ctx = viewportCtx();
    if (!ctx) return;
    setTransform((t) => doubleTap(t, focalFrom(e.clientX, e.clientY), ctx));
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!isZoomed) return;
    dragOrigin.current = { x: e.clientX, y: e.clientY };
  }

  function onMouseMove(e: React.MouseEvent) {
    const origin = dragOrigin.current;
    if (!origin) return;
    const ctx = viewportCtx();
    if (!ctx) return;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    dragOrigin.current = { x: e.clientX, y: e.clientY };
    setTransform((t) => pan(t, dx, dy, ctx));
  }

  function endDrag() {
    dragOrigin.current = null;
  }

  if (!photo) return null;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label="Photo viewer"
          className="fixed inset-0 z-[90] flex flex-col bg-black outline-none"
        >
          <div className="flex items-center justify-end gap-3 p-3">
            {status === "in-target" ? (
              <span className="text-sm text-white/80">In this section</span>
            ) : (
              <>
                {status === "elsewhere" && (
                  <span className="text-sm text-white/80">
                    In {elsewhereTitle}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="viewer-select"
                  aria-pressed={selectedNumber !== null}
                  aria-label={
                    selectedNumber !== null ? "Deselect photo" : "Select photo"
                  }
                  onClick={() => onToggleSelect(photo.id)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold",
                    selectedNumber !== null
                      ? "bg-primary text-primary-foreground"
                      : "border-2 border-white/80 bg-black/30",
                  )}
                >
                  {selectedNumber}
                </button>
              </>
            )}
            <button
              type="button"
              aria-label="Close viewer"
              onClick={onClose}
              className="rounded-full p-2 text-white/90 hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>

          <div
            ref={surfaceRef}
            className="relative flex flex-1 items-center justify-center overflow-hidden"
            onWheel={onWheel}
            onDoubleClick={onDoubleClick}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            style={{ cursor: isZoomed ? "grab" : undefined }}
          >
            <img
              ref={imgRef}
              src={photoUrl(photo, supabaseUrl, "full")}
              alt={photo.caption || "Photo"}
              className="max-h-full max-w-full object-contain"
              style={{
                transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
                transformOrigin: "center center",
              }}
              draggable={false}
            />

            {hasPrev(index) && (
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => onIndexChange(prevPhotoIndex(index))}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            {hasNext(index, photos.length) && (
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => onIndexChange(nextPhotoIndex(index, photos.length))}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronRight size={24} />
              </button>
            )}

            <div className="absolute bottom-3 left-3 flex flex-col gap-2">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => zoomStep(1)}
                className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ZoomIn size={18} />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                disabled={!isZoomed}
                onClick={() => zoomStep(-1)}
                className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 disabled:opacity-40"
              >
                <ZoomOut size={18} />
              </button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/photo-report-picker-viewer.test.tsx`
Expected: PASS — 11 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/components/photo-report-picker-viewer.tsx src/components/photo-report-picker-viewer.test.tsx
git commit -m "feat(photo-report): PickerPhotoViewer — fullscreen view-only viewer for the Add-photos picker"
```

---

### Task 2: Tile rework — corner checkbox, body-click opens the viewer, Escape layering

**Files:**
- Modify: `src/components/photo-report-add-photos-dialog.tsx`
- Modify: `src/components/photo-report-builder-desktop.test.tsx` (the `+ Add Photos picker (#552)` describe, currently lines 531–641)

The tile changes from "whole tile = toggle button" to a container with two
affordances: a top-right checkbox button that toggles selection, and a body
button that opens the viewer. "In this section" photos lose the checkbox (and
the old `disabled` attribute — the body stays clickable for viewing) but keep
the dimming and label.

- [ ] **Step 1: Rewrite the three existing picker tests and add three viewer tests**

In `src/components/photo-report-builder-desktop.test.tsx`, inside
`describe("PhotoReportBuilder — + Add Photos picker (#552)", ...)`, replace the
three existing `it(...)` blocks (keep `pickerReport`, `jobPhotos`,
`openPickerFor` as they are) with:

```tsx
  it("lists the Job's photos, marking in-this-section (dimmed, no checkbox) and used-elsewhere", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0); // Roof

    // The dialog portal renders into document.body, so screen finds it.
    expect(screen.getByText("Add photos")).toBeTruthy();

    // Already in the target Section: dimmed, no selection checkbox — it is
    // already exactly where the picker would put it. Still viewable.
    const p1 = screen.getByTestId("picker-photo-p1");
    expect(p1.className).toContain("opacity-50");
    expect(within(p1).queryByTestId("picker-select-p1")).toBeNull();
    expect(within(p1).getByText("In this section")).toBeTruthy();
    expect(within(p1).getByRole("button", { name: "View photo" })).toBeTruthy();

    // Used in another Section: selectable, marked with that Section's name.
    const p2 = screen.getByTestId("picker-photo-p2");
    expect(within(p2).getByTestId("picker-select-p2")).toBeTruthy();
    expect(within(p2).getByText("In Gutters")).toBeTruthy();

    // Not in the report: no marking.
    const p3 = screen.getByTestId("picker-photo-p3");
    expect(within(p3).queryByText(/^In /)).toBeNull();
  });

  it("multi-adds the selection in pick order — moving a used-elsewhere photo, no duplicates — and autosaves once", async () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0); // Roof

    // The footer button counts the selection and is disabled at zero.
    const addSelection = () =>
      screen.getByRole("button", {
        name: /add \d+ photos?/i,
      }) as HTMLButtonElement;
    expect(addSelection().disabled).toBe(true);

    // Pick p3, then p2 (currently in Gutters), then p4 via the corner
    // checkboxes — order matters: it is the append order, hence the PDF
    // numbering order.
    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(screen.getByTestId("picker-select-p2"));
    fireEvent.click(screen.getByTestId("picker-select-p4"));
    expect(
      screen.getByTestId("picker-select-p2").getAttribute("aria-pressed"),
    ).toBe("true");
    // The checkbox carries the pick number.
    expect(screen.getByTestId("picker-select-p3").textContent).toBe("1");
    expect(screen.getByTestId("picker-select-p2").textContent).toBe("2");
    expect(addSelection().textContent).toContain("Add 3 photos");

    fireEvent.click(addSelection());

    // The dialog closes (it only mounts while open)…
    expect(screen.queryByText("Add photos")).toBeNull();

    // …and the single dispatch autosaves once: Roof appends in pick order and
    // Gutters lost p2 — the one-Section invariant, no duplicates.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: Array<{ title: string; photo_ids: string[] }>;
    };
    expect(payload.sections[0].photo_ids).toEqual(["p1", "p3", "p2", "p4"]);
    expect(payload.sections[1].photo_ids).toEqual([]);
  });

  it("Cancel closes without dispatching, and a reopened picker starts with a fresh selection", async () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Add photos")).toBeNull();

    // No edit was made, so nothing autosaves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).not.toHaveBeenCalled();

    // The dialog mounts per open, so the abandoned selection is gone.
    openPickerFor(0);
    expect(
      screen.getByTestId("picker-select-p3").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("clicking the photo body opens the fullscreen viewer at that photo", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(
      within(screen.getByTestId("picker-photo-p3")).getByRole("button", {
        name: "View photo",
      }),
    );

    const viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    const img = within(viewer).getByRole("img") as HTMLImageElement;
    expect(img.src).toContain(
      "/storage/v1/object/public/photos/job-1/p3.jpg",
    );
  });

  it("the in-viewer checkbox drives the same selection the grid shows", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(
      within(screen.getByTestId("picker-photo-p3")).getByRole("button", {
        name: "View photo",
      }),
    );
    fireEvent.click(screen.getByTestId("viewer-select"));
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));

    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();
    expect(
      screen.getByTestId("picker-select-p3").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /add \d+ photos?/i }).textContent,
    ).toContain("Add 1 photo");
  });

  it("un-checking an earlier pick renumbers the later ones (ordered-selection regression guard)", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(screen.getByTestId("picker-select-p4"));
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("1");
  });

  it("Escape closes the viewer first, the dialog second", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);
    fireEvent.click(
      within(screen.getByTestId("picker-photo-p4")).getByRole("button", {
        name: "View photo",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Photo viewer" })).toBeTruthy();

    // Base UI listens for Escape on the document. The viewer (topmost dialog)
    // takes the first one; the picker's onOpenChange guard converts any close
    // request that falls through into "close the viewer" instead.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();
    expect(screen.getByText("Add photos")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Add photos")).toBeNull();
  });
```

- [ ] **Step 2: Run to verify the new/changed tests fail**

Run: `npx vitest run src/components/photo-report-builder-desktop.test.tsx`
Expected: FAIL — the rewritten picker tests fail with `Unable to find an element by: [data-testid="picker-select-p3"]` (and similar); tests outside the picker describe still pass.

- [ ] **Step 3: Rework the dialog**

Replace the **entire contents** of `src/components/photo-report-add-photos-dialog.tsx` with:

```tsx
"use client";

// Issue #552 — Photo Report builder: the "+ Add Photos" picker.
//
// The desktop replacement for the always-visible drag tray: a modal listing ALL
// of the Job's photos, from which the author multi-selects to drop into the
// Section they are editing. A photo already in that Section is unselectable (it
// is already exactly where the picker would put it); a photo used in ANOTHER
// Section is selectable but marked with that Section's name — adding it moves
// it here (the one-Section invariant: a photo lives in at most one Section, so
// `addPhotosToSection` dedupes by removing it from wherever else it lived).
//
// Selection is kept as an ordered array, not a Set: the reducer appends in
// selection order, so the order the author picks in is the order the photos
// land in (and the order the PDF numbers them).
//
// Each tile has two affordances (spec: docs/superpowers/specs/
// 2026-06-10-add-photos-dialog-viewer-design.md): a top-right checkbox that
// toggles selection, and the photo body, which opens the fullscreen
// PickerPhotoViewer (a NESTED Base UI dialog — see that file's header).

import { useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/jobs/photo-url";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PickerPhotoViewer } from "@/components/photo-report-picker-viewer";
import type { ReportSection } from "@/lib/build-initial-sections";
import type { Photo } from "@/lib/types";

export interface AddPhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All of the Job's photos, in the Job's order (newest first). */
  photos: Photo[];
  /** The report's live Sections, for marking photos already used. */
  sections: ReportSection[];
  /** The Section the picker adds into. */
  sectionIndex: number;
  supabaseUrl: string;
  /** Hand the selection (in pick order) back to the builder to dispatch. */
  onAdd: (photoIds: string[]) => void;
}

export function AddPhotosDialog({
  open,
  onOpenChange,
  photos,
  sections,
  sectionIndex,
  supabaseUrl,
  onAdd,
}: AddPhotosDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  // Index into the visible flat list of the photo open fullscreen; null = grid.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const target = sections[sectionIndex];
  const targetTitle = target?.title || "Untitled section";
  const inTarget = new Set(target?.photo_ids ?? []);
  // photoId → the title of the OTHER Section currently holding it.
  const usedElsewhere = new Map<string, string>();
  sections.forEach((section, i) => {
    if (i === sectionIndex) return;
    for (const id of section.photo_ids) {
      usedElsewhere.set(id, section.title || "Untitled section");
    }
  });

  function toggle(photoId: string) {
    setSelected((prev) =>
      prev.includes(photoId)
        ? prev.filter((id) => id !== photoId)
        : [...prev, photoId],
    );
  }

  // The flat list the grid and the viewer both show (the Tags filter + sort
  // toolbar will derive this; for now it is the Job's photos as supplied).
  const visiblePhotos = photos;
  const viewerPhoto = viewerIndex !== null ? visiblePhotos[viewerIndex] : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape layering: while the viewer is open, any close request aimed
        // at the picker (an Escape falling through the dialog stack, an
        // outside press) closes the viewer instead — the first Escape can
        // never close the dialog. A second Escape (or ✕ / Cancel) then can.
        if (!next && viewerIndex !== null) {
          setViewerIndex(null);
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add photos</DialogTitle>
          <DialogDescription>
            Select photos to add to “{targetTitle}”. A photo used in another
            section moves here.
          </DialogDescription>
        </DialogHeader>

        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No photos on this job yet.
          </p>
        ) : (
          <div className="grid max-h-[55vh] grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 overflow-y-auto">
            {visiblePhotos.map((photo) => {
              const isInTarget = inTarget.has(photo.id);
              const elsewhere = usedElsewhere.get(photo.id);
              const isSelected = selected.includes(photo.id);
              return (
                <div
                  key={photo.id}
                  data-testid={`picker-photo-${photo.id}`}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-lg",
                    isSelected && "ring-2 ring-primary",
                    isInTarget && "opacity-50",
                  )}
                >
                  <button
                    type="button"
                    aria-label="View photo"
                    onClick={() =>
                      setViewerIndex(
                        visiblePhotos.findIndex((p) => p.id === photo.id),
                      )
                    }
                    className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <img
                      src={photoUrl(photo, supabaseUrl, "grid")}
                      alt={photo.caption || "Photo"}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  {!isInTarget && (
                    <button
                      type="button"
                      data-testid={`picker-select-${photo.id}`}
                      aria-pressed={isSelected}
                      aria-label={isSelected ? "Deselect photo" : "Select photo"}
                      onClick={() => toggle(photo.id)}
                      className={cn(
                        "absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "border-2 border-white/80 bg-black/30",
                      )}
                    >
                      {isSelected ? selected.indexOf(photo.id) + 1 : null}
                    </button>
                  )}
                  {/* Used-elsewhere marking: which Section holds it now. */}
                  {isInTarget ? (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                      In this section
                    </span>
                  ) : elsewhere ? (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                      In {elsewhere}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => onAdd(selected)}
            className="gap-1.5"
          >
            <Plus size={14} />
            Add {selected.length} photo{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>

        {viewerIndex !== null && viewerPhoto && (
          <PickerPhotoViewer
            photos={visiblePhotos}
            index={viewerIndex}
            onIndexChange={setViewerIndex}
            supabaseUrl={supabaseUrl}
            selectedNumber={
              selected.includes(viewerPhoto.id)
                ? selected.indexOf(viewerPhoto.id) + 1
                : null
            }
            status={
              inTarget.has(viewerPhoto.id)
                ? "in-target"
                : usedElsewhere.has(viewerPhoto.id)
                  ? "elsewhere"
                  : "free"
            }
            elsewhereTitle={usedElsewhere.get(viewerPhoto.id)}
            onToggleSelect={toggle}
            onClose={() => setViewerIndex(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/photo-report-builder-desktop.test.tsx src/components/photo-report-picker-viewer.test.tsx`
Expected: PASS — every test in both files green (the picker describe now has 7 tests).

If "Escape closes the viewer first…" fails on the **second** Escape (dialog
not closing), the picker dialog's own Base UI dismissal isn't firing — check
that the guard in `onOpenChange` returns early ONLY when `viewerIndex !== null`
and otherwise calls `onOpenChange(next)` through to the builder.

- [ ] **Step 5: Commit**

```bash
git add src/components/photo-report-add-photos-dialog.tsx src/components/photo-report-builder-desktop.test.tsx
git commit -m "feat(photo-report): picker tiles — corner select checkbox + body click opens fullscreen viewer"
```

---

### Task 3: Date groups with bulk-select day checkboxes

**Files:**
- Modify: `src/components/photo-report-builder-desktop.test.tsx`
- Modify: `src/components/photo-report-add-photos-dialog.tsx`

- [ ] **Step 1: Give test photos a `created_at` and write the failing group tests**

In `src/components/photo-report-builder-desktop.test.tsx`, replace the
`makePhoto` helper:

```tsx
function makePhoto(id: string, createdAt = "2026-06-04T12:00:00"): Photo {
  return {
    id,
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption: null,
    created_at: createdAt,
  } as Photo;
}
```

(Local-time ISO strings — no trailing `Z` — keep the day-grouping assertions
timezone-independent. Every existing call still compiles via the default.)

Then add these tests at the END of the `+ Add Photos picker (#552)` describe
(after the Escape test from Task 2):

```tsx
  it("groups photos under day headers", () => {
    const photos = [
      makePhoto("p1", "2026-06-09T10:00:00"),
      makePhoto("p2", "2026-06-09T09:00:00"),
      makePhoto("p3", "2026-06-08T15:00:00"),
      makePhoto("p4", "2026-06-08T14:00:00"),
    ];
    renderBuilder(pickerReport(), photos);
    openPickerFor(0);

    const tuesday = screen.getByTestId("picker-group-2026-06-09");
    expect(within(tuesday).getByText("Tuesday, June 9th, 2026")).toBeTruthy();
    expect(within(tuesday).getByTestId("picker-photo-p1")).toBeTruthy();
    expect(within(tuesday).getByTestId("picker-photo-p2")).toBeTruthy();

    const monday = screen.getByTestId("picker-group-2026-06-08");
    expect(within(monday).getByText("Monday, June 8th, 2026")).toBeTruthy();
    expect(within(monday).getByTestId("picker-photo-p3")).toBeTruthy();
    expect(within(monday).getByTestId("picker-photo-p4")).toBeTruthy();
  });

  it("the group checkbox bulk-selects the day's selectable photos in grid order and unselects on second click", () => {
    // All four photos share the default day; p1 is in Roof (the target),
    // p2 in Gutters.
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    const groupCheckbox = () =>
      screen.getByRole("checkbox", {
        name: /select all photos from/i,
      }) as HTMLInputElement;
    expect(groupCheckbox().checked).toBe(false);

    fireEvent.click(groupCheckbox());

    // p1 is "in this section" — excluded; the rest append in grid order.
    expect(screen.getByTestId("picker-select-p2").textContent).toBe("1");
    expect(screen.getByTestId("picker-select-p3").textContent).toBe("2");
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("3");
    expect(groupCheckbox().checked).toBe(true);

    fireEvent.click(groupCheckbox());
    expect(
      screen.getByTestId("picker-select-p2").getAttribute("aria-pressed"),
    ).toBe("false");
    const footer = screen.getByRole("button", {
      name: /add \d+ photos?/i,
    }) as HTMLButtonElement;
    expect(footer.disabled).toBe(true);
  });

  it("a day-check appends only the day's unselected photos, keeping earlier picks' numbers", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /select all photos from/i }),
    );

    // A day-check acts like clicking each unselected photo left to right:
    // p3 keeps its number, p2 and p4 append after it.
    expect(screen.getByTestId("picker-select-p3").textContent).toBe("1");
    expect(screen.getByTestId("picker-select-p2").textContent).toBe("2");
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("3");
  });

  it("a day whose photos are all in this section gets a disabled group checkbox", () => {
    const report = makeReport({
      sections: [
        { id: "sec-a", title: "Roof", description: "", photo_ids: ["p1", "p2"] },
        { id: "sec-b", title: "Gutters", description: "", photo_ids: [] },
      ],
    });
    renderBuilder(report, ["p1", "p2"].map((id) => makePhoto(id)));
    openPickerFor(0);

    const box = screen.getByRole("checkbox", {
      name: /select all photos from/i,
    }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/components/photo-report-builder-desktop.test.tsx`
Expected: FAIL — the four new tests fail with `Unable to find an element by: [data-testid="picker-group-2026-06-09"]` / no checkbox named `/select all photos from/i`. All Task-2 tests still pass.

- [ ] **Step 3: Implement date groups in the dialog**

Four edits to `src/components/photo-report-add-photos-dialog.tsx`:

**(a)** Add the `format` import after the react import:

```tsx
import { useState } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
```

**(b)** Add the grouping helper and group-toggle logic. Immediately ABOVE
`export interface AddPhotosDialogProps` insert:

```tsx
// One calendar day of photos, in grid order. Keyed/labelled exactly like the
// Photos tab (job-photos-tab.tsx): key "yyyy-MM-dd", header "EEEE, MMMM do,
// yyyy". Local to the dialog — promote to @/lib/jobs/ only if a third
// consumer appears.
interface PhotoGroup {
  date: string;
  label: string;
  photos: Photo[];
}

function groupByDay(photos: Photo[]): PhotoGroup[] {
  return photos.reduce<PhotoGroup[]>((groups, photo) => {
    const dateKey = format(new Date(photo.created_at), "yyyy-MM-dd");
    const existing = groups.find((g) => g.date === dateKey);
    if (existing) {
      existing.photos.push(photo);
    } else {
      groups.push({
        date: dateKey,
        label: format(new Date(photo.created_at), "EEEE, MMMM do, yyyy"),
        photos: [photo],
      });
    }
    return groups;
  }, []);
}
```

**(c)** Add the group toggle inside the component, right after the `toggle`
function:

```tsx
  // A day-check acts like clicking each of the day's unselected photos left
  // to right: append in grid order, preserving everyone's existing pick
  // numbers (ordered-selection semantics). Unchecking removes the day's
  // selectable photos wherever they sit in the pick order.
  function toggleGroup(groupPhotos: Photo[]) {
    const selectable = groupPhotos.filter((p) => !inTarget.has(p.id));
    const allSelected =
      selectable.length > 0 && selectable.every((p) => selected.includes(p.id));
    if (allSelected) {
      const dayIds = new Set(selectable.map((p) => p.id));
      setSelected((prev) => prev.filter((id) => !dayIds.has(id)));
    } else {
      setSelected((prev) => [
        ...prev,
        ...selectable.map((p) => p.id).filter((id) => !prev.includes(id)),
      ]);
    }
  }
```

**(d)** Replace the grid block — everything from
`<div className="grid max-h-[55vh] grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 overflow-y-auto">`
through its closing `</div>` (the `:` branch of the `photos.length === 0`
ternary) — with a grouped layout. The tile JSX inside `group.photos.map` is
**identical to Task 2's** except the map source changes from
`visiblePhotos.map` to `group.photos.map`:

```tsx
          <div className="max-h-[55vh] space-y-4 overflow-y-auto">
            {groupByDay(visiblePhotos).map((group) => {
              const selectable = group.photos.filter(
                (p) => !inTarget.has(p.id),
              );
              const allSelected =
                selectable.length > 0 &&
                selectable.every((p) => selected.includes(p.id));
              return (
                <section key={group.date} data-testid={`picker-group-${group.date}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">
                      {group.label}
                    </h3>
                    <input
                      type="checkbox"
                      aria-label={`Select all photos from ${group.label}`}
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      onChange={() => toggleGroup(group.photos)}
                      className="rounded disabled:opacity-40"
                    />
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                    {group.photos.map((photo) => {
                      const isInTarget = inTarget.has(photo.id);
                      const elsewhere = usedElsewhere.get(photo.id);
                      const isSelected = selected.includes(photo.id);
                      return (
                        <div
                          key={photo.id}
                          data-testid={`picker-photo-${photo.id}`}
                          className={cn(
                            "group relative aspect-square overflow-hidden rounded-lg",
                            isSelected && "ring-2 ring-primary",
                            isInTarget && "opacity-50",
                          )}
                        >
                          <button
                            type="button"
                            aria-label="View photo"
                            onClick={() =>
                              setViewerIndex(
                                visiblePhotos.findIndex(
                                  (p) => p.id === photo.id,
                                ),
                              )
                            }
                            className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <img
                              src={photoUrl(photo, supabaseUrl, "grid")}
                              alt={photo.caption || "Photo"}
                              className="h-full w-full object-cover"
                            />
                          </button>
                          {!isInTarget && (
                            <button
                              type="button"
                              data-testid={`picker-select-${photo.id}`}
                              aria-pressed={isSelected}
                              aria-label={
                                isSelected ? "Deselect photo" : "Select photo"
                              }
                              onClick={() => toggle(photo.id)}
                              className={cn(
                                "absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "border-2 border-white/80 bg-black/30",
                              )}
                            >
                              {isSelected
                                ? selected.indexOf(photo.id) + 1
                                : null}
                            </button>
                          )}
                          {/* Used-elsewhere marking: which Section holds it now. */}
                          {isInTarget ? (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                              In this section
                            </span>
                          ) : elsewhere ? (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                              In {elsewhere}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
```

**(e)** Widen the dialog for the grouped layout — in the same file change:

```tsx
      <DialogContent className="sm:max-w-2xl">
```

to:

```tsx
      <DialogContent className="sm:max-w-4xl">
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/photo-report-builder-desktop.test.tsx src/components/photo-report-picker-viewer.test.tsx`
Expected: PASS — all tests green (the picker describe now has 11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/photo-report-add-photos-dialog.tsx src/components/photo-report-builder-desktop.test.tsx
git commit -m "feat(photo-report): picker date groups with bulk-select day checkboxes"
```

---

### Task 4: Tags filter + Newest/Oldest sort toggle

**Files:**
- Modify: `src/components/photo-report-builder-desktop.test.tsx`
- Modify: `src/components/photo-report-add-photos-dialog.tsx`
- Modify: `src/components/photo-report-builder.tsx`

Semantics (spec §1): any-of tag matching, client-side on
`photo.photo_tag_assignments[].tag_id`; no tags checked = all photos show; the
sort toggle reverses the supplied (newest-first) order; **filters never clear
the selection** — a hidden selected photo stays in `selected` and is still
added.

- [ ] **Step 1: Write the failing filter/sort tests**

In `src/components/photo-report-builder-desktop.test.tsx`:

**(a)** Extend the types import (line 27):

```tsx
import type { Photo, PhotoReport, PhotoTag } from "@/lib/types";
```

**(b)** Replace `renderBuilder` with a version that threads tags:

```tsx
function renderBuilder(
  report = makeReport(),
  photos: Photo[] = [],
  tags: PhotoTag[] = [],
) {
  return render(
    <PhotoReportBuilder
      jobId="job-1"
      report={report}
      photos={photos}
      supabaseUrl="https://example.supabase.co"
      tags={tags}
    />,
  );
}
```

**(c)** Inside the `+ Add Photos picker (#552)` describe, after the
`jobPhotos` const, add the tag fixtures:

```tsx
  const orgTags: PhotoTag[] = [
    {
      id: "tag-red",
      organization_id: "org-1",
      name: "Damage",
      color: "#ef4444",
      created_by: "u-1",
      created_at: "2026-06-01T00:00:00Z",
    },
    {
      id: "tag-blue",
      organization_id: "org-1",
      name: "Repaired",
      color: "#3b82f6",
      created_by: "u-1",
      created_at: "2026-06-01T00:00:00Z",
    },
  ];

  // The page's join shape: the photo carries its tag assignment ids.
  function withTags(photo: Photo, ...tagIds: string[]): Photo {
    return {
      ...photo,
      photo_tag_assignments: tagIds.map((tag_id) => ({ tag_id })),
    } as Photo;
  }
```

**(d)** Add these tests at the end of the picker describe:

```tsx
  it("renders no Tags dropdown when the Organization has no tags", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);
    expect(screen.queryByRole("button", { name: /^Tags/ })).toBeNull();
  });

  it("tag filter hides non-matching photos but keeps the hidden selection for Add", async () => {
    const photos = [
      makePhoto("p1"),
      makePhoto("p2"),
      withTags(makePhoto("p3"), "tag-red"),
      makePhoto("p4"),
    ];
    renderBuilder(pickerReport(), photos, orgTags);
    openPickerFor(0);

    // Select p4 BEFORE filtering.
    fireEvent.click(screen.getByTestId("picker-select-p4"));

    // Filter to "Damage": only p3 carries it. (The dropdown is CSS-gated —
    // hidden until hover/focus-within — but jsdom ignores CSS, so the
    // checkbox is reachable directly.)
    fireEvent.click(screen.getByRole("checkbox", { name: "Damage" }));
    expect(screen.queryByTestId("picker-photo-p4")).toBeNull();
    expect(screen.getByTestId("picker-photo-p3")).toBeTruthy();

    // The hidden selection survives the filter (selection is a cart, not a
    // transient bulk-action target — unlike the Photos tab, on purpose)…
    fireEvent.click(screen.getByTestId("picker-select-p3"));
    const addSelection = screen.getByRole("button", {
      name: /add \d+ photos?/i,
    });
    expect(addSelection.textContent).toContain("Add 2 photos");

    // …and Add hands back both, in pick order.
    fireEvent.click(addSelection);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: Array<{ photo_ids: string[] }>;
    };
    expect(payload.sections[0].photo_ids).toEqual(["p1", "p4", "p3"]);
  });

  it("the sort toggle reverses group order", () => {
    const photos = [
      makePhoto("p1", "2026-06-09T10:00:00"),
      makePhoto("p2", "2026-06-08T10:00:00"),
    ];
    renderBuilder(makeReport(), photos);
    openPickerFor(0);

    const groupIds = () =>
      screen
        .getAllByTestId(/^picker-group-/)
        .map((el) => el.getAttribute("data-testid"));
    expect(groupIds()).toEqual([
      "picker-group-2026-06-09",
      "picker-group-2026-06-08",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Newest first" }));
    expect(screen.getByRole("button", { name: "Oldest first" })).toBeTruthy();
    expect(groupIds()).toEqual([
      "picker-group-2026-06-08",
      "picker-group-2026-06-09",
    ]);
  });

  it("the viewer pages through the filtered list only", () => {
    const photos = [
      withTags(makePhoto("p1"), "tag-red"),
      makePhoto("p2"),
      withTags(makePhoto("p3"), "tag-red"),
    ];
    renderBuilder(makeReport(), photos, orgTags);
    openPickerFor(0);

    fireEvent.click(screen.getByRole("checkbox", { name: "Damage" }));
    fireEvent.click(
      within(screen.getByTestId("picker-photo-p1")).getByRole("button", {
        name: "View photo",
      }),
    );

    // ArrowRight lands on p3 — p2 is filtered out of the flip-through list.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    const img = within(viewer).getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("job-1/p3.jpg");
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/components/photo-report-builder-desktop.test.tsx`
Expected: FAIL — the four new tests fail (`Unable to find an accessible element with the role "checkbox" and name "Damage"`, no button named "Newest first", `picker-photo-p4` still present under the filter). Note: Vitest does not type-check, and React silently ignores the not-yet-existing `tags` prop, so the failures are these missing-UI ones, not a prop error. Tasks 2–3 tests still pass.

- [ ] **Step 3: Thread `tags` through the builder**

Three edits to `src/components/photo-report-builder.tsx`:

**(a)** Line 61, extend the types import:

```tsx
import type { Photo, PhotoReport, PhotoTag, ReportPhotosPerPage } from "@/lib/types";
```

**(b)** In `interface PhotoReportBuilderProps` (line 110), after the
`jobCoverPhotoId` member add:

```tsx
  /**
   * The Organization's photo-tag vocabulary, for the picker's Tags filter.
   * Optional and defaults to empty so existing call sites and tests keep
   * compiling; with no tags the picker renders no Tags dropdown at all.
   */
  tags?: PhotoTag[];
```

**(c)** In the component signature add the destructured default after
`jobCoverPhotoId = null,`:

```tsx
  jobCoverPhotoId = null,
  tags = [],
}: PhotoReportBuilderProps) {
```

**(d)** In the `AddPhotosDialog` render block (around line 754) pass it
through, after `supabaseUrl={supabaseUrl}`:

```tsx
          supabaseUrl={supabaseUrl}
          tags={tags}
```

- [ ] **Step 4: Implement the toolbar + filter/sort in the dialog**

Five edits to `src/components/photo-report-add-photos-dialog.tsx`:

**(a)** Extend the types import and define the join shape. Replace:

```tsx
import type { Photo } from "@/lib/types";
```

with:

```tsx
import type { Photo, PhotoTag } from "@/lib/types";

/**
 * A Photo as the builder page fetches it for the picker: the Photos-tab join
 * shape, carrying the photo's tag assignment ids for client-side filtering
 * (the `Photo` type does not carry assignments).
 */
export type PickerPhoto = Photo & {
  photo_tag_assignments?: { tag_id: string }[];
};
```

**(b)** In `AddPhotosDialogProps`, change the `photos` member's type and add
`tags`:

```tsx
  /** All of the Job's photos, in the Job's order (newest first). */
  photos: PickerPhoto[];
```

and after `supabaseUrl: string;`:

```tsx
  /** The Organization's tag vocabulary; empty hides the Tags dropdown. */
  tags?: PhotoTag[];
```

**(c)** Destructure it in the component signature, after `supabaseUrl,`:

```tsx
  supabaseUrl,
  tags = [],
```

**(d)** Add filter/sort state and derive `visiblePhotos`. Replace:

```tsx
  const [selected, setSelected] = useState<string[]>([]);
```

with:

```tsx
  const [selected, setSelected] = useState<string[]>([]);
  // Any-of tag filter + sort toggle (spec §1). Filters never clear the
  // selection: a selected photo hidden by a filter stays in `selected` (a
  // cart being filled across filter views) and "Add N photos" still adds it.
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
```

and replace:

```tsx
  // The flat list the grid and the viewer both show (the Tags filter + sort
  // toolbar will derive this; for now it is the Job's photos as supplied).
  const visiblePhotos = photos;
```

with:

```tsx
  // The flat list the grid and the viewer both show: any-of tag filter, then
  // sort. Newest first is the order the page already supplies; oldest is its
  // mirror (reverses both group order and photo order within each day).
  const filtered =
    selectedTags.length === 0
      ? photos
      : photos.filter((photo) => {
          const tagIds = (photo.photo_tag_assignments ?? []).map(
            (a) => a.tag_id,
          );
          return selectedTags.some((t) => tagIds.includes(t));
        });
  const visiblePhotos = sortNewestFirst ? filtered : [...filtered].reverse();
```

**(e)** Render the toolbar and an empty-filter message. Immediately AFTER the
closing `</DialogHeader>` insert:

```tsx
        {photos.length > 0 && (
          <div className="flex items-center gap-2">
            {tags.length > 0 && (
              <div className="group relative">
                <button
                  type="button"
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                >
                  Tags {selectedTags.length > 0 && `(${selectedTags.length})`} ▾
                </button>
                <div className="absolute left-0 top-full z-50 mt-1 hidden min-w-[200px] rounded-lg border border-border bg-card p-2 shadow-lg group-focus-within:block hover:block">
                  {tags.map((tag) => (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(tag.id)}
                        onChange={() =>
                          setSelectedTags((prev) =>
                            prev.includes(tag.id)
                              ? prev.filter((t) => t !== tag.id)
                              : [...prev, tag.id],
                          )
                        }
                        className="rounded"
                      />
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSortNewestFirst((v) => !v)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
            >
              {sortNewestFirst ? "Newest first" : "Oldest first"}
            </button>
          </div>
        )}
```

Then update the empty state so an empty FILTER result reads differently from
an empty Job. Replace:

```tsx
        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No photos on this job yet.
          </p>
        ) : (
```

with:

```tsx
        {visiblePhotos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {photos.length === 0
              ? "No photos on this job yet."
              : "No photos match the selected tags."}
          </p>
        ) : (
```

(The grouping helpers from Task 3 stay typed over `Photo` — `PickerPhoto[]`
is assignable to `Photo[]`; only the filter reads `photo_tag_assignments`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/photo-report-builder-desktop.test.tsx src/components/photo-report-picker-viewer.test.tsx`
Expected: PASS — all tests green (the picker describe now has 15 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/photo-report-add-photos-dialog.tsx src/components/photo-report-builder.tsx src/components/photo-report-builder-desktop.test.tsx
git commit -m "feat(photo-report): picker Tags filter + Newest/Oldest sort toggle"
```

---

### Task 5: Server data plumbing + final verification

**Files:**
- Modify: `src/app/jobs/[id]/reports/[reportId]/page.tsx`

No new API routes, no schema changes, no writes. The change is two Supabase
query calls inside the existing server component — no Next.js API surface is
touched (see Worker notes re AGENTS.md).

- [ ] **Step 1: Join tag assignments and fetch the org's tags**

Three edits to `src/app/jobs/[id]/reports/[reportId]/page.tsx`:

**(a)** Replace the types import (line 8):

```tsx
import type { PhotoReport, PhotoTag } from "@/lib/types";
import type { PickerPhoto } from "@/components/photo-report-add-photos-dialog";
```

(`Photo` is no longer referenced — `PickerPhoto` supersedes it here. The
import is type-only, so pulling it from a `"use client"` module is erased at
compile time.)

**(b)** Replace the photo query block (lines 57–66):

```tsx
  // Load every photo on the Job (not just the ones already in the report) so
  // the builder can add photos beyond the original selection (#401). Mirrors
  // the Job Photos tab's ordering and join shape: the picker's Tags filter
  // matches client-side on the joined assignment ids.
  const { data: photoData } = await supabase
    .from("photos")
    .select("*, photo_tag_assignments(tag_id)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .returns<PickerPhoto[]>();
  const photos: PickerPhoto[] = photoData ?? [];

  // The Organization's tag vocabulary for the picker's Tags filter (RLS
  // scopes to the active org). Name-ordered like the Photos tab's dropdown.
  const { data: tagData } = await supabase
    .from("photo_tags")
    .select("*")
    .order("name")
    .returns<PhotoTag[]>();
  const tags: PhotoTag[] = tagData ?? [];
```

**(c)** Pass tags to the builder — in the return, after
`supabaseUrl={supabaseUrl}`:

```tsx
      supabaseUrl={supabaseUrl}
      tags={tags}
```

- [ ] **Step 2: Type-check and test the touched files**

Run: `npx tsc --noEmit`
Expected: the pre-existing ~34 clustered errors (PDF/`@react-pdf` + missing-module) only — **no errors mentioning** `photo-report-picker-viewer`, `photo-report-add-photos-dialog`, `photo-report-builder.tsx`, `photo-report-builder-desktop.test.tsx`, or `reports/[reportId]/page.tsx`.

Run: `npx vitest run src/components/photo-report-builder-desktop.test.tsx src/components/photo-report-picker-viewer.test.tsx`
Expected: PASS — all green.

Run: `npx eslint src/components/photo-report-picker-viewer.tsx src/components/photo-report-add-photos-dialog.tsx`
Expected: no errors in these files (the repo-wide `react-hooks/set-state-in-effect` noise lives in OTHER files; the viewer deliberately resets zoom during render, not in an effect, to stay clean).

- [ ] **Step 3: Manual browser smoke test**

The one risk jsdom cannot cover is Base UI's modal pointer-blocking in a real
browser (jsdom has no hit-testing, so a click-dead overlay would still "pass").
Run `npm run dev`, open a Job's Photo Report builder
(`/jobs/<jobId>/reports/<reportId>`), click **+ Add Photos**, and verify:

1. Clicking a photo body opens the fullscreen viewer **and the viewer receives
   clicks** (◀ ▶, zoom +/−, the checkbox, ✕) — this is the nested-dialog
   escape from the picker's modality; if clicks dead-zone, the viewer is being
   rendered outside the Base UI dialog stack.
2. Scroll-wheel zoom about the cursor, double-click zoom, drag-pan when zoomed.
3. Escape once → back to the grid with selection intact; Escape again → dialog
   closes.
4. Day group checkbox selects/deselects the day; numbers follow pick order.
5. Tags dropdown filters (any-of); sort toggle reverses; a selection made
   before filtering still counts in the footer and lands on Add.

Note: do NOT delegate this to a subagent (spawned subagents get ENOTFOUND on
the prod Supabase host); drive it from the main session or by hand.

- [ ] **Step 4: Commit**

```bash
git add src/app/jobs/[id]/reports/[reportId]/page.tsx
git commit -m "feat(photo-report): fetch tag assignments + org tags for the picker"
```

---

## Out of scope (do not do)

- Any change to `photo-viewer.tsx` (the Photos tab viewer) or extraction of a shared viewer component.
- Editing tools in the picker viewer (caption, tags, delete, annotate, before/after pairing).
- Date-range pickers or a Users filter in the picker (Tags + sort only).
- Mobile builder / tray behavior; persisting filter or sort preferences.
- Creating the GitHub tracking issue (explicitly deferred by the user).

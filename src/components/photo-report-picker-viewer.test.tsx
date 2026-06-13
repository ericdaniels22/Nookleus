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

  it("pages with arrow keys pressed inside the popup (Base UI stops their bubbling)", () => {
    // fire keydown on the viewer's select button (focus lives inside the
    // popup in a real browser; Base UI's DialogPopup stops arrow-key
    // propagation in the bubble phase, so only a capture listener hears it)
    const props = renderViewer({ index: 1 });
    fireEvent.keyDown(screen.getByTestId("viewer-select"), { key: "ArrowRight" });
    expect(props.onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(screen.getByTestId("viewer-select"), { key: "ArrowLeft" });
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

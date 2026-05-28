import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// Mock the native camera plugin entirely.
vi.mock("@capacitor-community/camera-preview", () => ({
  CameraPreview: {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    flip: vi.fn(async () => undefined),
    capture: vi.fn(async () => ({ value: "" })),
    setFlashMode: vi.fn(async () => undefined),
  },
}));

// Photo tags, queue, and capture storage have their own networks/contexts —
// stub at the module level so the component can render in jsdom.
vi.mock("@/lib/mobile/capture-storage", () => ({
  writeCapture: vi.fn(async () => undefined),
  updateSidecar: vi.fn(async () => undefined),
}));

vi.mock("@/lib/mobile/use-photo-tags", () => ({
  usePhotoTags: () => ({ tags: [], loading: false, error: null }),
}));

vi.mock("@/lib/mobile/upload-queue-context", () => ({
  useUploadQueue: () => ({
    counts: { pending: 0, uploading: 0, failed: 0, completed: 0 },
  }),
}));

vi.mock("@/components/mobile/upload-queue-sheet", () => ({
  UploadQueueSheet: () => null,
}));

// Drive the viewport orientation from each test.
const viewportMock = vi.fn();
vi.mock("@/lib/mobile/use-viewport-orientation", () => ({
  useViewportOrientation: () => viewportMock(),
}));

import CameraView from "./camera-view";

const STACKED_LABELS = [
  /Cancel capture/i,
  /Flip camera/i,
  /Flash/i,
  /Mode:/i,
  /Camera settings/i,
  /Open upload queue/i,
  /Capture photo/i,
  /Finish capture session/i,
];

const OVERLAY_LABELS = [
  /Flip camera/i,
  /Flash/i,
  /Mode:/i,
  /Camera settings/i,
  /Open upload queue/i,
  /Capture photo/i,
  /Finish capture session/i,
];

describe("CameraView adaptive layout", () => {
  beforeEach(() => {
    viewportMock.mockReset();
  });

  it("renders every control including X cancel in stacked (portrait) mode", () => {
    viewportMock.mockReturnValue({
      width: 390,
      height: 844,
      orientation: "portrait",
    });

    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    for (const label of STACKED_LABELS) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }

    expect(screen.getByTestId("camera-layout-mode").textContent).toBe(
      "stacked",
    );
  });

  it("renders overlay controls but no X cancel in landscape mode", () => {
    viewportMock.mockReturnValue({
      width: 1024,
      height: 768,
      orientation: "landscape",
    });

    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    for (const label of OVERLAY_LABELS) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
    expect(screen.queryByLabelText(/Cancel capture/i)).toBeNull();
    expect(screen.getByTestId("camera-layout-mode").textContent).toBe(
      "overlay",
    );
  });
});

describe("CameraView overlay branch (iPad landscape)", () => {
  beforeEach(() => {
    viewportMock.mockReset();
    viewportMock.mockReturnValue({
      width: 1024,
      height: 768,
      orientation: "landscape",
    });
  });

  it("preview rect AND outer container are transparent so the native camera feed shows through the WebView", () => {
    // Regression guard: the @capacitor-community/camera-preview plugin paints
    // the camera feed *behind* the WebView at the preview rect (toBack:true).
    // useCameraLifecycle sets html+body transparent so the camera shows
    // through. Any opaque background on the outer container or the preview
    // rect wrapper paints over the camera at exactly that region.
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    const outer = screen.getByTestId("camera-root");
    expect(outer.className).not.toMatch(/\bbg-/);

    const rect = screen.getByTestId("camera-preview-rect");
    expect(rect.className).not.toMatch(/\bbg-/);
  });

  it("renders black bezel strips around the centered preview rect (non-4:3 iPads)", () => {
    // 1180x820 is the common modern iPad landscape size; ~44pt margins remain
    // on each side of the 4:3 preview rect. Without bezels those areas would
    // show whatever sits behind the transparent WebView.
    viewportMock.mockReturnValue({
      width: 1180,
      height: 820,
      orientation: "landscape",
    });

    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    expect(screen.getByTestId("camera-left-bezel")).toBeDefined();
    expect(screen.getByTestId("camera-right-bezel")).toBeDefined();
  });

  it("skips bezel strips when the preview rect is edge-to-edge (4:3 viewports)", () => {
    // 1024x768 is exact 4:3 — previewRect.x === 0, no margins to cover.
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    expect(screen.queryByTestId("camera-left-bezel")).toBeNull();
    expect(screen.queryByTestId("camera-right-bezel")).toBeNull();
  });

  it("top-right cluster holds exactly mode-toggle, flip, flash, settings in DOM order", () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    const cluster = screen.getByTestId("camera-top-cluster");
    const buttons = within(cluster).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0].getAttribute("aria-label")).toMatch(/^Mode:/);
    expect(buttons[1].getAttribute("aria-label")).toBe("Flip camera");
    expect(buttons[2].getAttribute("aria-label")).toMatch(/^Flash /);
    expect(buttons[3].getAttribute("aria-label")).toBe("Camera settings");
  });

  it("right rail renders Done → shutter → queue when count = 0 (no count node)", () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    const rail = screen.getByTestId("camera-right-rail");
    expect(within(rail).queryByTestId("camera-capture-count")).toBeNull();

    const children = Array.from(rail.children);
    const labels = children.map(
      (el) => el.getAttribute("aria-label") ?? el.getAttribute("data-testid"),
    );
    expect(labels).toEqual([
      "Finish capture session",
      "Capture photo",
      "Open upload queue",
    ]);
  });

  it("right rail renders Done → count → shutter → queue when count > 0", async () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Capture photo/i));
    const tagSheet = await screen.findByTestId("tag-sheet");
    fireEvent.click(within(tagSheet).getByText(/Continue/i));
    await waitFor(() => {
      expect(screen.queryByTestId("tag-sheet")).toBeNull();
    });

    const rail = screen.getByTestId("camera-right-rail");
    const count = within(rail).getByTestId("camera-capture-count");
    expect(count.textContent).toBe("1");

    const children = Array.from(rail.children);
    const labels = children.map(
      (el) => el.getAttribute("aria-label") ?? el.getAttribute("data-testid"),
    );
    expect(labels).toEqual([
      "Finish capture session",
      "camera-capture-count",
      "Capture photo",
      "Open upload queue",
    ]);
  });

  it("settings sheet renders with data-mode=overlay and right-edge ~40vw geometry", () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Camera settings/i));

    const sheet = screen.getByTestId("settings-sheet");
    expect(sheet.getAttribute("data-mode")).toBe("overlay");
    expect(sheet.className).toMatch(/right-0/);
    expect(sheet.className).toMatch(/w-\[40vw\]/);
    expect(sheet.className).not.toMatch(/bottom-0/);
    expect(sheet.className).not.toMatch(/inset-0/);
  });

  it("tag-after sheet renders with data-mode=overlay and right-edge ~40vw geometry", async () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Capture photo/i));

    const sheet = await screen.findByTestId("tag-sheet");
    expect(sheet.getAttribute("data-mode")).toBe("overlay");
    expect(sheet.className).toMatch(/right-0/);
    expect(sheet.className).toMatch(/w-\[40vw\]/);
    expect(sheet.className).not.toMatch(/bottom-0/);
    expect(sheet.className).not.toMatch(/inset-0/);
  });

  it("leave-confirm modal cannot be opened in overlay mode (no X cancel exists)", async () => {
    const onAbort = vi.fn();
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={onAbort}
      />,
    );

    // Capture one photo to seed the leave guard.
    fireEvent.click(screen.getByLabelText(/Capture photo/i));
    const tagSheet = await screen.findByTestId("tag-sheet");
    fireEvent.click(within(tagSheet).getByText(/Continue/i));
    await waitFor(() => {
      expect(screen.queryByTestId("tag-sheet")).toBeNull();
    });

    // No X cancel button exists in overlay mode, so leave-confirm cannot open.
    expect(screen.queryByLabelText(/Cancel capture/i)).toBeNull();
    expect(screen.queryByTestId("leave-confirm")).toBeNull();
  });
});

describe("CameraView stacked mode (iPhone + iPad portrait) — visual regression", () => {
  beforeEach(() => {
    viewportMock.mockReset();
    viewportMock.mockReturnValue({
      width: 390,
      height: 844,
      orientation: "portrait",
    });
  });

  it("settings sheet slides up from the bottom", () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Camera settings/i));

    const sheet = screen.getByTestId("settings-sheet");
    expect(sheet.getAttribute("data-mode")).toBe("stacked");
    expect(sheet.className).toMatch(/bottom-0/);
    expect(sheet.className).not.toMatch(/right-0/);
  });

  it("tag-after sheet slides up from the bottom", async () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Capture photo/i));

    const sheet = await screen.findByTestId("tag-sheet");
    expect(sheet.getAttribute("data-mode")).toBe("stacked");
    expect(sheet.className).toMatch(/bottom-0/);
    expect(sheet.className).not.toMatch(/right-0/);
  });

  it("leave-confirm dialog covers the full screen", async () => {
    render(
      <CameraView
        jobId="job-1"
        sessionId="sess-1"
        onDone={() => undefined}
        onAbort={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Capture photo/i));
    const tagSheet = await screen.findByTestId("tag-sheet");
    fireEvent.click(within(tagSheet).getByText(/Continue/i));
    await waitFor(() => {
      expect(screen.queryByTestId("tag-sheet")).toBeNull();
    });

    fireEvent.click(screen.getByLabelText(/Cancel capture/i));

    const dialog = screen.getByTestId("leave-confirm");
    expect(dialog.getAttribute("data-mode")).toBe("stacked");
    expect(dialog.className).toMatch(/inset-0/);
    expect(dialog.className).not.toMatch(/right-0/);
  });
});

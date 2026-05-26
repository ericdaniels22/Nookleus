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

const ALL_CONTROL_LABELS = [
  /Cancel capture/i,
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

  it("renders every control in stacked (portrait) mode", () => {
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

    for (const label of ALL_CONTROL_LABELS) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }

    expect(screen.getByTestId("camera-layout-mode").textContent).toBe(
      "stacked",
    );
  });

  it("renders every control in split (landscape) mode", () => {
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

    for (const label of ALL_CONTROL_LABELS) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }

    expect(screen.getByTestId("camera-layout-mode").textContent).toBe("split");
    // In split mode the shutter lives on the right side, inside the controls
    // panel — assert by data attribute.
    const shutter = screen.getByLabelText(/Capture photo/i);
    const panel = screen.getByTestId("camera-controls-panel");
    expect(panel.contains(shutter)).toBe(true);
  });
});

describe("CameraView in-camera surfaces (issue #272)", () => {
  beforeEach(() => {
    viewportMock.mockReset();
  });

  describe("split mode (iPad landscape)", () => {
    beforeEach(() => {
      viewportMock.mockReturnValue({
        width: 1024,
        height: 768,
        orientation: "landscape",
      });
    });

    it("settings sheet anchors to the right and is dismissible", () => {
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
      expect(sheet.getAttribute("data-mode")).toBe("split");
      expect(sheet.className).toMatch(/right-0/);
      expect(sheet.className).not.toMatch(/bottom-0/);

      fireEvent.click(within(sheet).getByText(/Close/i));
      expect(screen.queryByTestId("settings-sheet")).toBeNull();
    });

    it("tag-after sheet anchors to the right and is dismissible", async () => {
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
      expect(sheet.getAttribute("data-mode")).toBe("split");
      expect(sheet.className).toMatch(/right-0/);
      expect(sheet.className).not.toMatch(/bottom-0/);

      fireEvent.click(within(sheet).getByText(/Continue/i));
      await waitFor(() => {
        expect(screen.queryByTestId("tag-sheet")).toBeNull();
      });
    });

    it("leave-confirm dialog anchors to the right and Stay dismisses it", async () => {
      const onAbort = vi.fn();
      render(
        <CameraView
          jobId="job-1"
          sessionId="sess-1"
          onDone={() => undefined}
          onAbort={onAbort}
        />,
      );

      // Capture one photo so the leave guard triggers.
      fireEvent.click(screen.getByLabelText(/Capture photo/i));
      const tagSheet = await screen.findByTestId("tag-sheet");
      fireEvent.click(within(tagSheet).getByText(/Continue/i));
      await waitFor(() => {
        expect(screen.queryByTestId("tag-sheet")).toBeNull();
      });

      fireEvent.click(screen.getByLabelText(/Cancel capture/i));

      const dialog = screen.getByTestId("leave-confirm");
      expect(dialog.getAttribute("data-mode")).toBe("split");
      expect(dialog.className).toMatch(/right-0/);
      expect(dialog.className).not.toMatch(/inset-0/);

      fireEvent.click(within(dialog).getByText(/^Stay$/));
      expect(screen.queryByTestId("leave-confirm")).toBeNull();
      expect(onAbort).not.toHaveBeenCalled();
    });
  });

  describe("stacked mode (iPhone + iPad portrait) — visual regression", () => {
    beforeEach(() => {
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
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

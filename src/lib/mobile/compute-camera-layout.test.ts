import { describe, it, expect } from "vitest";
import { computeCameraLayout } from "./compute-camera-layout";

describe("computeCameraLayout", () => {
  it("iPhone portrait keeps full-width 3:4 preview when controls fit naturally", () => {
    const layout = computeCameraLayout({
      viewportWidth: 390,
      viewportHeight: 844,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("stacked");
    expect(layout.previewRect).toEqual({ x: 0, y: 0, width: 390, height: 520 });
  });

  it("iPad portrait scales preview down so controls strip fits", () => {
    // 768x1024 with 300pt controls reserved: preview height capped at 724.
    // Preview width follows 3:4 -> 543. Centered horizontally.
    const layout = computeCameraLayout({
      viewportWidth: 768,
      viewportHeight: 1024,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("stacked");
    expect(layout.previewRect.y).toBe(0);
    expect(layout.previewRect.height).toBe(724);
    expect(layout.previewRect.width).toBe(543);
    expect(layout.previewRect.x).toBe(Math.round((768 - 543) / 2));
  });

  it("iPad landscape uses split layout with 4:3 preview on the left", () => {
    // 1024x768, 300pt controls reserved on the right.
    // Preview width = 1024-300 = 724. Height = 724 * 3/4 = 543. Centered vertically.
    const layout = computeCameraLayout({
      viewportWidth: 1024,
      viewportHeight: 768,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("split");
    expect(layout.previewRect.x).toBe(0);
    expect(layout.previewRect.width).toBe(724);
    expect(layout.previewRect.height).toBe(543);
    expect(layout.previewRect.y).toBe(Math.round((768 - 543) / 2));
  });

  it("iPad portrait at 820x1180 also scales to fit controls", () => {
    const layout = computeCameraLayout({
      viewportWidth: 820,
      viewportHeight: 1180,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("stacked");
    expect(layout.previewRect.height).toBe(880);
    expect(layout.previewRect.width).toBe(660);
  });

  it("iPad landscape at 1180x820 keeps split layout with shutter region", () => {
    const layout = computeCameraLayout({
      viewportWidth: 1180,
      viewportHeight: 820,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("split");
    expect(layout.previewRect.width).toBe(880);
    expect(layout.previewRect.height).toBe(660);
  });

  it("split-screen narrow portrait window falls back to stacked", () => {
    // Half-screen iPad multitasking: ~507x1180 or so. Tall + narrow => stacked.
    const layout = computeCameraLayout({
      viewportWidth: 500,
      viewportHeight: 1180,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("stacked");
  });

  it("square viewport (width === height) chooses split per >= rule", () => {
    const layout = computeCameraLayout({
      viewportWidth: 800,
      viewportHeight: 800,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("split");
  });

  it("landscape with residual width less than controlsMinSize falls back to stacked", () => {
    // Pathological landscape where the controls cluster cannot fit:
    // viewportWidth (250) is less than controlsMinSize (300), so we
    // cannot carve out the controls strip without producing a degenerate
    // preview. Per spec: fall back to stacked.
    const layout = computeCameraLayout({
      viewportWidth: 250,
      viewportHeight: 200,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("stacked");
  });
});

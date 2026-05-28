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

  it("split-screen narrow portrait window stays stacked", () => {
    // Half-screen iPad multitasking: ~500x1180 or so. Tall + narrow => stacked.
    const layout = computeCameraLayout({
      viewportWidth: 500,
      viewportHeight: 1180,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("stacked");
  });

  it("iPad landscape at 1024x768 (4:3) uses overlay with edge-to-edge preview", () => {
    // width = round(768 * 4/3) = 1024. x = round((1024 - 1024)/2) = 0.
    const layout = computeCameraLayout({
      viewportWidth: 1024,
      viewportHeight: 768,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("overlay");
    expect(layout.previewRect).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 768,
    });
  });

  it("iPad landscape at 1180x820 (non-4:3) centers the overlay preview horizontally", () => {
    // width = round(820 * 4/3) = 1093. x = round((1180 - 1093)/2) = 44.
    const layout = computeCameraLayout({
      viewportWidth: 1180,
      viewportHeight: 820,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("overlay");
    expect(layout.previewRect).toEqual({
      x: 44,
      y: 0,
      width: 1093,
      height: 820,
    });
  });

  it("square viewport (width === height) chooses overlay per >= rule", () => {
    const layout = computeCameraLayout({
      viewportWidth: 800,
      viewportHeight: 800,
      controlsMinSize: 300,
    });

    expect(layout.mode).toBe("overlay");
  });
});

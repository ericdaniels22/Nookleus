import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewportOrientation } from "./use-viewport-orientation";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
}

describe("useViewportOrientation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports initial viewport size and orientation", () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useViewportOrientation());
    expect(result.current.width).toBe(390);
    expect(result.current.height).toBe(844);
    expect(result.current.orientation).toBe("portrait");
  });

  it("reports landscape when width >= height", () => {
    setViewport(1024, 768);
    const { result } = renderHook(() => useViewportOrientation());
    expect(result.current.orientation).toBe("landscape");
  });

  it("debounces a burst of resize events into a single update", () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useViewportOrientation());

    act(() => {
      setViewport(500, 800);
      window.dispatchEvent(new Event("resize"));
      setViewport(600, 800);
      window.dispatchEvent(new Event("resize"));
      setViewport(820, 1180);
      window.dispatchEvent(new Event("resize"));
    });

    // Before debounce fires, hook should still report initial dims.
    expect(result.current.width).toBe(390);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.width).toBe(820);
    expect(result.current.height).toBe(1180);
  });
});

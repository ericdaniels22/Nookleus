import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TouchEvent as ReactTouchEvent } from "react";
import { usePullToRefresh } from "./use-pull-to-refresh";

// Minimal synthetic touch events mirroring how the handlers read them
// (e.touches[0].clientY on start/move, e.changedTouches[0].clientY on end) —
// the same shape photo-viewer.test.tsx fires.
function start(clientY: number) {
  return { touches: [{ clientY }] } as unknown as ReactTouchEvent;
}
function move(clientY: number) {
  return { touches: [{ clientY }] } as unknown as ReactTouchEvent;
}
function end(clientY: number) {
  return { changedTouches: [{ clientY }] } as unknown as ReactTouchEvent;
}

describe("usePullToRefresh", () => {
  it("runs onRefresh when dragged down past the threshold from the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePullToRefresh({
        onRefresh,
        threshold: 64,
        getScrollTop: () => 0,
        minSpinMs: 0,
      }),
    );

    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(180)); // 80px down > 64
      result.current.onTouchEnd(end(180));
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("springs back without refreshing when released below the threshold", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 64, getScrollTop: () => 0 }),
    );

    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(140)); // 40px down < 64
      result.current.onTouchEnd(end(140));
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.pullDistance).toBe(0);
  });

  it("does not arm or refresh when the page is not scrolled to the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 64, getScrollTop: () => 200 }),
    );

    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(220)); // 120px down, but mid-page
      result.current.onTouchEnd(end(220));
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not refresh on an upward drag from the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 64, getScrollTop: () => 0 }),
    );

    await act(async () => {
      result.current.onTouchStart(start(200));
      result.current.onTouchMove(move(100)); // finger travels up
      result.current.onTouchEnd(end(100));
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.pullDistance).toBe(0);
  });

  it("stands down while disabled: a full pull past the threshold does not refresh", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePullToRefresh({
        onRefresh,
        threshold: 64,
        getScrollTop: () => 0,
        disabled: true,
      }),
    );

    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(200)); // 100px down > 64, but an overlay is open
      result.current.onTouchEnd(end(200));
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("re-enables the gesture once disabled flips back to false (overlay closed)", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    // Stable references (as in production, where the wrapper omits getScrollTop
    // and passes a memoized onRefresh) so the only dependency that changes
    // across the rerender is `disabled` — this pins it to the handler's deps.
    const atTop = () => 0;
    const { result, rerender } = renderHook(
      ({ disabled }) =>
        usePullToRefresh({
          onRefresh,
          threshold: 64,
          getScrollTop: atTop,
          disabled,
          minSpinMs: 0,
        }),
      { initialProps: { disabled: true } },
    );

    // Overlay open: a full pull does nothing.
    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(200));
      result.current.onTouchEnd(end(200));
    });
    expect(onRefresh).not.toHaveBeenCalled();

    // Overlay closes — the page-level gesture works again.
    rerender({ disabled: false });
    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(200));
      result.current.onTouchEnd(end(200));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("ignores a second pull while a refresh is already in flight", async () => {
    let resolveRefresh: () => void = () => {};
    const onRefresh = vi.fn(
      () => new Promise<void>((resolve) => (resolveRefresh = resolve)),
    );
    // minSpinMs: 0 isolates the concurrency guard from the min-spin hold (#677)
    // so this test asserts only the in-flight behavior, not the spinner timing.
    const { result } = renderHook(() =>
      usePullToRefresh({
        onRefresh,
        threshold: 64,
        getScrollTop: () => 0,
        minSpinMs: 0,
      }),
    );

    // First pull triggers a refresh that stays pending.
    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(200));
      result.current.onTouchEnd(end(200));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    // A second full pull while the first is still in flight is a no-op.
    await act(async () => {
      result.current.onTouchStart(start(100));
      result.current.onTouchMove(move(200));
      result.current.onTouchEnd(end(200));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Once it settles, refreshing clears.
    await act(async () => {
      resolveRefresh();
    });
    expect(result.current.refreshing).toBe(false);
  });

  it("keeps the spinner up for a minimum duration even when onRefresh resolves instantly", async () => {
    vi.useFakeTimers();
    try {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        usePullToRefresh({
          onRefresh,
          threshold: 64,
          getScrollTop: () => 0,
          minSpinMs: 500,
        }),
      );

      await act(async () => {
        result.current.onTouchStart(start(100));
        result.current.onTouchMove(move(200));
        result.current.onTouchEnd(end(200));
      });

      // The reload already resolved, but the spinner must not flash away — it
      // holds for the minimum spin so an instant refresh still reads as "working".
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(result.current.refreshing).toBe(true);

      // Still up just before the minimum elapses...
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(result.current.refreshing).toBe(true);

      // ...and it retracts the moment the minimum is reached.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.refreshing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

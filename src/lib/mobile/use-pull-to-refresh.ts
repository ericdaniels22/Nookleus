"use client";

import { useCallback, useRef, useState } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

// px a downward drag from the top must travel before release triggers a reload
const DEFAULT_THRESHOLD = 64;

export interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  getScrollTop?: () => number;
}

export interface PullToRefreshState {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  onTouchEnd: (e: ReactTouchEvent) => void;
  pullDistance: number;
  refreshing: boolean;
}

export function usePullToRefresh({
  onRefresh,
  threshold = DEFAULT_THRESHOLD,
  getScrollTop,
}: PullToRefreshOptions): PullToRefreshState {
  // In-flight gesture state lives in a ref so mid-gesture reads don't re-render;
  // pullDistance/refreshing are state because they drive the spinner.
  const startY = useRef<number | null>(null);
  const inFlight = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      // Arm only when the page is scrolled to the very top.
      const scrollTop = getScrollTop
        ? getScrollTop()
        : typeof window !== "undefined"
          ? window.scrollY
          : 0;
      if (scrollTop > 0) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0]?.clientY ?? null;
    },
    [getScrollTop],
  );

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (startY.current == null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
    setPullDistance(Math.max(0, dy));
  }, []);

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      const origin = startY.current;
      startY.current = null;
      setPullDistance(0);
      if (origin == null) return;
      // Decide from the end coordinate + the armed origin, never from
      // pullDistance state (which may be stale within a single render).
      const dy = (e.changedTouches[0]?.clientY ?? 0) - origin;
      // Guard concurrent refreshes: a pull released past the threshold while a
      // reload is still running is a no-op.
      if (dy >= threshold && !inFlight.current) {
        inFlight.current = true;
        setRefreshing(true);
        void onRefresh().finally(() => {
          inFlight.current = false;
          setRefreshing(false);
        });
      }
    },
    [onRefresh, threshold],
  );

  return { onTouchStart, onTouchMove, onTouchEnd, pullDistance, refreshing };
}

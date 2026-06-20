"use client";

import { useCallback, useRef, useState } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

// px a downward drag from the top must travel before release triggers a reload
const DEFAULT_THRESHOLD = 64;

// Minimum time the spinner stays visible once a reload starts. A refresh that
// resolves instantly (warm cache, fast signal) would otherwise blink the
// spinner in and out — reading as a glitch rather than "working". Holding it
// for ~0.5s makes even an instant reload feel deliberate (#677).
const DEFAULT_MIN_SPIN_MS = 500;

export interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  getScrollTop?: () => number;
  // When true, the gesture stands down: a touch never arms, so move/end are
  // inert and no reload fires. Used to yield to an overlay open on top of the
  // page (photo viewer, edit dialogs, compose-email) so swipes drive the
  // overlay's own gestures instead of refreshing the page underneath (#678).
  disabled?: boolean;
  // Minimum ms the spinner stays up after a reload starts, so an instant
  // refresh never flashes (#677). A reload that takes longer retracts as soon
  // as it resolves — this only pads the fast case.
  minSpinMs?: number;
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
  disabled = false,
  minSpinMs = DEFAULT_MIN_SPIN_MS,
}: PullToRefreshOptions): PullToRefreshState {
  // In-flight gesture state lives in a ref so mid-gesture reads don't re-render;
  // pullDistance/refreshing are state because they drive the spinner.
  const startY = useRef<number | null>(null);
  const inFlight = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      // Stand down while an overlay is open: never arm, so this whole gesture
      // is inert and the page can't refresh under the overlay (#678).
      if (disabled) {
        startY.current = null;
        return;
      }
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
    [getScrollTop, disabled],
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
        const startedAt = Date.now();
        void onRefresh().finally(() => {
          // Hold the spinner for the rest of the minimum spin if the reload
          // beat it; otherwise retract right away. inFlight stays set until the
          // spinner actually retracts, so a pull during the hold is ignored too.
          const settle = () => {
            inFlight.current = false;
            setRefreshing(false);
          };
          const remaining = minSpinMs - (Date.now() - startedAt);
          if (remaining > 0) {
            setTimeout(settle, remaining);
          } else {
            settle();
          }
        });
      }
    },
    [onRefresh, threshold, minSpinMs],
  );

  return { onTouchStart, onTouchMove, onTouchEnd, pullDistance, refreshing };
}

"use client";

// useDebouncedSave (issue #806) — the reusable debounced-save primitive behind
// the Photo viewer's auto-save (and, later, the annotator). It coalesces rapid
// edits into a single write after a quiet window, flushes any pending write when
// the surface unmounts (so an in-window edit is never dropped), and silently
// retries a failed write with exponential backoff before surfacing a warning.
// Modeled on the estimate-builder auto-save (debounce 2000ms, backoff to 30s).

import { useCallback, useEffect, useRef } from "react";

// First retry after 1s, doubling each time, capped at 30s — mirrors the
// estimate-builder auto-save backoff schedule.
const MAX_BACKOFF_MS = 30_000;
// Total attempts (initial + retries) before the warning is surfaced.
const DEFAULT_MAX_ATTEMPTS = 4;

export interface UseDebouncedSaveOptions {
  // Quiet-window length in ms before a scheduled save runs. delay <= 0 saves
  // immediately on change (no debounce), for fields like tags / Before-After.
  delay: number;
  // Total attempts (including the first) before giving up; default 4.
  maxAttempts?: number;
  // Called once, with the last error, when all attempts have failed. Success is
  // silent — onError is never called for a save that eventually persists.
  onError?: (error: unknown) => void;
}

export interface DebouncedSave {
  // Schedule `run` to persist after the debounce window, replacing any save
  // still pending (rapid edits coalesce into the latest thunk).
  save: (run: () => Promise<void>) => void;
  // Run any pending save immediately (used on close / paging / unmount).
  flush: () => void;
}

export function useDebouncedSave(options: UseDebouncedSaveOptions): DebouncedSave {
  const { delay, maxAttempts = DEFAULT_MAX_ATTEMPTS, onError } = options;

  const pendingRef = useRef<(() => Promise<void>) | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest options behind refs so the stable callbacks always see current
  // values. Synced in an effect (below), never written during render — the
  // callbacks that read them only run after commit (timers, event handlers).
  const maxAttemptsRef = useRef(maxAttempts);
  const onErrorRef = useRef(onError);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Run `run`, retrying on rejection with exponential backoff until it succeeds
  // or attempts are exhausted, at which point the warning is surfaced once.
  const runWithRetry = useCallback(
    (run: () => Promise<void>) => {
      let attempt = 0;
      let backoff = 0;
      const attemptOnce = () => {
        attempt += 1;
        run().then(
          () => {
            // Silent success — nothing surfaced.
          },
          (error: unknown) => {
            if (attempt >= maxAttemptsRef.current) {
              onErrorRef.current?.(error);
              return;
            }
            backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
            retryTimerRef.current = setTimeout(attemptOnce, backoff);
          },
        );
      };
      attemptOnce();
    },
    [],
  );

  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const run = pendingRef.current;
    if (!run) return;
    pendingRef.current = null;
    runWithRetry(run);
  }, [runWithRetry]);

  const save = useCallback(
    (run: () => Promise<void>) => {
      pendingRef.current = run;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      // A fresh edit supersedes a write still struggling through its retries.
      clearRetry();
      if (delay <= 0) {
        flush();
        return;
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        flush();
      }, delay);
    },
    [delay, flush, clearRetry],
  );

  // Flush a pending save when the surface unmounts (navigate-away), and on the
  // browser page-lifecycle events that a real tab-close / iOS background fire
  // without ever running React cleanup. `flush` is stable, but keep it behind a
  // ref so every listener and the cleanup see the latest.
  const flushRef = useRef(flush);
  // Keep the latest options and flush in refs without writing during render.
  // No dependency array → runs after every commit, before any timer/listener
  // fires, so the stable callbacks above always read current values.
  useEffect(() => {
    maxAttemptsRef.current = maxAttempts;
    onErrorRef.current = onError;
    flushRef.current = flush;
  });
  useEffect(() => {
    const onPageHide = () => flushRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushRef.current();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushRef.current();
    };
  }, []);

  return { save, flush };
}

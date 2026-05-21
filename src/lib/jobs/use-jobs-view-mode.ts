"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  JOBS_VIEW_MODE_STORAGE_KEY,
  parseJobsViewMode,
  type JobsViewMode,
} from "./view-mode";

type JobsViewModeHook = {
  mode: JobsViewMode;
  setMode: (mode: JobsViewMode) => void;
};

// In-memory source of truth, lazily seeded from localStorage on first read.
// Keeping it in memory means the toggle still works for the session even
// when localStorage is unavailable (private browsing / quota).
let currentMode: JobsViewMode | null = null;
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): JobsViewMode {
  if (currentMode === null) {
    currentMode = parseJobsViewMode(
      window.localStorage.getItem(JOBS_VIEW_MODE_STORAGE_KEY),
    );
  }
  return currentMode;
}

// The server has no localStorage; render the default so the server markup
// matches the first client paint and React hydrates without a mismatch.
function getServerSnapshot(): JobsViewMode {
  return "grid";
}

/**
 * Per-device Jobs tab view-mode preference, backed by localStorage.
 *
 * Reads through `useSyncExternalStore` rather than a state-syncing effect:
 * the default renders on the server, the stored preference applies on the
 * client, and there is no hydration mismatch.
 */
export function useJobsViewMode(): JobsViewModeHook {
  const mode = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setMode = useCallback((next: JobsViewMode) => {
    currentMode = next;
    try {
      window.localStorage.setItem(JOBS_VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // localStorage can throw (private browsing / quota). currentMode is
      // already updated, so the toggle still works for this session.
    }
    for (const listener of listeners) {
      listener();
    }
  }, []);

  return { mode, setMode };
}

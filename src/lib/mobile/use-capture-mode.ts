"use client";

import { useEffect, useState } from "react";
import type { CaptureMode } from "./capture-types";

const STORAGE_KEY = "mobile-capture-mode";
const DEFAULT_MODE: CaptureMode = "rapid";

function isCaptureMode(value: unknown): value is CaptureMode {
  return value === "rapid" || value === "tag-after";
}

export function useCaptureMode(): [CaptureMode, (mode: CaptureMode) => void] {
  const [mode, setMode] = useState<CaptureMode>(DEFAULT_MODE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isCaptureMode(stored)) setMode(stored);
    } catch {
      // localStorage may be unavailable (private browsing, sandboxed WebView).
    }
  }, []);

  const persistMode = (next: CaptureMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same as above; tolerated.
    }
  };

  return [mode, persistMode];
}

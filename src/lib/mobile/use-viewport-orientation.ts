"use client";

import { useEffect, useState } from "react";

export type Orientation = "portrait" | "landscape";

export interface ViewportOrientation {
  width: number;
  height: number;
  orientation: Orientation;
}

const DEBOUNCE_MS = 150;

function readViewport(): ViewportOrientation {
  const width =
    typeof window !== "undefined" ? window.innerWidth : 0;
  const height =
    typeof window !== "undefined" ? window.innerHeight : 0;
  return {
    width,
    height,
    orientation: width >= height ? "landscape" : "portrait",
  };
}

export function useViewportOrientation(): ViewportOrientation {
  const [state, setState] = useState<ViewportOrientation>(() => readViewport());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        setState(readViewport());
        timer = null;
      }, DEBOUNCE_MS);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);

  return state;
}

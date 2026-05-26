"use client";

import { useEffect, useRef } from "react";
import { CameraPreview } from "@capacitor-community/camera-preview";

export interface CameraLifecycleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseCameraLifecycleInput {
  rect: CameraLifecycleRect;
  position: "rear" | "front";
  safeAreaTop: number;
  onError?: (err: unknown) => void;
}

const RECT_TOLERANCE_PX = 4;

function rectsDiffer(a: CameraLifecycleRect, b: CameraLifecycleRect): boolean {
  return (
    Math.abs(a.x - b.x) > RECT_TOLERANCE_PX ||
    Math.abs(a.y - b.y) > RECT_TOLERANCE_PX ||
    Math.abs(a.width - b.width) > RECT_TOLERANCE_PX ||
    Math.abs(a.height - b.height) > RECT_TOLERANCE_PX
  );
}

export function useCameraLifecycle(input: UseCameraLifecycleInput): void {
  const { rect, position, safeAreaTop, onError } = input;
  const startedRef = useRef(false);
  const lastRectRef = useRef<CameraLifecycleRect | null>(null);
  const lastPositionRef = useRef<"rear" | "front">(position);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Body/html background transparency dance — the native overlay sits behind
  // the WebView via toBack:true, so the page background must be transparent
  // for the live feed to be visible.
  useEffect(() => {
    const prevBodyBg = document.body.style.backgroundColor;
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    document.body.style.backgroundColor = "transparent";
    document.documentElement.style.backgroundColor = "transparent";
    return () => {
      document.body.style.backgroundColor = prevBodyBg;
      document.documentElement.style.backgroundColor = prevHtmlBg;
    };
  }, []);

  useEffect(() => {
    const start = async (
      r: CameraLifecycleRect,
      pos: "rear" | "front",
      safeTop: number,
    ) => {
      try {
        await CameraPreview.start({
          position: pos,
          parent: "camera-preview-mount",
          toBack: true,
          width: r.width,
          height: Math.round(r.height + safeTop),
          x: r.x,
          y: r.y,
          disableAudio: true,
        });
        startedRef.current = true;
      } catch (err) {
        onErrorRef.current?.(err);
      }
    };

    const stop = async () => {
      // Never gate on startedRef: a user can exit between start() being called
      // and start() resolving. Always attempt; tolerate "not started" errors.
      try {
        await CameraPreview.stop();
      } catch {
        // ignore — plugin throws if not started
      }
      startedRef.current = false;
    };

    const last = lastRectRef.current;
    const positionChanged = lastPositionRef.current !== position;
    if (last === null) {
      lastRectRef.current = rect;
      lastPositionRef.current = position;
      void start(rect, position, safeAreaTop);
    } else if (positionChanged || rectsDiffer(last, rect)) {
      lastRectRef.current = rect;
      lastPositionRef.current = position;
      void (async () => {
        await stop();
        await start(rect, position, safeAreaTop);
      })();
    }

    return undefined;
  }, [rect, position, safeAreaTop]);

  // Final teardown on unmount.
  useEffect(() => {
    return () => {
      void CameraPreview.stop().catch(() => undefined);
      startedRef.current = false;
    };
  }, []);
}

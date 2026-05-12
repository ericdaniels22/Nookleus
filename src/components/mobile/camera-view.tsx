"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Flashlight,
  RotateCw,
  Settings,
  Tag,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { CameraPreview } from "@capacitor-community/camera-preview";
import type { CameraPreviewFlashMode } from "@capacitor-community/camera-preview";
import { writeCapture } from "@/lib/mobile/capture-storage";
import type { CaptureMode, CaptureSidecar } from "@/lib/mobile/capture-types";
import { useCaptureMode } from "@/lib/mobile/use-capture-mode";
import { usePhotoTags } from "@/lib/mobile/use-photo-tags";
import { cn } from "@/lib/utils";

interface CameraViewProps {
  jobId: string;
  sessionId: string;
  onDone: () => void;
  onCaptureCountChange?: (count: number) => void;
  onAbort?: () => void;
}

type FlashMode = "off" | "on" | "torch";

const FLASH_NEXT: Record<FlashMode, FlashMode> = {
  off: "on",
  on: "torch",
  torch: "off",
};

function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for environments without randomUUID. Acceptable here because
  // the WebView always exposes crypto.randomUUID; this branch is for SSR safety.
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CameraView({
  jobId,
  sessionId,
  onDone,
  onCaptureCountChange,
  onAbort,
}: CameraViewProps) {
  const [mode, setMode] = useCaptureMode();
  const { tags, loading: tagsLoading, error: tagsError } = usePhotoTags();
  const [position, setPosition] = useState<"rear" | "front">("rear");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingTag, setPendingTag] = useState<{
    captureId: string;
  } | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const startedRef = useRef(false);

  const startCamera = useCallback(
    async (nextPosition: "rear" | "front" = position) => {
      try {
        // Compute 4:3 portrait viewport: width = full screen width, height = width * 4/3
        // Clamp to available area between top strip (~90pt) and bottom strip (~150pt).
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const topStripPt = 90;
        const bottomStripPt = 150;
        const availableH = screenH - topStripPt - bottomStripPt;
        const viewportW = Math.min(screenW, Math.round((availableH * 3) / 4));
        const viewportH = Math.round((viewportW * 4) / 3);
        const offsetX = Math.round((screenW - viewportW) / 2);
        const offsetY = topStripPt + Math.round((availableH - viewportH) / 2);

        await CameraPreview.start({
          position: nextPosition,
          parent: "camera-preview-mount",
          toBack: true,
          width: viewportW,
          height: viewportH,
          x: offsetX,
          y: offsetY,
          disableAudio: true,
        });
        startedRef.current = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPermissionError(message);
      }
    },
    [position],
  );

  const stopCamera = useCallback(async () => {
    // Don't gate on startedRef: if user exits between start() being called
    // and start() resolving, startedRef is still false but the native camera
    // is mid-startup. Always attempt stop; the catch covers not-started.
    try {
      await CameraPreview.stop();
    } catch (err) {
      console.warn("[65b] CameraPreview.stop failed", err);
    }
    startedRef.current = false;
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      void stopCamera();
    };
    // startCamera/stopCamera identity changes only when `position` changes; we
    // re-run this effect intentionally only on mount/unmount and call flip() for
    // position changes via the toggle handler below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The CameraPreview plugin renders the live feed *behind* the WebView
  // (toBack: true). For it to be visible, body + html backgrounds must be
  // transparent for the duration of the capture session.
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

  const handleFlip = useCallback(async () => {
    if (busy) return;
    const next = position === "rear" ? "front" : "rear";
    setPosition(next);
    try {
      await CameraPreview.flip();
    } catch (err) {
      // Some plugin builds require restart-on-flip; restart as fallback.
      await stopCamera();
      await startCamera(next);
    }
  }, [busy, position, startCamera, stopCamera]);

  const cycleFlash = useCallback(async () => {
    if (busy) return;
    const next = FLASH_NEXT[flash];
    setFlash(next);
    try {
      await CameraPreview.setFlashMode({
        flashMode: next as CameraPreviewFlashMode,
      });
    } catch {
      // Front camera or simulator may reject flash mode changes.
    }
  }, [busy, flash]);

  const persistCapture = useCallback(
    async (base64Data: string) => {
      const captureId = generateUuid();
      const sidecar = {
        client_capture_id: captureId,
        job_id: jobId,
        capture_session_id: sessionId,
        taken_at: new Date().toISOString(),
        capture_mode: mode,
        width: 0,
        height: 0,
        orientation: 1,
        caption: null,
        tag_ids: [],
      };
      await writeCapture({ base64Data, sidecar });
      const nextCount = count + 1;
      setCount(nextCount);
      onCaptureCountChange?.(nextCount);
      return captureId;
    },
    [count, jobId, mode, onCaptureCountChange, sessionId],
  );

  const handleShutter = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await CameraPreview.capture({ quality: 90 });
      const base64Data = result.value;
      const captureId = await persistCapture(base64Data);
      if (mode === "tag-after") {
        setCaptionDraft("");
        setTagDraft([]);
        setPendingTag({ captureId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPermissionError(message);
    } finally {
      setBusy(false);
    }
  }, [busy, mode, persistCapture]);

  const handleContinueAfterTag = useCallback(async () => {
    if (!pendingTag) return;
    setBusy(true);
    try {
      const { updateSidecar } = await import("@/lib/mobile/capture-storage");
      await updateSidecar(jobId, sessionId, pendingTag.captureId, {
        caption: captionDraft.trim() || null,
        tag_ids: tagDraft,
      });
    } finally {
      setPendingTag(null);
      setCaptionDraft("");
      setTagDraft([]);
      setBusy(false);
    }
  }, [captionDraft, jobId, pendingTag, sessionId, tagDraft]);

  const handleDone = useCallback(async () => {
    await stopCamera();
    onDone();
  }, [onDone, stopCamera]);

  const handleAbort = useCallback(async () => {
    await stopCamera();
    onAbort?.();
  }, [onAbort, stopCamera]);

  const toggleTagDraft = (tagId: string) => {
    setTagDraft((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  if (permissionError) {
    return (
      <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-black px-6 text-center text-white">
        <Camera className="mb-4 h-12 w-12 opacity-60" />
        <h2 className="mb-2 text-xl font-semibold">Camera unavailable</h2>
        <p className="mb-4 max-w-sm text-sm opacity-80">
          {permissionError}
        </p>
        <p className="mb-6 max-w-sm text-xs opacity-60">
          If you previously denied camera access, open iOS Settings &rarr;
          Nookleus &rarr; Camera and re-enable it, then return to this screen.
        </p>
        <button
          type="button"
          onClick={handleAbort}
          className="rounded-full bg-white/20 px-6 py-2 text-sm font-medium"
        >
          Back to job
        </button>
      </div>
    );
  }

  return (
    <div
      id="camera-preview-mount"
      className="fixed inset-0 z-[1000] flex flex-col text-white"
      style={{ backgroundColor: "#0F6E56" }}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),16px)] pb-3"
        style={{ backgroundColor: "#0F6E56" }}
      >
        <button
          type="button"
          onClick={handleAbort}
          className="rounded-full p-2 text-white active:bg-white/10"
          aria-label="Cancel capture"
        >
          <X className="h-6 w-6" />
        </button>

        {/* Top-right cluster — flip, flash, mode, settings will be added in Tasks 8-11 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFlip}
            className="rounded-full p-2 text-white active:bg-white/10"
            aria-label="Flip camera"
          >
            <RotateCw className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={cycleFlash}
            className="rounded-full p-2 text-white active:bg-white/10"
            aria-label={`Flash ${flash}`}
          >
            {flash === "off" && <ZapOff className="h-5 w-5" />}
            {flash === "on" && <Zap className="h-5 w-5 text-yellow-300" />}
            {flash === "torch" && <Flashlight className="h-5 w-5 text-yellow-300" />}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "tag-after" ? "rapid" : "tag-after")}
            className="rounded-full p-2 text-white active:bg-white/10"
            aria-label={`Mode: ${mode === "tag-after" ? "Tag after" : "Rapid"} — tap to switch`}
          >
            {mode === "tag-after" ? (
              <Tag className="h-5 w-5" />
            ) : (
              <Zap className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-full p-2 text-white active:bg-white/10"
            aria-label="Camera settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl"
          id="camera-preview-window"
          style={{
            aspectRatio: "3 / 4",
            width: "100%",
            maxHeight: "100%",
          }}
        />
      </div>

      <div
        className="flex flex-col items-center px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-3"
        style={{ backgroundColor: "#0F6E56" }}
      >
        {/* Count above the action row */}
        {count > 0 && (
          <div className="mb-3 text-3xl font-semibold text-white tabular-nums">
            {count}
          </div>
        )}

        {/* Action row: queue (left), shutter (center), done (right) */}
        <div className="flex w-full items-center justify-between gap-4">
          {/* Queue button — Task 16 */}
          <div className="w-20" />

          {/* Shutter */}
          <button
            type="button"
            onClick={handleShutter}
            disabled={busy || pendingTag !== null}
            className={cn(
              "h-20 w-20 rounded-full bg-white transition active:scale-95",
              "border-[3px] border-white/40",
              busy || pendingTag !== null ? "opacity-60" : "opacity-100",
            )}
            aria-label="Capture photo"
          />

          {/* Done pill — Task 15 */}
          <div className="w-20" />
        </div>
      </div>

      {settingsOpen && (
        <div
          className="absolute inset-x-0 bottom-0 z-[1020] rounded-t-2xl px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-5"
          style={{ backgroundColor: "rgba(15, 110, 86, 0.95)" }}
        >
          <h3 className="mb-3 text-base font-semibold">Camera settings</h3>
          <p className="mb-6 text-sm text-white/80">
            Settings will appear here in a future update.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-full bg-white px-5 py-2 text-sm font-medium text-[#0F6E56]"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {pendingTag && (
        <div className="absolute inset-x-0 bottom-0 z-[1010] rounded-t-2xl bg-black/80 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-5 backdrop-blur">
          <h3 className="mb-3 text-sm font-medium">Tag this photo</h3>
          <input
            type="text"
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            placeholder="Caption (optional)"
            className="mb-3 w-full rounded-md border border-white/30 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-white"
          />
          <div className="mb-4 flex flex-wrap gap-2">
            {tagsLoading && (
              <span className="text-xs text-white/60">Loading tags&hellip;</span>
            )}
            {tagsError && !tagsLoading && (
              <span className="text-xs text-red-300">
                Couldn&apos;t load tags ({tagsError}). Caption still saves.
              </span>
            )}
            {!tagsLoading &&
              !tagsError &&
              tags.length === 0 && (
                <span className="text-xs text-white/60">
                  No tags configured for this workspace yet.
                </span>
              )}
            {!tagsLoading &&
              tags.map((tag) => {
                const active = tagDraft.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    onClick={() => toggleTagDraft(tag.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      active
                        ? "border-white bg-white text-black"
                        : "border-white/30 bg-transparent text-white",
                    )}
                    style={
                      active
                        ? { backgroundColor: tag.color, borderColor: tag.color, color: "white" }
                        : undefined
                    }
                  >
                    {tag.name}
                  </button>
                );
              })}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleContinueAfterTag}
              disabled={busy}
              className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// CaptureMode is re-exported here only for downstream callers that prefer
// importing alongside this component. Keep CaptureMode the canonical type.
export type { CaptureMode };

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Flashlight,
  Gauge,
  List,
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
import { useUploadQueue } from "@/lib/mobile/upload-queue-context";
import { UploadQueueSheet } from "@/components/mobile/upload-queue-sheet";
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
  const { counts } = useUploadQueue();
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
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const startedRef = useRef(false);

  const startCamera = useCallback(
    async (nextPosition: "rear" | "front" = position) => {
      try {
        // The native CameraPreview adds its previewView as a subview of the
        // WKWebView's superview (= iOS root view, origin at screen top-left).
        // Our CSS lives inside the WebView, which Capacitor's
        // contentInset:'automatic' offsets below the status bar by
        // env(safe-area-inset-top) — so CSS y=0 ≈ screen y=safeAreaTop.
        //
        // Layout: camera is full-width and flush to the screen top so the
        // iOS status bar overlays directly on the live preview. We render
        // the native rect from screen (0,0) down to safeAreaTop + cssHeight
        // so its bottom edge aligns with the bottom of the CSS viewport
        // (where the corner masks live). x=0, y=0 also dodges the plugin's
        // odd `x/UIScreen.main.scale` division on iOS — both stay 0.
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;top:0;height:env(safe-area-inset-top,0px);width:0;pointer-events:none;visibility:hidden;";
        document.body.appendChild(probe);
        const safeAreaTop = probe.getBoundingClientRect().height;
        probe.remove();

        const windowEl = document.getElementById("camera-preview-window");
        const cssRect = windowEl?.getBoundingClientRect();
        const screenW = window.innerWidth;
        const cssWidth = cssRect ? Math.round(cssRect.width) : screenW;
        const cssHeight = cssRect
          ? Math.round(cssRect.height)
          : Math.round((screenW * 4) / 3);

        await CameraPreview.start({
          position: nextPosition,
          parent: "camera-preview-mount",
          toBack: true,
          width: cssWidth,
          height: Math.round(cssHeight + safeAreaTop),
          x: 0,
          y: 0,
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
    if (count > 0) {
      setShowLeaveConfirm(true);
      return;
    }
    await stopCamera();
    onAbort?.();
  }, [count, onAbort, stopCamera]);

  const handleConfirmLeave = useCallback(async () => {
    setShowLeaveConfirm(false);
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
        <Camera className="mb-4 h-12 w-12 opacity-70" />
        <h2 className="mb-2 text-xl font-semibold">Camera unavailable</h2>
        <p className="mb-4 max-w-sm text-sm text-white/85">
          {permissionError}
        </p>
        <p className="mb-6 max-w-sm text-xs text-white/65">
          If you previously denied camera access, open iOS Settings &rarr;
          Nookleus &rarr; Camera and re-enable it, then return to this screen.
        </p>
        <button
          type="button"
          onClick={handleAbort}
          className="rounded-full bg-gradient-to-br from-[#1a8a6c] to-[#0a4d3e] px-6 py-2 text-sm font-medium text-white shadow-lg shadow-[#0F6E56]/50 ring-1 ring-inset ring-white/15 active:from-[#0F6E56] active:to-[#08362c]"
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
    >
      {/* Camera viewport: full-width, flush to screen top. The native */}
      {/* CameraPreview renders behind the WebView and extends up under the */}
      {/* iOS status bar (which overlays on top). Only the BOTTOM corners */}
      {/* are rounded (top is flush with the screen edge). All controls now */}
      {/* live below the camera in the bottom strip. */}
      <div className="relative shrink-0" style={{ aspectRatio: "3 / 4" }}>
        <div className="absolute inset-0" id="camera-preview-window" />

        {/* Bottom-corner masks: paint quarter-circle black wedges over the */}
        {/* native camera's hard bottom corners so they look rounded. */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-6 w-6"
          style={{ background: "radial-gradient(circle at 100% 0%, transparent 24px, #000 25px)" }}
        />
        <div
          className="pointer-events-none absolute bottom-0 right-0 h-6 w-6"
          style={{ background: "radial-gradient(circle at 0% 0%, transparent 24px, #000 25px)" }}
        />
      </div>

      <div className="flex flex-1 flex-col justify-between bg-black px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-3">
        {/* Camera-control row: X exit, flip, flash, mode, settings. */}
        {/* Sits directly below the camera viewport. */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleAbort}
            className="rounded-full p-2 text-white active:bg-white/10"
            aria-label="Cancel capture"
          >
            <X className="h-6 w-6" />
          </button>
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
              <Gauge className="h-5 w-5" />
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

        {/* Bottom group: count above the action row, pushed to the bottom */}
        {/* by the outer justify-between. */}
        <div>
          {count > 0 && (
            <div className="mb-2 text-lg font-semibold text-white tabular-nums">
              {count}
            </div>
          )}

          {/* Action row: queue (left), shutter (center), done (right). */}
          {/* Grid columns so the shutter sits dead-center regardless of side widths. */}
          <div className="grid w-full grid-cols-3 items-center">
          {/* Queue button */}
          <div className="justify-self-center">
            <button
              type="button"
              onClick={() => setQueueSheetOpen(true)}
              className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#1a8a6c] to-[#0a4d3e] text-white shadow-lg shadow-[#0F6E56]/50 ring-1 ring-inset ring-white/15 active:from-[#0F6E56] active:to-[#08362c]"
              aria-label="Open upload queue"
            >
              <List className="h-5 w-5" />
              {counts.failed > 0 && (
                <span
                  className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
                  aria-label={`${counts.failed} upload${counts.failed === 1 ? "" : "s"} failed`}
                />
              )}
              {counts.failed === 0 && counts.uploading + counts.pending > 0 && (
                <span
                  className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-400"
                  aria-label={`${counts.uploading + counts.pending} uploading`}
                />
              )}
            </button>
          </div>

          {/* Shutter */}
          <button
            type="button"
            onClick={handleShutter}
            disabled={busy || pendingTag !== null}
            className={cn(
              "h-20 w-20 justify-self-center rounded-full bg-white transition active:scale-95",
              "border-[5px] border-[#0F6E56]/60",
              busy || pendingTag !== null ? "opacity-60" : "opacity-100",
            )}
            aria-label="Capture photo"
          />

          {/* Done pill */}
          <div className="justify-self-center">
            <button
              type="button"
              onClick={handleDone}
              className="rounded-full bg-gradient-to-br from-[#1a8a6c] to-[#0a4d3e] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#0F6E56]/50 ring-1 ring-inset ring-white/15 active:from-[#0F6E56] active:to-[#08362c]"
              aria-label="Finish capture session"
            >
              Done
            </button>
          </div>
        </div>
        </div>
      </div>

      {showLeaveConfirm && (
        <div className="absolute inset-0 z-[1030] flex items-center justify-center bg-black/70 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-black p-6 text-white">
            <h3 className="mb-3 text-lg font-semibold">Leave camera?</h3>
            <p className="mb-6 text-sm text-white/85">
              Your {count} photo{count === 1 ? "" : "s"} will still upload.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="rounded-full bg-white/15 px-5 py-2 text-sm font-medium text-white active:bg-white/25"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={handleConfirmLeave}
                className="rounded-full bg-gradient-to-br from-[#1a8a6c] to-[#0a4d3e] px-5 py-2 text-sm font-medium text-white shadow-lg shadow-[#0F6E56]/50 ring-1 ring-inset ring-white/15 active:from-[#0F6E56] active:to-[#08362c]"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="absolute inset-x-0 bottom-0 z-[1020] rounded-t-2xl bg-black/95 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-5 backdrop-blur">
          <h3 className="mb-3 text-base font-semibold">Camera settings</h3>
          <p className="mb-6 text-sm text-white/80">
            Settings will appear here in a future update.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-full bg-gradient-to-br from-[#1a8a6c] to-[#0a4d3e] px-5 py-2 text-sm font-medium text-white shadow-lg shadow-[#0F6E56]/50 ring-1 ring-inset ring-white/15 active:from-[#0F6E56] active:to-[#08362c]"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {pendingTag && (
        <div className="absolute inset-x-0 bottom-0 z-[1010] rounded-t-2xl bg-black/95 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-5 backdrop-blur">
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
              className="rounded-full bg-gradient-to-br from-[#1a8a6c] to-[#0a4d3e] px-5 py-2 text-sm font-medium text-white shadow-lg shadow-[#0F6E56]/50 ring-1 ring-inset ring-white/15 active:from-[#0F6E56] active:to-[#08362c]"
            >
              Continue
            </button>
          </div>
        </div>
      )}
      <UploadQueueSheet open={queueSheetOpen} onOpenChange={setQueueSheetOpen} />
    </div>
  );
}

// CaptureMode is re-exported here only for downstream callers that prefer
// importing alongside this component. Keep CaptureMode the canonical type.
export type { CaptureMode };

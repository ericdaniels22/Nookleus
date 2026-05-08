"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  RotateCw,
  X,
  Zap,
  ZapOff,
  Bolt,
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

type FlashMode = "off" | "auto" | "on";

const FLASH_NEXT: Record<FlashMode, FlashMode> = {
  off: "auto",
  auto: "on",
  on: "off",
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
  const startedRef = useRef(false);

  const startCamera = useCallback(
    async (nextPosition: "rear" | "front" = position) => {
      try {
        await CameraPreview.start({
          position: nextPosition,
          parent: "camera-preview-mount",
          toBack: true,
          width: window.innerWidth,
          height: window.innerHeight,
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
    if (!startedRef.current) return;
    try {
      await CameraPreview.stop();
    } catch {
      // Stop errors are non-fatal here.
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
      const sidecar: CaptureSidecar = {
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
      className="fixed inset-0 z-[1000] flex flex-col bg-black/30 text-white"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),16px)]">
        <button
          type="button"
          onClick={handleAbort}
          className="rounded-full bg-black/50 p-2 backdrop-blur"
          aria-label="Cancel capture"
        >
          <X className="h-5 w-5" />
        </button>

        <div
          role="tablist"
          aria-label="Capture mode"
          className="flex items-center rounded-full bg-black/50 p-1 text-xs font-medium backdrop-blur"
        >
          <ModeButton
            active={mode === "rapid"}
            onClick={() => setMode("rapid")}
            label="Rapid"
          />
          <ModeButton
            active={mode === "tag-after"}
            onClick={() => setMode("tag-after")}
            label="Tag after"
          />
        </div>

        <button
          type="button"
          onClick={cycleFlash}
          className="rounded-full bg-black/50 p-2 backdrop-blur"
          aria-label={`Flash ${flash}`}
        >
          {flash === "off" && <ZapOff className="h-5 w-5" />}
          {flash === "auto" && <Bolt className="h-5 w-5" />}
          {flash === "on" && <Zap className="h-5 w-5 text-yellow-300" />}
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center justify-between gap-4 px-6 pb-[max(env(safe-area-inset-bottom),24px)]">
        <button
          type="button"
          onClick={handleFlip}
          className="rounded-full bg-black/50 p-3 backdrop-blur"
          aria-label="Flip camera"
        >
          <RotateCw className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={handleShutter}
          disabled={busy || pendingTag !== null}
          className={cn(
            "h-20 w-20 rounded-full border-4 border-white bg-white/30 backdrop-blur transition active:scale-95",
            busy || pendingTag !== null ? "opacity-60" : "opacity-100",
          )}
          aria-label="Capture photo"
        />

        <button
          type="button"
          onClick={handleDone}
          className="flex flex-col items-center gap-1 rounded-full bg-black/50 px-4 py-3 backdrop-blur"
          aria-label="Finish capture session"
        >
          <Check className="h-5 w-5" />
          <span className="text-xs font-medium">{count}</span>
        </button>
      </div>

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

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 transition",
        active ? "bg-white text-black" : "text-white/80",
      )}
    >
      {label}
    </button>
  );
}

// CaptureMode is re-exported here only for downstream callers that prefer
// importing alongside this component. Keep CaptureMode the canonical type.
export type { CaptureMode };

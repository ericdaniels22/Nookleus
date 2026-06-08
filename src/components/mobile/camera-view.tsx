"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import type { CaptureMode } from "@/lib/mobile/capture-types";
import { useCaptureMode } from "@/lib/mobile/use-capture-mode";
import { usePhotoTags } from "@/lib/mobile/use-photo-tags";
import { useUploadQueue } from "@/lib/mobile/upload-queue-context";
import { useViewportOrientation } from "@/lib/mobile/use-viewport-orientation";
import { useCameraLifecycle } from "@/lib/mobile/use-camera-lifecycle";
import {
  visibleZoomFactors,
  selectFactor,
  revertFactor,
  formatFactorLabel,
} from "@/lib/mobile/lens-zoom";
import {
  computeCameraLayout,
  type CameraLayout,
} from "@/lib/mobile/compute-camera-layout";
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

// Minimum space reserved for the controls strip in stacked (portrait) layout.
// Sized to comfortably fit Queue, Shutter, and Done with breathing room; iPad
// at 768pt portrait scales the 3:4 preview down so this fits. Not consulted in
// overlay (landscape) mode — controls float on top of the preview there.
const CONTROLS_MIN_SIZE = 200;

// Drop-shadow filter applied to bare white icons floating over the preview
// in overlay mode, so they remain legible against bright scene content.
const OVERLAY_ICON_SHADOW =
  "drop-shadow(0 1px 2px rgb(0 0 0 / 0.6)) drop-shadow(0 0 1px rgb(0 0 0 / 0.4))";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readSafeAreaTop(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;height:env(safe-area-inset-top,0px);width:0;pointer-events:none;visibility:hidden;";
  document.body.appendChild(probe);
  const safeAreaTop = probe.getBoundingClientRect().height;
  probe.remove();
  return safeAreaTop;
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
  const viewport = useViewportOrientation();
  const [position, setPosition] = useState<"rear" | "front">("rear");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [availableFactors, setAvailableFactors] = useState<number[]>([]);
  const [selectedFactor, setSelectedFactor] = useState<number>(1);
  const [confirmedFactor, setConfirmedFactor] = useState<number>(1);
  const [isSwitchingLens, setIsSwitchingLens] = useState(false);
  // `position` is declared above (line 88), so reading it here is safe. Drives
  // the render-time reset in Step 4 (React "adjust state when a prop changes").
  const [prevPosition, setPrevPosition] = useState(position);
  const [pendingTag, setPendingTag] = useState<{ captureId: string } | null>(
    null,
  );
  const [captionDraft, setCaptionDraft] = useState("");
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const safeAreaTopRef = useRef<number>(0);
  if (safeAreaTopRef.current === 0 && typeof document !== "undefined") {
    safeAreaTopRef.current = readSafeAreaTop();
  }

  const layout: CameraLayout = useMemo(
    () =>
      computeCameraLayout({
        viewportWidth: viewport.width || 1,
        viewportHeight: viewport.height || 1,
        controlsMinSize: CONTROLS_MIN_SIZE,
      }),
    [viewport.width, viewport.height],
  );

  useCameraLifecycle({
    rect: layout.previewRect,
    position,
    safeAreaTop: safeAreaTopRef.current,
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      setPermissionError(message);
    },
    // Wrap the setter instead of passing it directly. The direct pass also
    // typechecks (a setter accepting `number[] | updater` is assignable to a
    // `(factors: number[]) => void` callback by parameter contravariance), but
    // the explicit adapter documents the contract and avoids reviewer churn.
    onZoomFactorsAvailable: (factors) => setAvailableFactors(factors),
  });

  // Reset the toggle to 1× whenever `position` changes. The native session
  // rebuild on flip (useCameraLifecycle stop()+start()) re-selects the wide
  // lens at videoZoomFactor 1.0, so the UI must snap to 1× to stay in sync with
  // the feed. This is React's render-time "adjust state when a prop changes"
  // pattern — NOT a useEffect (see Step 1) — so it adds no
  // `react-hooks/set-state-in-effect` violation. It runs at most once per flip:
  // setPrevPosition makes the guard false on the immediate re-render.
  if (position !== prevPosition) {
    setPrevPosition(position);
    setSelectedFactor(1);
    setConfirmedFactor(1);
  }

  const handleFlip = useCallback(async () => {
    if (busy) return;
    const next = position === "rear" ? "front" : "rear";
    setPosition(next);
    try {
      await CameraPreview.flip();
    } catch {
      // Some plugin builds need restart-on-flip; the lifecycle hook will
      // restart automatically because `position` changed.
    }
  }, [busy, position]);

  const handleSetZoom = useCallback(
    async (factor: number) => {
      // Drop taps while a switch is in flight or the shutter is busy — two
      // reconfigurations must never overlap (spec §5).
      if (isSwitchingLens || busy) return;
      const optimistic = selectFactor({ selectedFactor, confirmedFactor }, factor);
      if (optimistic.selectedFactor === selectedFactor) return; // tap on active stop
      setSelectedFactor(optimistic.selectedFactor);
      setIsSwitchingLens(true);
      try {
        await CameraPreview.setZoom({ factor });
        setConfirmedFactor(factor);
      } catch {
        // Native rejected (e.g. lens missing) — revert the optimistic highlight.
        const reverted = revertFactor({
          selectedFactor: optimistic.selectedFactor,
          confirmedFactor,
        });
        setSelectedFactor(reverted.selectedFactor);
      } finally {
        setIsSwitchingLens(false);
      }
    },
    [busy, confirmedFactor, isSwitchingLens, selectedFactor],
  );

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

  const handleDone = useCallback(() => {
    onDone();
  }, [onDone]);

  const handleAbort = useCallback(() => {
    if (count > 0) {
      setShowLeaveConfirm(true);
      return;
    }
    onAbort?.();
  }, [count, onAbort]);

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false);
    onAbort?.();
  }, [onAbort]);

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
        <p className="mb-4 max-w-sm text-sm text-white/85">{permissionError}</p>
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

  const stacked = layout.mode === "stacked";

  // Segmented lens toggle. Rendered only when more than one stop is available
  // and on the rear camera (visibleZoomFactors enforces both). Disabled (but
  // visible, dimmed) while a switch is in flight; taps are dropped, not queued.
  const visibleFactors = visibleZoomFactors(availableFactors, position);
  const lensPill =
    visibleFactors.length > 1 ? (
      <div
        data-testid="camera-lens-pill"
        className={cn(
          "flex items-center gap-1 rounded-full border border-white/25 bg-black/40 p-1",
          (isSwitchingLens || busy) && "opacity-50",
        )}
      >
        {visibleFactors.map((factor) => {
          const active = factor === selectedFactor;
          return (
            <button
              key={factor}
              type="button"
              disabled={isSwitchingLens || busy}
              onClick={() => handleSetZoom(factor)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                active ? "bg-white text-black" : "bg-transparent text-white",
              )}
              aria-pressed={active}
              aria-label={`Zoom ${formatFactorLabel(factor)}`}
            >
              {formatFactorLabel(factor)}
            </button>
          );
        })}
      </div>
    ) : null;

  // Stacked-only top strip: X cancel + four icons. In overlay mode the X
  // disappears and the four icons move into the floating top-right cluster.
  const stackedTopRow = (
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
  );

  // Overlay top-right cluster: mode → flip → flash → settings. Bare white
  // icons with a drop-shadow for legibility; no chip backgrounds.
  const overlayTopCluster = (
    <div
      data-testid="camera-top-cluster"
      className="pointer-events-auto absolute z-[1015] flex items-center gap-3"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 12px)",
        right: "calc(env(safe-area-inset-right, 0px) + 16px)",
        filter: OVERLAY_ICON_SHADOW,
      }}
    >
      <button
        type="button"
        onClick={() => setMode(mode === "tag-after" ? "rapid" : "tag-after")}
        className="rounded-full p-2 text-white active:bg-white/10"
        aria-label={`Mode: ${mode === "tag-after" ? "Tag after" : "Rapid"} — tap to switch`}
      >
        {mode === "tag-after" ? (
          <Tag className="h-6 w-6" />
        ) : (
          <Gauge className="h-6 w-6" />
        )}
      </button>
      <button
        type="button"
        onClick={handleFlip}
        className="rounded-full p-2 text-white active:bg-white/10"
        aria-label="Flip camera"
      >
        <RotateCw className="h-6 w-6" />
      </button>
      <button
        type="button"
        onClick={cycleFlash}
        className="rounded-full p-2 text-white active:bg-white/10"
        aria-label={`Flash ${flash}`}
      >
        {flash === "off" && <ZapOff className="h-6 w-6" />}
        {flash === "on" && <Zap className="h-6 w-6 text-yellow-300" />}
        {flash === "torch" && <Flashlight className="h-6 w-6 text-yellow-300" />}
      </button>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className="rounded-full p-2 text-white active:bg-white/10"
        aria-label="Camera settings"
      >
        <Settings className="h-6 w-6" />
      </button>
    </div>
  );

  const queueButton = (
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
  );

  const shutterButton = (
    <button
      type="button"
      onClick={handleShutter}
      disabled={busy || pendingTag !== null}
      className={cn(
        "h-20 w-20 rounded-full bg-white transition active:scale-95",
        "border-[5px] border-[#0F6E56]/60",
        busy || pendingTag !== null ? "opacity-60" : "opacity-100",
      )}
      aria-label="Capture photo"
    />
  );

  const doneButton = (
    <button
      type="button"
      onClick={handleDone}
      className="rounded-full bg-gradient-to-br from-[#1a8a6c] to-[#0a4d3e] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#0F6E56]/50 ring-1 ring-inset ring-white/15 active:from-[#0F6E56] active:to-[#08362c]"
      aria-label="Finish capture session"
    >
      Done
    </button>
  );

  return (
    <div
      id="camera-preview-mount"
      className={cn(
        "fixed inset-0 z-[1000] text-white",
        // No background on this outer container. The native camera lives
        // BEHIND the WebView (toBack:true) and shows through any transparent
        // WebView pixel — useCameraLifecycle sets html+body transparent for
        // this exact reason. An opaque bg here paints over the entire camera.
        // Non-4:3 iPads get black side margins from the bezel strips below.
        stacked ? "flex flex-col" : "block",
      )}
      data-testid="camera-root"
    >
      <span data-testid="camera-layout-mode" className="sr-only">
        {layout.mode}
      </span>

      {stacked ? (
        <>
          {/* Stacked: preview on top, full-width, scaled to fit controls. */}
          <div
            className="relative shrink-0 self-center"
            style={{
              width: layout.previewRect.width,
              height: layout.previewRect.height,
            }}
          >
            <div className="absolute inset-0" id="camera-preview-window" />
            <div
              className="pointer-events-none absolute bottom-0 left-0 h-6 w-6"
              style={{
                background:
                  "radial-gradient(circle at 100% 0%, transparent 24px, #000 25px)",
              }}
            />
            <div
              className="pointer-events-none absolute bottom-0 right-0 h-6 w-6"
              style={{
                background:
                  "radial-gradient(circle at 0% 0%, transparent 24px, #000 25px)",
              }}
            />
          </div>

          <div
            className="flex flex-1 flex-col justify-between bg-black px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-3"
            data-testid="camera-controls-panel"
          >
            {stackedTopRow}

            <div>
              {count > 0 && (
                <div className="mb-2 text-lg font-semibold text-white tabular-nums">
                  {count}
                </div>
              )}
              {lensPill && (
                <div className="mb-3 flex justify-center">{lensPill}</div>
              )}
              <div className="grid w-full grid-cols-3 items-center">
                <div className="justify-self-center">{queueButton}</div>
                <div className="justify-self-center">{shutterButton}</div>
                <div className="justify-self-center">{doneButton}</div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Black bezel strips covering only the side margins outside the
              centered 4:3 preview rect. Kept narrow & local so the camera
              area of the WebView stays transparent. Skipped when previewRect
              is edge-to-edge (4:3 viewports like 12.9" iPad landscape). */}
          {layout.previewRect.x > 0 && (
            <>
              <div
                data-testid="camera-left-bezel"
                className="absolute bottom-0 left-0 top-0 bg-black"
                style={{ width: layout.previewRect.x }}
              />
              <div
                data-testid="camera-right-bezel"
                className="absolute bottom-0 right-0 top-0 bg-black"
                style={{ width: layout.previewRect.x }}
              />
            </>
          )}

          {/* Overlay preview rect: must stay transparent — the native camera
              renders BEHIND the WebView at these coords (toBack:true) and any
              opaque background here paints a black square over the feed. */}
          <div
            data-testid="camera-preview-rect"
            className="absolute"
            style={{
              left: layout.previewRect.x,
              top: layout.previewRect.y,
              width: layout.previewRect.width,
              height: layout.previewRect.height,
            }}
          >
            <div className="absolute inset-0" id="camera-preview-window" />
          </div>

          {overlayTopCluster}

          <div
            data-testid="camera-right-rail"
            className="pointer-events-auto absolute z-[1015] flex flex-col items-center gap-4"
            style={{
              top: "50%",
              right: "calc(env(safe-area-inset-right, 0px) + 16px)",
              transform: "translateY(-50%)",
            }}
          >
            {doneButton}
            {count > 0 && (
              <div
                data-testid="camera-capture-count"
                className="text-2xl font-bold text-white tabular-nums"
                style={{ textShadow: "0 1px 2px rgb(0 0 0 / 0.7)" }}
              >
                {count}
              </div>
            )}
            {lensPill && (
              <div style={{ filter: OVERLAY_ICON_SHADOW }}>{lensPill}</div>
            )}
            {shutterButton}
            {queueButton}
          </div>
        </>
      )}

      {showLeaveConfirm && stacked && (
        <div
          data-testid="leave-confirm"
          data-mode={layout.mode}
          className="absolute inset-0 z-[1030] flex items-center justify-center bg-black/70 px-6"
        >
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
        <div
          data-testid="settings-sheet"
          data-mode={layout.mode}
          className={cn(
            "absolute z-[1020] bg-black/95 px-5 backdrop-blur",
            stacked
              ? "inset-x-0 bottom-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),20px)] pt-5"
              : "inset-y-0 right-0 w-[40vw] rounded-l-2xl py-5 pb-[max(env(safe-area-inset-bottom),20px)]",
          )}
        >
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
        <div
          data-testid="tag-sheet"
          data-mode={layout.mode}
          className={cn(
            "absolute z-[1010] bg-black/95 px-5 backdrop-blur",
            stacked
              ? "inset-x-0 bottom-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),20px)] pt-5"
              : "inset-y-0 right-0 w-[40vw] rounded-l-2xl py-5 pb-[max(env(safe-area-inset-bottom),20px)]",
          )}
        >
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
            {!tagsLoading && !tagsError && tags.length === 0 && (
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
                        ? {
                            backgroundColor: tag.color,
                            borderColor: tag.color,
                            color: "white",
                          }
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

export type { CaptureMode };

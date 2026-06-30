"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Photo, PhotoTag } from "@/lib/types";
import { photoUrl } from "@/lib/jobs/photo-url";
import {
  orderPhotosForViewer,
  nextPhotoIndex,
  prevPhotoIndex,
  hasNext,
  hasPrev,
  indexAfterDelete,
} from "@/lib/jobs/photo-viewer-navigation";
import { mediaCapabilities } from "@/lib/jobs/photo-media-capabilities";
import { useDebouncedSave } from "@/lib/jobs/use-debounced-save";
import { isPhoneViewport } from "@/lib/jobs/photo-viewer-layout";
import { useViewportOrientation } from "@/lib/mobile/use-viewport-orientation";
import { exportVersion } from "@/lib/jobs/photo-export-version";
import { shareOrDownloadFile } from "@/lib/share/share-or-download";
import {
  FIT,
  ZOOM_STEP,
  zoomBy,
  zoomAbout,
  doubleTap,
  pan,
  type Transform,
  type ViewportContext,
  type Focal,
} from "@/lib/jobs/photo-zoom-transform";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Check,
  Tag,
  Download,
  Trash2,
  Pencil,
  RotateCcw,
  X,
  MoreHorizontal,
  Share2,
  ArrowDownToLine,
  Copy,
  Star,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Info,
  ArrowLeftRight,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// How long the deleted Photo lingers — hidden but recoverable — before the
// permanent hard delete commits (#515). Matches the Undo toast's lifetime.
const UNDO_WINDOW_MS = 5000;

// A safe-area-aware slide-up panel for the phone layout (#520) — the bottom
// sheet each action button raises. Mirrors the existing pattern: a full-screen
// scrim that dismisses on tap and a rounded panel pinned to the bottom edge,
// its scroll area padded past the iOS home indicator with
// pb-[max(env(safe-area-inset-bottom),24px)]. Renders nothing when closed, so
// its contents never collide with the desktop layout's controls.
function PhoneSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[95] flex items-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[max(env(safe-area-inset-bottom),24px)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#1A1A1A]">{title}</h2>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#666666] hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function PhotoViewer({
  open,
  onOpenChange,
  photos,
  initialPhotoIndex,
  allTags,
  supabaseUrl,
  coverPhotoId,
  jobName,
  onUpdated,
  onAnnotate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: Photo[];
  initialPhotoIndex: number;
  allTags: PhotoTag[];
  supabaseUrl: string;
  coverPhotoId: string | null;
  /** The Job's display name, shown in the phone layout's top bar (#520). */
  jobName?: string;
  onUpdated: () => void;
  onAnnotate: (photo: Photo, url: string) => void;
}) {
  // Navigation runs over the Job's Photos newest-first and continuous across
  // the grid's date dividers (#515) — the dividers are display context, not
  // navigation stops. `removedIds` hides a Photo the instant its delete is
  // confirmed while the real delete waits out the Undo window, so the viewer
  // advances immediately and Undo can bring it straight back.
  const ordered = useMemo(() => orderPhotosForViewer(photos), [photos]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visiblePhotos = useMemo(
    () => ordered.filter((p) => !removedIds.has(p.id)),
    [ordered, removedIds],
  );

  const initialId = photos[initialPhotoIndex]?.id ?? null;
  const [currentIndex, setCurrentIndex] = useState(0);
  // Seed the position when the viewer opens on a Photo — DURING render, not in a
  // post-paint effect (#636). The viewer instance is always mounted (the parent
  // just toggles `open`), so `currentIndex` survives across opens; seeding it in
  // an effect let the first frame paint the Photo left over from the previous
  // open before the effect corrected it — on a slow connection the wrong photo
  // visibly "pulled up". Correcting during render (the picker viewer does the
  // same for its zoom) makes the first paint the opened Photo. Keyed on the
  // opened Photo's id, not the `photos` array, so a background refetch doesn't
  // yank the user back to where they started; reset on close so the next open
  // re-seeds even onto the same Photo.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && seededFor !== initialId) {
    setSeededFor(initialId);
    setRemovedIds(new Set());
    const idx = ordered.findIndex((p) => p.id === initialId);
    setCurrentIndex(idx >= 0 ? idx : 0);
  } else if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  const safeIndex = Math.min(currentIndex, visiblePhotos.length - 1);
  const currentPhoto = visiblePhotos[safeIndex];
  const isCover = !!currentPhoto && currentPhoto.id === coverPhotoId;

  const goNext = () =>
    setCurrentIndex(nextPhotoIndex(safeIndex, visiblePhotos.length));
  const goPrev = () => setCurrentIndex(prevPhotoIndex(safeIndex));

  // Deletes still inside their Undo window, keyed by Photo id. Each holds the
  // pending commit timer and the Photo, so a commit (on window-elapse) or an
  // undo (clear timer) can run without re-deriving it from the list.
  const pendingDeletes = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; photo: Photo }>
  >(new Map());

  // On unmount, commit any deletes still in their Undo window so a confirmed
  // delete isn't silently lost when the user leaves the Job.
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      pending.forEach(({ timer, photo }) => {
        clearTimeout(timer);
        const supabase = createClient();
        void supabase.storage.from("photos").remove([photo.storage_path]);
        void supabase.from("photos").delete().eq("id", photo.id);
      });
      pending.clear();
    };
  }, []);

  // Zoom/pan state, applied on top of the image's object-contain fit. All the
  // math lives in the pure zoom-transform module; this is just the live state
  // plus the DOM measurements the gestures need. Each Photo opens at fit.
  const [transform, setTransform] = useState<Transform>(FIT);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const isZoomed = transform.scale > 1;

  // Phone vs desktop is chosen at runtime from the live viewport width: narrow
  // viewports get the full-bleed phone layout with slide-up action panels, wider
  // ones keep the desktop side panel (#520). The pure rule decides; the hook
  // just supplies the measured width (and re-renders on rotate/resize).
  const { width: viewportWidth } = useViewportOrientation();
  const isPhone = isPhoneViewport(viewportWidth);

  // The transform reasons in pixels: the surface's measured size is the
  // viewport, and the Photo's stored dimensions (falling back to the decoded
  // image) are the source size. Null until something is measurable, so handlers
  // no-op rather than divide by zero.
  function viewportCtx(): ViewportContext | null {
    const el = surfaceRef.current;
    if (!el || !currentPhoto) return null;
    const rect = el.getBoundingClientRect();
    const imageW = currentPhoto.width ?? imgRef.current?.naturalWidth ?? rect.width;
    const imageH = currentPhoto.height ?? imgRef.current?.naturalHeight ?? rect.height;
    if (!rect.width || !rect.height || !imageW || !imageH) return null;
    return { imageW, imageH, viewportW: rect.width, viewportH: rect.height };
  }

  // A client coordinate expressed relative to the surface (the focal point a
  // gesture zooms about).
  function focalFrom(clientX: number, clientY: number): Focal {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  const viewportCentre = (ctx: ViewportContext): Focal => ({
    x: ctx.viewportW / 2,
    y: ctx.viewportH / 2,
  });

  // ＋ / − buttons zoom a fixed step about the centre of the image.
  function zoomStep(direction: 1 | -1) {
    const ctx = viewportCtx();
    if (!ctx) return;
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setTransform((t) => zoomBy(t, factor, viewportCentre(ctx), ctx));
  }

  // Scroll-wheel / trackpad zoom about the cursor. The delta maps to a smooth
  // multiplicative factor so a trackpad's fine deltas and a mouse wheel's coarse
  // notches both feel even. preventDefault is best-effort (React's wheel
  // listener is passive) — enough to stop the page jumping under the viewer.
  function onWheel(e: React.WheelEvent) {
    if (!caps.canZoom) return;
    const ctx = viewportCtx();
    if (!ctx) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const focal = focalFrom(e.clientX, e.clientY);
    setTransform((t) => zoomBy(t, factor, focal, ctx));
  }

  // Double-click / double-tap snaps between fit and zoomed about the point.
  function onDoubleClick(e: React.MouseEvent) {
    if (!caps.canZoom) return;
    const ctx = viewportCtx();
    if (!ctx) return;
    const focal = focalFrom(e.clientX, e.clientY);
    setTransform((t) => doubleTap(t, focal, ctx));
  }

  // Mouse drag-to-pan (desktop). Only active while zoomed; each move pans by
  // the delta since the last point and the pure module clamps it to the edges.
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  function onMouseDown(e: React.MouseEvent) {
    if (!isZoomed) return;
    dragOrigin.current = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e: React.MouseEvent) {
    const origin = dragOrigin.current;
    if (!origin) return;
    const ctx = viewportCtx();
    if (!ctx) return;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    dragOrigin.current = { x: e.clientX, y: e.clientY };
    setTransform((t) => pan(t, dx, dy, ctx));
  }
  function endDrag() {
    dragOrigin.current = null;
  }

  // Touch gestures share the surface and are dispatched by finger count and
  // zoom state: two fingers pinch-zoom; one finger pans when zoomed or swipes
  // between Photos at fit; a quick double-tap toggles zoom. The pure module does
  // every transform; these refs only hold the in-flight gesture's start state.
  const SWIPE_THRESHOLD = 50; // px a one-finger swipe must travel to page
  const TAP_MOVE = 10; // px under which a touch counts as a tap, not a drag
  const DOUBLE_TAP_MS = 300; // window for a second tap to count as a double-tap
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{ dist: number; transform: Transform } | null>(null);
  const touchPanLast = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  const touchDistance = (t: React.TouchList) =>
    Math.hypot(
      (t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0),
      (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0),
    );
  const touchMidpoint = (t: React.TouchList): Focal =>
    focalFrom(
      ((t[0]?.clientX ?? 0) + (t[1]?.clientX ?? 0)) / 2,
      ((t[0]?.clientY ?? 0) + (t[1]?.clientY ?? 0)) / 2,
    );

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      // Two fingers only ever mean pinch-zoom; ignore them where Zoom doesn't
      // apply (video) so the transform stays at fit.
      if (caps.canZoom) {
        pinchStart.current = { dist: touchDistance(e.touches), transform };
      }
      touchStart.current = null;
      touchPanLast.current = null;
      return;
    }
    const t0 = e.touches[0];
    const x = t0?.clientX ?? 0;
    const y = t0?.clientY ?? 0;
    touchStart.current = { x, y };
    touchPanLast.current = isZoomed ? { x, y } : null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (pinchStart.current && e.touches.length >= 2) {
      const ctx = viewportCtx();
      if (!ctx) return;
      const start = pinchStart.current;
      const factor = touchDistance(e.touches) / start.dist;
      const focal = touchMidpoint(e.touches);
      setTransform(() =>
        zoomAbout(start.transform, start.transform.scale * factor, focal, ctx),
      );
      return;
    }
    const last = touchPanLast.current;
    if (last && e.touches.length === 1) {
      const ctx = viewportCtx();
      if (!ctx) return;
      const t0 = e.touches[0];
      const x = t0?.clientX ?? 0;
      const y = t0?.clientY ?? 0;
      const dx = x - last.x;
      const dy = y - last.y;
      touchPanLast.current = { x, y };
      setTransform((t) => pan(t, dx, dy, ctx));
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const pinched = pinchStart.current !== null;
    const panned = touchPanLast.current !== null;
    const start = touchStart.current;
    pinchStart.current = null;
    touchPanLast.current = null;
    touchStart.current = null;
    if (pinched) return;

    const end = e.changedTouches[0];
    const ex = end?.clientX ?? 0;
    const ey = end?.clientY ?? 0;
    const dx = start ? ex - start.x : 0;
    const moved = start ? Math.hypot(ex - start.x, ey - start.y) : 0;

    // A near-stationary touch is a tap — a second one inside the window snaps
    // zoom about the point (the touch equivalent of a double-click).
    if (moved < TAP_MOVE) {
      const now = Date.now();
      const prev = lastTap.current;
      if (
        prev &&
        now - prev.time < DOUBLE_TAP_MS &&
        Math.hypot(ex - prev.x, ey - prev.y) < TAP_MOVE
      ) {
        lastTap.current = null;
        const ctx = viewportCtx();
        if (caps.canZoom && ctx) {
          setTransform((t) => doubleTap(t, focalFrom(ex, ey), ctx));
        }
      } else {
        lastTap.current = { time: now, x: ex, y: ey };
      }
      return;
    }

    // A drag: it already panned if zoomed; at fit it pages between Photos.
    if (panned || isZoomed) return;
    if (dx <= -SWIPE_THRESHOLD) goNext();
    else if (dx >= SWIPE_THRESHOLD) goPrev();
  };

  const [caption, setCaption] = useState("");
  const [beforeAfterRole, setBeforeAfterRole] = useState<
    "before" | "after" | null
  >(null);
  const [assignedTagIds, setAssignedTagIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [hasOriginalBackup, setHasOriginalBackup] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Which phone slide-up panel is raised, if any (#520). Only one at a time; the
  // desktop layout never opens these (it has the always-visible side panel).
  const [phoneSheet, setPhoneSheet] = useState<
    null | "tags" | "beforeAfter" | "info" | "more"
  >(null);
  const [settingCover, setSettingCover] = useState(false);
  // Which export, if any, is in flight — so the chosen ⋯ menu entry shows a
  // spinner and both stay disabled until the share/download settles.
  const [exporting, setExporting] = useState<null | "share" | "save">(null);
  const [duplicating, setDuplicating] = useState(false);

  // Auto-save (#806): every editable field persists itself — no Save button.
  // A failed write retries silently and only warns if it still can't land; a
  // successful save is completely silent (no toast, no indicator). Caption
  // debounces on a 2s quiet window (matching estimate-builder); tags and
  // Before/After save immediately on change (delay 0). Each field gets its own
  // saver so one field's retry backoff never blocks another's write.
  const warnSaveFailed = () =>
    toast.error("Couldn't save your changes — check your connection.");
  const captionSaver = useDebouncedSave({ delay: 2000, onError: warnSaveFailed });
  const roleSaver = useDebouncedSave({ delay: 0, onError: warnSaveFailed });
  const tagsSaver = useDebouncedSave({ delay: 0, onError: warnSaveFailed });

  async function fetchTags(photoId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("photo_tag_assignments")
      .select("tag_id")
      .eq("photo_id", photoId);
    if (data) {
      setAssignedTagIds(data.map((d: { tag_id: string }) => d.tag_id));
    }
  }

  // The viewer can restore the un-annotated/un-cropped original when either a
  // crop `-original` backup exists in storage or the Photo carries annotations.
  async function checkOriginalBackup(p: Photo) {
    const supabase = createClient();
    const backupPath = p.storage_path.replace(/\.[^.]+$/, "-original$&");
    const { data: backupData } = await supabase.storage.from("photos").list(
      backupPath.substring(0, backupPath.lastIndexOf("/")),
      { search: backupPath.substring(backupPath.lastIndexOf("/") + 1) },
    );
    const hasCropBackup =
      !!backupData && backupData.some((f) => backupPath.endsWith(f.name));
    setHasOriginalBackup(hasCropBackup || !!p.annotated_path);
  }

  // Seed the editable fields from the opened Photo (re-seed if it changes).
  // Each Photo opens at fit — a leftover zoom must not carry into the next one.
  useEffect(() => {
    if (currentPhoto) {
      setCaption(currentPhoto.caption || "");
      setBeforeAfterRole(currentPhoto.before_after_role);
      setConfirmDelete(false);
      setTransform(FIT);
      fetchTags(currentPhoto.id);
      checkOriginalBackup(currentPhoto);
    }
    // AC (h): paging to another Photo re-runs this effect; flush any caption
    // edit still inside its window first. The pending thunk closed over the
    // Photo it was typed on, so the write lands there — not on the new Photo.
    return () => captionSaver.flush();
    // Intentionally keyed on the Photo id alone — re-seeding on every
    // currentPhoto identity change would clobber an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhoto?.id]);

  // AC (h): the viewer stays mounted when it closes (the parent only flips
  // `open`), so React's unmount flush never fires on close. Flush any caption
  // edit still inside its debounce window the moment the viewer is hidden, so
  // an in-window edit is persisted rather than silently dropped.
  useEffect(() => {
    if (!open) captionSaver.flush();
    // captionSaver.flush is stable; re-run only when open toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleRestoreOriginal() {
    if (!currentPhoto) return;
    setRestoring(true);
    const supabase = createClient();

    try {
      // Restore the crop backup if one exists.
      const backupPath = currentPhoto.storage_path.replace(
        /\.[^.]+$/,
        "-original$&",
      );
      const { data: backupData } = await supabase.storage.from("photos").list(
        backupPath.substring(0, backupPath.lastIndexOf("/")),
        { search: backupPath.substring(backupPath.lastIndexOf("/") + 1) },
      );
      const hasCropBackup =
        !!backupData && backupData.some((f) => backupPath.endsWith(f.name));

      if (hasCropBackup) {
        const { data: backupBlob } = await supabase.storage
          .from("photos")
          .download(backupPath);
        if (backupBlob) {
          await supabase.storage
            .from("photos")
            .upload(currentPhoto.storage_path, backupBlob, {
              upsert: true,
              contentType: backupBlob.type,
            });
          await supabase.storage.from("photos").remove([backupPath]);
        }
      }

      // Drop the annotated render if one exists.
      if (currentPhoto.annotated_path) {
        await supabase.storage.from("photos").remove([currentPhoto.annotated_path]);
        await supabase
          .from("photos")
          .update({ annotated_path: null })
          .eq("id", currentPhoto.id);
      }

      // Drop the annotation records.
      await supabase
        .from("photo_annotations")
        .delete()
        .eq("photo_id", currentPhoto.id);

      toast.success("Photo restored to original.");
      setHasOriginalBackup(false);
      onOpenChange(false);
      onUpdated();
    } catch (err) {
      console.error("Failed to restore original:", err);
      toast.error("Failed to restore original photo.");
    }
    setRestoring(false);
  }

  // Escape closes the viewer (mirrors the Annotator's window keydown pattern).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Arrow keys move between Photos, mirroring the on-screen arrows. Kept apart
  // from the Escape handler so its deps track the current position; the step
  // logic is inlined so the listener never closes over a stale index.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        setCurrentIndex(nextPhotoIndex(safeIndex, visiblePhotos.length));
      } else if (e.key === "ArrowLeft") {
        setCurrentIndex(prevPhotoIndex(safeIndex));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, safeIndex, visiblePhotos.length]);

  // Persist just the caption for a specific Photo. Throws on a Supabase error so
  // the saver's retry sees a rejection; refreshes the parent only on success.
  // Takes the Photo id (not currentPhoto) so a write still in flight when the
  // user pages to another Photo lands on the Photo that was edited.
  async function persistCaption(photoId: string, value: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("photos")
      .update({ caption: value || null })
      .eq("id", photoId);
    if (error) throw error;
    onUpdated();
  }

  // Persist just the Before/After role for a specific Photo. Throws on error so
  // the saver retries; refreshes the parent only on success.
  async function persistRole(
    photoId: string,
    role: "before" | "after" | null,
  ) {
    const supabase = createClient();
    const { error } = await supabase
      .from("photos")
      .update({ before_after_role: role })
      .eq("id", photoId);
    if (error) throw error;
    onUpdated();
  }

  // Toggle the Before/After role (clicking the active role clears it) and persist
  // immediately — no debounce, mirroring the modal's discrete choice (#806).
  function chooseRole(target: "before" | "after") {
    if (!currentPhoto) return;
    const next = beforeAfterRole === target ? null : target;
    setBeforeAfterRole(next);
    roleSaver.save(() => persistRole(currentPhoto.id, next));
  }

  // Replace a Photo's tag assignments with the modal's delete-all-then-insert,
  // scoped to the active org. Throws on error so the saver retries; refreshes the
  // parent only on success.
  async function persistTags(photoId: string, tagIds: string[]) {
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("photo_tag_assignments")
      .delete()
      .eq("photo_id", photoId);
    if (deleteError) throw deleteError;

    if (tagIds.length > 0) {
      const orgId = await getActiveOrganizationId(supabase);
      const { error: insertError } = await supabase
        .from("photo_tag_assignments")
        .insert(
          tagIds.map((tagId) => ({
            organization_id: orgId,
            photo_id: photoId,
            tag_id: tagId,
          })),
        );
      if (insertError) throw insertError;
    }
    onUpdated();
  }

  // Toggle a tag and persist immediately (delay 0) — no debounce. `next` is
  // computed from the current ids outside setState so the save thunk and the
  // optimistic UI agree even under StrictMode's double-invoked updater (#806).
  function toggleTag(tagId: string) {
    if (!currentPhoto) return;
    const next = assignedTagIds.includes(tagId)
      ? assignedTagIds.filter((t) => t !== tagId)
      : [...assignedTagIds, tagId];
    setAssignedTagIds(next);
    tagsSaver.save(() => persistTags(currentPhoto.id, next));
  }

  // Download the original-quality image. Reuses the grid's download route
  // (signed URL of the clean original — storage_path, never the annotated copy).
  async function handleDownload() {
    if (!currentPhoto) return;
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/jobs/${currentPhoto.job_id}/photos/download`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: [currentPhoto.id] }),
        },
      );
      const { urls } = (await res.json()) as {
        urls: { url: string; filename: string }[];
      };
      const first = urls[0];
      if (first) {
        const a = document.createElement("a");
        a.href = first.url;
        a.download = first.filename;
        a.click();
      }
    } catch {
      toast.error("Failed to download photo.");
    }
    setDownloading(false);
  }

  // Promote the current Photo to the Job's cover. Uses the existing direct
  // write the grid's star uses (jobs.cover_photo_id), keyed off this Photo's
  // job_id so the viewer stays self-contained.
  async function handleSetCover() {
    if (!currentPhoto) return;
    setSettingCover(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ cover_photo_id: currentPhoto.id })
      .eq("id", currentPhoto.job_id);
    setSettingCover(false);
    setMoreOpen(false);
    if (error) {
      toast.error("Failed to set cover photo.");
      return;
    }
    toast.success("Cover photo updated.");
    onUpdated();
  }

  // Share / Save to device act on the displayed version (annotated when drawn
  // on, else the original) — the pure export-version rule picks the file + name,
  // and the shared platform recipe opens the device share sheet or downloads,
  // falling back to a download where the Web Share API isn't available.
  async function handleExport(intent: "share" | "save") {
    if (!currentPhoto) return;
    setExporting(intent);
    try {
      const version = exportVersion(currentPhoto, supabaseUrl, intent);
      await shareOrDownloadFile({ ...version, mode: intent });
    } catch {
      toast.error(
        intent === "share" ? "Failed to share photo." : "Failed to save photo.",
      );
    }
    setExporting(null);
    setMoreOpen(false);
  }

  // Duplicate makes a clean same-Job copy of the Photo (#519). The work — copy
  // the clean original blob, insert the new row, re-link the tags — lives behind
  // the duplicate endpoint + deep module (never the drawings); the viewer kicks
  // it off and refetches so the fresh copy lands in the Job's grid.
  async function handleDuplicate() {
    if (!currentPhoto) return;
    setDuplicating(true);
    try {
      const res = await fetch(
        `/api/jobs/${currentPhoto.job_id}/photos/${currentPhoto.id}/duplicate`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("duplicate failed");
      toast.success("Photo duplicated.");
      onUpdated();
    } catch {
      toast.error("Failed to duplicate photo.");
    }
    setDuplicating(false);
    setMoreOpen(false);
  }

  // Delete is deferred behind an Undo window (#515). Confirming hides the Photo
  // and advances to the next (or closes on the last) immediately, then shows an
  // Undo toast; the permanent hard delete — storage object + photos row, which
  // cascades tag assignments + annotations — commits only once the window
  // elapses. Because there is no recycle bin, deferral is what makes the delete
  // recoverable: Undo cancels the pending commit before it ever runs.
  function commitDelete(photo: Photo) {
    pendingDeletes.current.delete(photo.id);
    void (async () => {
      const supabase = createClient();
      await supabase.storage.from("photos").remove([photo.storage_path]);
      const { error } = await supabase
        .from("photos")
        .delete()
        .eq("id", photo.id);
      if (error) {
        // The delete didn't take — surface the Photo again.
        toast.error("Failed to delete photo.");
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.delete(photo.id);
          return next;
        });
        return;
      }
      onUpdated();
    })();
  }

  function undoDelete(photo: Photo) {
    const pending = pendingDeletes.current.get(photo.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingDeletes.current.delete(photo.id);
    }
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(photo.id);
      return next;
    });
  }

  function handleConfirmDelete() {
    if (!currentPhoto) return;
    const photo = currentPhoto;
    const outcome = indexAfterDelete(safeIndex, visiblePhotos.length);

    setConfirmDelete(false);
    setMoreOpen(false);
    setRemovedIds((prev) => new Set(prev).add(photo.id));
    if (outcome.close) onOpenChange(false);
    else setCurrentIndex(outcome.index);

    const timer = setTimeout(() => commitDelete(photo), UNDO_WINDOW_MS);
    pendingDeletes.current.set(photo.id, { timer, photo });

    toast("Photo deleted", {
      action: { label: "Undo", onClick: () => undoDelete(photo) },
      duration: UNDO_WINDOW_MS,
    });
  }

  if (!open || !currentPhoto) return null;

  // Zoom and Draw act on a still image; a video has neither — it plays inline
  // with a scrub bar (PRD #511). The pure rule decides photo-vs-video and
  // supplies the media source, so the viewer branches in one place.
  // caps.source is the uniform media URL — the <img> src for a still, the
  // <video> src for a clip.
  const caps = mediaCapabilities(currentPhoto, supabaseUrl);

  // The full tag records for the Photo's current assignments, in the gallery's
  // tag order — drives both the on-photo pills (view-only) and the Tags panel's
  // selected state (#520).
  const assignedTags = allTags.filter((t) => assignedTagIds.includes(t.id));

  const toolbarBtn =
    "inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/50 text-white transition-colors";

  // A phone bottom-row action: a stacked icon + label, comfortably tappable.
  const phoneActionBtn =
    "flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium text-white transition-opacity active:opacity-60";

  // A row in the ⋯ More slide-up panel: an icon + label, full-width and tappable.
  const phoneMenuItem =
    "flex items-center gap-3 px-1 py-3 text-sm text-[#1A1A1A] text-left border-b border-gray-100 last:border-0 disabled:opacity-60";

  return (
    <div className="fixed inset-0 z-[90] flex bg-black">
      {/* Photo, centered + letterboxed on black, with the action toolbar over it */}
      <div
        ref={surfaceRef}
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{ cursor: isZoomed ? "grab" : undefined }}
      >
        {caps.isVideo ? (
          /* A video plays inline with the browser's native scrub bar (controls).
             Zoom/Draw don't apply, so it carries no zoom transform; playsInline
             keeps it in the viewer on iOS rather than hijacking to fullscreen. */
          <video
            src={caps.source}
            controls
            playsInline
            aria-label={currentPhoto.caption || "Video"}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <img
            ref={imgRef}
            src={caps.source}
            alt={currentPhoto.caption || "Photo"}
            className="max-w-full max-h-full object-contain"
            style={{
              transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
              transformOrigin: "center center",
            }}
            draggable={false}
          />
        )}

        {/* Zoom controls (desktop) — scroll-wheel and double-click also zoom;
            hidden for media that can't zoom (video) and on phones, where pinch /
            double-tap zoom replaces them and the bottom action row owns the
            bottom-left (#520). */}
        {caps.canZoom && !isPhone && (
          <div className="absolute bottom-3 left-3 flex flex-col gap-2">
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => zoomStep(1)}
              className={cn(toolbarBtn, "hover:bg-black/70")}
            >
              <ZoomIn size={18} />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => zoomStep(-1)}
              disabled={!isZoomed}
              className={cn(toolbarBtn, "hover:bg-black/70 disabled:opacity-40")}
            >
              <ZoomOut size={18} />
            </button>
          </div>
        )}

        {/* Prev / next — newest-first, continuous across the grid's date
            dividers, clamped at the ends (#515). */}
        {hasPrev(safeIndex) && (
          <button
            type="button"
            aria-label="Previous photo"
            title="Previous photo"
            onClick={goPrev}
            className={cn(
              toolbarBtn,
              "absolute left-3 top-1/2 -translate-y-1/2 hover:bg-black/70",
            )}
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {hasNext(safeIndex, visiblePhotos.length) && (
          <button
            type="button"
            aria-label="Next photo"
            title="Next photo"
            onClick={goNext}
            className={cn(
              toolbarBtn,
              "absolute right-3 top-1/2 -translate-y-1/2 hover:bg-black/70",
            )}
          >
            <ChevronRight size={22} />
          </button>
        )}

        {/* Desktop chrome over the Photo: close, cover badge, action toolbar,
            and the ⋯ menu. On a phone these give way to the top bar, the on-photo
            tag pills, and the bottom slide-up panels (#520). */}
        {!isPhone && (
          <>
        {/* Close back to the Job */}
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={() => onOpenChange(false)}
          className={cn(toolbarBtn, "absolute top-3 left-3 hover:bg-black/70")}
        >
          <X size={18} />
        </button>

        {/* Cover badge — mirrors the grid's gold "Cover" pill so the viewer
            indicates when the current Photo is the Job's cover. */}
        {isCover && (
          <div
            className="absolute top-3 left-14 flex items-center gap-1 h-9 px-2.5 rounded-full bg-[#F5A623] text-white text-xs font-semibold"
            title="Current cover photo"
          >
            <Star size={13} fill="currentColor" />
            Cover
          </div>
        )}

        {/* Toolbar over the photo */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {/* Edit hands off to the Annotator (drawing) — hidden for media that
              can't be drawn on (video). */}
          {caps.canDraw && (
            <button
              type="button"
              aria-label="Edit"
              title="Edit"
              onClick={() =>
                onAnnotate(currentPhoto, photoUrl(currentPhoto, supabaseUrl, "full"))
              }
              className={cn(toolbarBtn, "hover:bg-black/70")}
            >
              <Pencil size={18} />
            </button>
          )}
          <button
            type="button"
            aria-label="Download"
            title="Download"
            onClick={handleDownload}
            disabled={downloading}
            className={cn(toolbarBtn, "hover:bg-black/70 disabled:opacity-50")}
          >
            {downloading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Download size={18} />
            )}
          </button>
          <button
            type="button"
            aria-label="Delete"
            title="Delete"
            onClick={() => {
              setConfirmDelete(true);
              setMoreOpen(false);
            }}
            className={cn(toolbarBtn, "hover:bg-[#C41E2A]")}
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            aria-label="More"
            title="More"
            onClick={() => {
              setMoreOpen((o) => !o);
              setConfirmDelete(false);
            }}
            className={cn(toolbarBtn, "hover:bg-black/70")}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {/* ⋯ More menu — scaffolding for the less-frequent actions. Set as
            cover lives here; later slices add Share, Save to device, Duplicate. */}
        {moreOpen && (
          <div className="absolute top-14 right-3 bg-white rounded-lg shadow-lg p-1.5 min-w-[180px] flex flex-col">
            <button
              type="button"
              onClick={handleSetCover}
              disabled={settingCover || isCover}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[#1A1A1A] hover:bg-gray-100 rounded-md transition-colors disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {settingCover ? (
                <Loader2 size={14} className="animate-spin" />
              ) : isCover ? (
                <Check size={14} className="text-[#085041]" />
              ) : (
                <Star size={14} />
              )}
              {isCover ? "Cover photo" : "Set as cover"}
            </button>
            <button
              type="button"
              onClick={() => handleExport("share")}
              disabled={exporting !== null}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[#1A1A1A] hover:bg-gray-100 rounded-md transition-colors disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {exporting === "share" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Share2 size={14} />
              )}
              Share
            </button>
            <button
              type="button"
              onClick={() => handleExport("save")}
              disabled={exporting !== null}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[#1A1A1A] hover:bg-gray-100 rounded-md transition-colors disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {exporting === "save" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowDownToLine size={14} />
              )}
              Save to device
            </button>
            <button
              type="button"
              onClick={handleDuplicate}
              disabled={duplicating}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[#1A1A1A] hover:bg-gray-100 rounded-md transition-colors disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {duplicating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Copy size={14} />
              )}
              Duplicate
            </button>
          </div>
        )}
          </>
        )}

        {/* Phone top bar — ✕, the Job name, and an info (ⓘ) button that raises
            the details panel (#520). The full-bleed Photo sits behind it. */}
        {isPhone && (
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-6 bg-gradient-to-b from-black/60 to-transparent text-white">
            <button
              type="button"
              aria-label="Close"
              title="Close"
              onClick={() => onOpenChange(false)}
              className={cn(toolbarBtn, "shrink-0 hover:bg-black/70")}
            >
              <X size={18} />
            </button>
            <span className="flex-1 truncate text-sm font-semibold">
              {jobName}
            </span>
            <button
              type="button"
              aria-label="Photo details"
              title="Photo details"
              onClick={() => setPhoneSheet("info")}
              className={cn(toolbarBtn, "shrink-0 hover:bg-black/70")}
            >
              <Info size={18} />
            </button>
          </div>
        )}

        {/* On-photo tag pills (phone) — a view-only glance at how the Photo is
            tagged while swiping; editing happens in the Tags panel, so these are
            plain pills, never buttons (#520). */}
        {isPhone && assignedTags.length > 0 && (
          <div className="absolute left-3 right-3 top-[max(env(safe-area-inset-top),12px)] mt-12 flex flex-wrap gap-1.5">
            {assignedTags.map((tag) => (
              <span
                key={tag.id}
                className="px-2.5 py-1 rounded-full text-xs font-medium text-white shadow-sm"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="absolute top-14 right-3 bg-white rounded-lg shadow-lg p-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="text-sm text-white bg-[#C41E2A] hover:bg-[#A3171F] px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-sm text-[#666666] hover:text-[#1A1A1A]"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Phone bottom — the uploader · date · caption sit inline so the field
            user has context without opening anything (#520). The action row that
            raises the slide-up panels sits below it, closest to the thumb. */}
        {isPhone && (
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pt-10 pb-[max(env(safe-area-inset-bottom),12px)] bg-gradient-to-t from-black/70 via-black/40 to-transparent text-white">
            <div className="space-y-0.5">
              {currentPhoto.caption && (
                <p className="text-sm font-medium">{currentPhoto.caption}</p>
              )}
              <p className="text-xs text-white/70">
                {currentPhoto.taken_by}
                {" · "}
                {format(new Date(currentPhoto.created_at), "MMM d, yyyy")}
              </p>
            </div>

            {/* Action row — Tags · Draw · Before/After · ⋯ More. Tags,
                Before/After and More each raise their own slide-up panel; Draw
                hands off to the Annotator (hidden for video). */}
            <div className="flex items-stretch justify-around">
              <button
                type="button"
                aria-label="Tags"
                onClick={() => setPhoneSheet("tags")}
                className={phoneActionBtn}
              >
                <Tag size={20} />
                Tags
              </button>
              {caps.canDraw && (
                <button
                  type="button"
                  aria-label="Draw"
                  onClick={() =>
                    onAnnotate(
                      currentPhoto,
                      photoUrl(currentPhoto, supabaseUrl, "full"),
                    )
                  }
                  className={phoneActionBtn}
                >
                  <Pencil size={20} />
                  Draw
                </button>
              )}
              <button
                type="button"
                aria-label="Before / After"
                onClick={() => setPhoneSheet("beforeAfter")}
                className={phoneActionBtn}
              >
                <ArrowLeftRight size={20} />
                Before/After
              </button>
              <button
                type="button"
                aria-label="More"
                onClick={() => setPhoneSheet("more")}
                className={phoneActionBtn}
              >
                <MoreHorizontal size={20} />
                More
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Always-visible side panel (desktop) carries the modal's fields */}
      {!isPhone && (
      <aside className="w-[340px] shrink-0 bg-white border-l border-gray-200 overflow-y-auto p-4 space-y-4">
        {/* Caption */}
        <div>
          <label
            htmlFor="photo-viewer-caption"
            className="block text-sm font-medium text-[#666666] mb-1.5"
          >
            Caption
          </label>
          <Input
            id="photo-viewer-caption"
            aria-label="Caption"
            value={caption}
            onChange={(e) => {
              const value = e.target.value;
              setCaption(value);
              // Scheduling from the change handler (not a [caption] effect) means
              // only user edits enqueue a save — re-seeding on Photo change never
              // does. The thunk captures this Photo's id so a debounced write
              // still lands here if the user pages away before it fires.
              captionSaver.save(() => persistCaption(currentPhoto.id, value));
            }}
            placeholder="Describe this photo..."
          />
        </div>

        {/* Before / After */}
        <div>
          <label className="block text-sm font-medium text-[#666666] mb-1.5">
            Before / After
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => chooseRole("before")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                beforeAfterRole === "before"
                  ? "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/20"
                  : "bg-white text-[#666666] border-gray-200",
              )}
            >
              Before
            </button>
            <button
              type="button"
              onClick={() => chooseRole("after")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                beforeAfterRole === "after"
                  ? "bg-[#E1F5EE] text-[#085041] border-[#085041]/20"
                  : "bg-white text-[#666666] border-gray-200",
              )}
            >
              After
            </button>
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-[#666666] mb-1.5">
            <Tag size={14} className="inline mr-1 -mt-0.5" />
            Tags
          </label>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => {
              const selected = assignedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1",
                    selected
                      ? "text-white border-transparent"
                      : "bg-white text-[#666666] border-gray-200 hover:border-gray-300",
                  )}
                  style={
                    selected
                      ? { backgroundColor: tag.color, borderColor: tag.color }
                      : undefined
                  }
                >
                  {selected && <Check size={10} />}
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Read-only metadata */}
        <div className="text-xs text-[#999999] space-y-1 pt-2 border-t border-gray-100">
          <p>
            Uploaded:{" "}
            {format(new Date(currentPhoto.created_at), "MMM d, yyyy 'at' h:mm a")}
          </p>
          <p>By: {currentPhoto.taken_by}</p>
          {currentPhoto.file_size && (
            <p>Size: {(currentPhoto.file_size / 1024 / 1024).toFixed(1)} MB</p>
          )}
        </div>

        {/* Restore original (only when an annotation or crop backup exists) */}
        {hasOriginalBackup && (
          <div>
            <button
              type="button"
              onClick={handleRestoreOriginal}
              disabled={restoring}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#791F1F] hover:text-[#C41E2A] transition-colors disabled:opacity-50"
            >
              {restoring ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              Restore Original Photo
            </button>
          </div>
        )}
      </aside>
      )}

      {/* Phone slide-up panels (#520). Each action button raises its own; only
          one is open at a time. Tags and Before/After auto-save the moment they
          change (#806); the panel's Done just lowers it. */}
      {isPhone && (
        <>
          <PhoneSheet
            open={phoneSheet === "tags"}
            onClose={() => setPhoneSheet(null)}
            title="Tags"
          >
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const selected = assignedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-sm font-medium border transition-all flex items-center gap-1",
                      selected
                        ? "text-white border-transparent"
                        : "bg-white text-[#666666] border-gray-200 hover:border-gray-300",
                    )}
                    style={
                      selected
                        ? { backgroundColor: tag.color, borderColor: tag.color }
                        : undefined
                    }
                  >
                    {selected && <Check size={12} />}
                    {tag.name}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setPhoneSheet(null)}
              className="mt-4 w-full inline-flex items-center justify-center rounded-lg text-sm font-medium px-4 py-2.5 bg-[#C41E2A] hover:bg-[#A3171F] text-white transition-colors"
            >
              Done
            </button>
          </PhoneSheet>

          <PhoneSheet
            open={phoneSheet === "beforeAfter"}
            onClose={() => setPhoneSheet(null)}
            title="Before / After"
          >
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => chooseRole("before")}
                className={cn(
                  "flex-1 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all",
                  beforeAfterRole === "before"
                    ? "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/20"
                    : "bg-white text-[#666666] border-gray-200",
                )}
              >
                Before
              </button>
              <button
                type="button"
                onClick={() => chooseRole("after")}
                className={cn(
                  "flex-1 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all",
                  beforeAfterRole === "after"
                    ? "bg-[#E1F5EE] text-[#085041] border-[#085041]/20"
                    : "bg-white text-[#666666] border-gray-200",
                )}
              >
                After
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPhoneSheet(null)}
              className="mt-4 w-full inline-flex items-center justify-center rounded-lg text-sm font-medium px-4 py-2.5 bg-[#C41E2A] hover:bg-[#A3171F] text-white transition-colors"
            >
              Done
            </button>
          </PhoneSheet>

          <PhoneSheet
            open={phoneSheet === "more"}
            onClose={() => setPhoneSheet(null)}
            title="More"
          >
            <div className="flex flex-col">
              <button
                type="button"
                onClick={handleSetCover}
                disabled={settingCover || isCover}
                className={phoneMenuItem}
              >
                {settingCover ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : isCover ? (
                  <Check size={18} className="text-[#085041]" />
                ) : (
                  <Star size={18} />
                )}
                {isCover ? "Cover photo" : "Set as cover"}
              </button>
              <button
                type="button"
                onClick={() => handleExport("share")}
                disabled={exporting !== null}
                className={phoneMenuItem}
              >
                {exporting === "share" ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Share2 size={18} />
                )}
                Share
              </button>
              <button
                type="button"
                onClick={() => handleExport("save")}
                disabled={exporting !== null}
                className={phoneMenuItem}
              >
                {exporting === "save" ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <ArrowDownToLine size={18} />
                )}
                Save to device
              </button>
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={duplicating}
                className={phoneMenuItem}
              >
                {duplicating ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Copy size={18} />
                )}
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhoneSheet(null);
                  setConfirmDelete(true);
                }}
                className={cn(phoneMenuItem, "text-[#C41E2A]")}
              >
                <Trash2 size={18} />
                Delete
              </button>
            </div>
          </PhoneSheet>

          <PhoneSheet
            open={phoneSheet === "info"}
            onClose={() => setPhoneSheet(null)}
            title="Details"
          >
            <div className="text-sm text-[#444444] space-y-1.5">
              <p>
                <span className="text-[#999999]">Uploaded: </span>
                {format(
                  new Date(currentPhoto.created_at),
                  "MMM d, yyyy 'at' h:mm a",
                )}
              </p>
              <p>
                <span className="text-[#999999]">By: </span>
                {currentPhoto.taken_by}
              </p>
              {currentPhoto.file_size && (
                <p>
                  <span className="text-[#999999]">Size: </span>
                  {(currentPhoto.file_size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
            </div>
            {hasOriginalBackup && (
              <button
                type="button"
                onClick={handleRestoreOriginal}
                disabled={restoring}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#791F1F] hover:text-[#C41E2A] transition-colors disabled:opacity-50"
              >
                {restoring ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RotateCcw size={14} />
                )}
                Restore Original Photo
              </button>
            )}
          </PhoneSheet>
        </>
      )}
    </div>
  );
}

"use client";

// The Add-photos picker's fullscreen viewer: view-only + select. NOT a
// modification or extraction of the 1500-line PhotoViewer (two consumers;
// the shared logic already lives in pure modules — third-consumer heuristic).
// See docs/superpowers/specs/2026-06-10-add-photos-dialog-viewer-design.md §4.
//
// Rendered as a NESTED Base UI dialog: the picker dialog's popup centres
// itself with a CSS translate transform (a transformed ancestor would become
// the containing block for a `fixed` element rendered inline), and the picker
// dialog is modal — Base UI disables pointer interaction on everything outside
// its own dialog stack, so a plain createPortal(document.body) overlay would
// paint but never receive clicks. A nested Root + Portal + Popup escapes the
// transform, stays interactive, and takes over the focus trap while open.
// As the topmost dialog in the stack it also receives Escape first.

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/jobs/photo-url";
import {
  FIT,
  ZOOM_STEP,
  doubleTap,
  pan,
  zoomBy,
  type Focal,
  type Transform,
  type ViewportContext,
} from "@/lib/jobs/photo-zoom-transform";
import {
  hasNext,
  hasPrev,
  nextPhotoIndex,
  prevPhotoIndex,
} from "@/lib/jobs/photo-viewer-navigation";
import type { Photo } from "@/lib/types";

export type PickerViewerStatus = "free" | "in-target" | "elsewhere";

export interface PickerPhotoViewerProps {
  /** The filtered + sorted flat list the picker grid currently shows. */
  photos: Photo[];
  /** Index of the photo on screen, within `photos`. */
  index: number;
  onIndexChange: (index: number) => void;
  supabaseUrl: string;
  /** 1-based pick number when the photo is selected, else null. */
  selectedNumber: number | null;
  status: PickerViewerStatus;
  /** The other Section's title when status is "elsewhere". */
  elsewhereTitle?: string;
  onToggleSelect: (photoId: string) => void;
  onClose: () => void;
}

export function PickerPhotoViewer({
  photos,
  index,
  onIndexChange,
  supabaseUrl,
  selectedNumber,
  status,
  elsewhereTitle,
  onToggleSelect,
  onClose,
}: PickerPhotoViewerProps) {
  const photo = photos[index];

  const [transform, setTransform] = useState<Transform>(FIT);
  // Fresh photo, fresh framing — adjusted during render (not an effect) so
  // the old photo's zoom never paints on the new one.
  const [transformPhotoId, setTransformPhotoId] = useState<string | undefined>(
    photo?.id,
  );
  if (photo && photo.id !== transformPhotoId) {
    setTransformPhotoId(photo.id);
    setTransform(FIT);
  }

  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const isZoomed = transform.scale > 1;

  // Arrow keys page through the same list the grid shows. Escape is the
  // nested dialog's own dismissal (topmost in the Base UI stack).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        onIndexChange(nextPhotoIndex(index, photos.length));
      } else if (e.key === "ArrowLeft") {
        onIndexChange(prevPhotoIndex(index));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, photos.length, onIndexChange]);

  function viewportCtx(): ViewportContext | null {
    const el = surfaceRef.current;
    if (!el || !photo) return null;
    const rect = el.getBoundingClientRect();
    const imageW = photo.width ?? imgRef.current?.naturalWidth ?? rect.width;
    const imageH = photo.height ?? imgRef.current?.naturalHeight ?? rect.height;
    if (!rect.width || !rect.height || !imageW || !imageH) return null;
    return { imageW, imageH, viewportW: rect.width, viewportH: rect.height };
  }

  function focalFrom(clientX: number, clientY: number): Focal {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  const viewportCentre = (ctx: ViewportContext): Focal => ({
    x: ctx.viewportW / 2,
    y: ctx.viewportH / 2,
  });

  function zoomStep(direction: 1 | -1) {
    const ctx = viewportCtx();
    if (!ctx) return;
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setTransform((t) => zoomBy(t, factor, viewportCentre(ctx), ctx));
  }

  function onWheel(e: React.WheelEvent) {
    const ctx = viewportCtx();
    if (!ctx) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setTransform((t) => zoomBy(t, factor, focalFrom(e.clientX, e.clientY), ctx));
  }

  function onDoubleClick(e: React.MouseEvent) {
    const ctx = viewportCtx();
    if (!ctx) return;
    setTransform((t) => doubleTap(t, focalFrom(e.clientX, e.clientY), ctx));
  }

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

  if (!photo) return null;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label="Photo viewer"
          className="fixed inset-0 z-[90] flex flex-col bg-black outline-none"
        >
          <div className="flex items-center justify-end gap-3 p-3">
            {status === "in-target" ? (
              <span className="text-sm text-white/80">In this section</span>
            ) : (
              <>
                {status === "elsewhere" && (
                  <span className="text-sm text-white/80">
                    In {elsewhereTitle}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="viewer-select"
                  aria-pressed={selectedNumber !== null}
                  aria-label={
                    selectedNumber !== null ? "Deselect photo" : "Select photo"
                  }
                  onClick={() => onToggleSelect(photo.id)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold",
                    selectedNumber !== null
                      ? "bg-primary text-primary-foreground"
                      : "border-2 border-white/80 bg-black/30",
                  )}
                >
                  {selectedNumber}
                </button>
              </>
            )}
            <button
              type="button"
              aria-label="Close viewer"
              onClick={onClose}
              className="rounded-full p-2 text-white/90 hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>

          <div
            ref={surfaceRef}
            className="relative flex flex-1 items-center justify-center overflow-hidden"
            onWheel={onWheel}
            onDoubleClick={onDoubleClick}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            style={{ cursor: isZoomed ? "grab" : undefined }}
          >
            <img
              ref={imgRef}
              src={photoUrl(photo, supabaseUrl, "full")}
              alt={photo.caption || "Photo"}
              className="max-h-full max-w-full object-contain"
              style={{
                transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
                transformOrigin: "center center",
              }}
              draggable={false}
            />

            {hasPrev(index) && (
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => onIndexChange(prevPhotoIndex(index))}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            {hasNext(index, photos.length) && (
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => onIndexChange(nextPhotoIndex(index, photos.length))}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronRight size={24} />
              </button>
            )}

            <div className="absolute bottom-3 left-3 flex flex-col gap-2">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => zoomStep(1)}
                className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ZoomIn size={18} />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                disabled={!isZoomed}
                onClick={() => zoomStep(-1)}
                className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 disabled:opacity-40"
              >
                <ZoomOut size={18} />
              </button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

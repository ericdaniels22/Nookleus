"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Photo } from "@/lib/types";
import { originalPhotoUrl } from "@/lib/jobs/photo-url";
import {
  createHistory,
  push as pushHistory,
  undo as undoHistory,
  redo as redoHistory,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  type HistoryState,
} from "@/lib/jobs/photo-annotator-history";
import {
  ANNOTATION_CUSTOM_PROPS,
  parseAnnotations,
  serializeAnnotations,
  type Annotation,
} from "@/lib/jobs/photo-annotation-format";
import { useAnnotatorAutoSave } from "@/components/photo-annotator-auto-save";
import { createArrow } from "@/lib/jobs/arrow-geometry";
import {
  FIT,
  MIN_SCALE,
  MAX_SCALE,
  ZOOM_STEP,
  zoomBy,
  pan,
  fabricViewportTransform,
  type Transform,
  type ViewportContext,
} from "@/lib/jobs/photo-zoom-transform";
import {
  ARROW_HANDLE_RADIUS,
  arrowHandleHitArea,
  handleSizeProps,
} from "@/lib/jobs/annotation-handles";
import {
  annotationKind,
  toolbarControls,
  toolbarAnchorPoint,
  DUPLICATE_OFFSET,
  type AnchorBox,
  type ToolbarControl,
} from "@/lib/jobs/annotation-toolbar";
import {
  ANNOTATION_COLORS,
  ANNOTATION_THICKNESSES,
  applyColor,
  applyThickness,
  arrowHeadLength,
  currentColor,
  currentThickness,
  supportsStyleEditor,
  type StyleTarget,
} from "@/lib/jobs/annotation-style";
import {
  snapAnnotation,
  type GuideLine,
  type Rect,
} from "@/lib/jobs/annotation-snapping";
import { nextMarkerNumber } from "@/lib/jobs/numbered-marker-sequence";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Circle,
  Square,
  Type,
  MousePointer,
  Undo2,
  Redo2,
  Trash2,
  Loader2,
  ArrowUpRight,
  RotateCw,
  Crop,
  Check,
  X,
  Copy,
  ChevronLeft,
  ChevronRight,
  Share2,
  ImageOff,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize2,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types & Constants ───────────────────────────────────────────────────────

type Tool =
  | "select"
  | "pan"
  | "freehand"
  | "circle"
  | "rectangle"
  | "text"
  | "arrow"
  | "polyline"
  | "marker"
  | "crop";

const TOOLS: {
  value: Tool;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { value: "freehand", label: "Draw", icon: Pencil },
  { value: "arrow", label: "Arrow", icon: ArrowUpRight },
  { value: "circle", label: "Circle", icon: Circle },
  { value: "rectangle", label: "Rectangle", icon: Square },
  { value: "text", label: "Text", icon: Type },
  { value: "polyline", label: "Polyline", icon: Share2 },
  { value: "marker", label: "Numbered marker", icon: MapPin },
];

const SHADOW_CONFIG = {
  color: "rgba(0,0,0,0.6)",
  blur: 4,
  offsetX: 2,
  offsetY: 2,
};

// ── Snapping & alignment guides (#818) ──
// How close, in canvas pixels, a dragged Annotation's edge or center must come
// to another Annotation's edge or center before it snaps into alignment.
const SNAP_THRESHOLD = 8;
// Colour of the transient alignment guide lines drawn during a snap. Cyan reads
// clearly over light and dark Photo content and over every Annotation colour in
// the palette. Guides are editor-only chrome: drawn directly on the canvas in
// an after:render overlay, so they are never serialized into saved markup and
// never flattened into the exported Annotated Photo PNG.
const GUIDE_COLOR = "#22D3EE";

// Radius of a Numbered marker's badge disc, in canvas pixels (#816). Fixed like
// the text tool's font size — a marker is a small, consistent badge, not scaled
// per-photo the way an Arrow is — so it reads the same regardless of Photo size.
const MARKER_BADGE_RADIUS = 16;

// ─── FabricArrow Custom Class (initialized once on first fabric import) ──────

let fabricClassesReady = false;

function initFabricClasses(fabric: any) {
  if (fabricClassesReady) return;

  const { FabricObject, classRegistry, Control, Point, Shadow } = fabric;

  class FabricArrow extends FabricObject {
    static type = "FabricArrow";
    static customProperties = [...ANNOTATION_CUSTOM_PROPS];

    declare x1: number;
    declare y1: number;
    declare x2: number;
    declare y2: number;
    declare arrowColor: string;
    declare labelText: string | null;
    declare labelFontSize: number;
    declare arrowThickness: number;

    constructor(options: any = {}) {
      super(options);
      this.x1 = options.x1 ?? 0;
      this.y1 = options.y1 ?? 0;
      this.x2 = options.x2 ?? 100;
      this.y2 = options.y2 ?? 0;
      this.arrowColor = options.arrowColor ?? "#F59E0B";
      this.labelText = options.labelText ?? null;
      this.labelFontSize = options.labelFontSize ?? 20;
      this.arrowThickness = options.arrowThickness ?? 4;

      this.objectCaching = false;
      this.hasBorders = false;
      this.selectable = true;
      this.evented = true;
      this.hasControls = true;
      this.perPixelTargetFind = false;
      this.lockRotation = true;
      this.shadow = new Shadow(SHADOW_CONFIG);

      this._updateBounds();
      this._initControls();
    }

    /** Recompute bounding box from absolute endpoint coords */
    _updateBounds() {
      const pad = this.arrowThickness * 4 + 15;
      const minX = Math.min(this.x1, this.x2);
      const minY = Math.min(this.y1, this.y2);
      const maxX = Math.max(this.x1, this.x2);
      const maxY = Math.max(this.y1, this.y2);
      this.set({
        left: (minX + maxX) / 2,
        top: (minY + maxY) / 2,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
        originX: "center",
        originY: "center",
      });
      this.setCoords();
    }

    /** Sync absolute endpoints when the whole arrow is dragged */
    _syncEndpointsToPosition() {
      const midX = (this.x1 + this.x2) / 2;
      const midY = (this.y1 + this.y2) / 2;
      const dx = (this.left ?? 0) - midX;
      const dy = (this.top ?? 0) - midY;
      if (dx !== 0 || dy !== 0) {
        this.x1 += dx;
        this.y1 += dy;
        this.x2 += dx;
        this.y2 += dy;
      }
    }

    _render(ctx: CanvasRenderingContext2D) {
      const cx = this.left ?? 0;
      const cy = this.top ?? 0;
      const lx1 = this.x1 - cx;
      const ly1 = this.y1 - cy;
      const lx2 = this.x2 - cx;
      const ly2 = this.y2 - cy;
      const thick = this.arrowThickness;
      const headLen = arrowHeadLength(thick);
      const ang = Math.atan2(ly2 - ly1, lx2 - lx1);

      // Shaft
      ctx.beginPath();
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.strokeStyle = this.arrowColor;
      ctx.lineWidth = thick;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      // Arrowhead
      const hx1 = lx2 - headLen * Math.cos(ang - Math.PI / 6);
      const hy1 = ly2 - headLen * Math.sin(ang - Math.PI / 6);
      const hx2 = lx2 - headLen * Math.cos(ang + Math.PI / 6);
      const hy2 = ly2 - headLen * Math.sin(ang + Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(hx1, hy1);
      ctx.lineTo(lx2, ly2);
      ctx.lineTo(hx2, hy2);
      ctx.stroke();

      // Label text
      if (this.labelText) {
        const fs = this.labelFontSize;
        ctx.font = `bold ${fs}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelOffset = ly1 > ly2 ? fs + 6 : -(fs + 6);
        // Stroke outline for readability
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.strokeText(this.labelText, lx1, ly1 + labelOffset);
        ctx.fillStyle = this.arrowColor;
        ctx.fillText(this.labelText, lx1, ly1 + labelOffset);
      }
    }

    _initControls() {
      const self = this;

      const makeHandle = (
        getLocalX: () => number,
        getLocalY: () => number,
        setEndpoint: (x: number, y: number) => void
      ) =>
        new Control({
          actionName: "modifyArrow",
          cursorStyle: "grab",
          ...arrowHandleHitArea(),
          positionHandler(dim: any, finalMatrix: any) {
            return new Point(getLocalX(), getLocalY()).transform(finalMatrix);
          },
          actionHandler(
            _eventData: any,
            transform: any,
            x: number,
            y: number
          ) {
            setEndpoint(x, y);
            transform.target._updateBounds();
            transform.target.set("dirty", true);
            return true;
          },
          render(
            ctx: CanvasRenderingContext2D,
            left: number,
            top: number,
            _style: any,
            fabricObject: any
          ) {
            ctx.save();
            ctx.fillStyle = "#FFFFFF";
            ctx.strokeStyle = fabricObject.arrowColor || "#F59E0B";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(left, top, ARROW_HANDLE_RADIUS, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          },
        });

      this.controls = {
        start: makeHandle(
          () => self.x1 - (self.left ?? 0),
          () => self.y1 - (self.top ?? 0),
          (x, y) => {
            self.x1 = x;
            self.y1 = y;
          }
        ),
        end: makeHandle(
          () => self.x2 - (self.left ?? 0),
          () => self.y2 - (self.top ?? 0),
          (x, y) => {
            self.x2 = x;
            self.y2 = y;
          }
        ),
      };
    }

    toObject(propertiesToInclude?: string[]) {
      return {
        ...super.toObject(propertiesToInclude),
        x1: this.x1,
        y1: this.y1,
        x2: this.x2,
        y2: this.y2,
        arrowColor: this.arrowColor,
        labelText: this.labelText,
        labelFontSize: this.labelFontSize,
        arrowThickness: this.arrowThickness,
      };
    }

    static fromObject(object: any) {
      return Promise.resolve(new FabricArrowRef(object));
    }
  }

  // Reference for fromObject closure
  const FabricArrowRef = FabricArrow;

  classRegistry.setClass(FabricArrow, "FabricArrow");

  // ── FabricNumberedMarker (issue #816) ──
  // A small numbered badge dropped on a Photo by the marker tool. It is one
  // Annotation: the disc, its number, and an optional attached Label below it
  // all move together. The number is assigned by the pure nextMarkerNumber rule
  // at drop time; the marker only renders whatever `markerNumber` it carries. It
  // is move-only — no resize/rotate — so a badge never distorts; you drag it to
  // reposition. Persists via the shared ANNOTATION_CUSTOM_PROPS allowlist
  // (`markerNumber`/`markerColor`, reusing `labelText`/`labelFontSize` for the
  // label) and burns into the flattened Annotated Photo like every other kind.
  class FabricNumberedMarker extends FabricObject {
    static type = "FabricNumberedMarker";
    static customProperties = [...ANNOTATION_CUSTOM_PROPS];

    declare markerNumber: number;
    declare markerColor: string;
    declare labelText: string | null;
    declare labelFontSize: number;

    constructor(options: any = {}) {
      super(options);
      this.markerNumber = options.markerNumber ?? 1;
      this.markerColor = options.markerColor ?? "#F59E0B";
      this.labelText = options.labelText ?? null;
      this.labelFontSize = options.labelFontSize ?? 20;

      this.objectCaching = false;
      this.selectable = true;
      this.evented = true;
      this.originX = "center";
      this.originY = "center";
      // Move-only: drag to reposition, but no scaling or rotation so the badge
      // stays a fixed circle. No corner controls; the selection border alone
      // signals the active marker.
      this.hasControls = false;
      this.hasBorders = true;
      this.lockScalingX = true;
      this.lockScalingY = true;
      this.lockRotation = true;
      this.shadow = new Shadow(SHADOW_CONFIG);

      const r = MARKER_BADGE_RADIUS;
      this.set({ width: r * 2, height: r * 2 });
      this.setCoords();
    }

    _render(ctx: CanvasRenderingContext2D) {
      const r = MARKER_BADGE_RADIUS;

      // Badge disc, centred on the object's origin (Fabric translates the ctx
      // to the centre before _render, exactly as FabricArrow relies on).
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = this.markerColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();

      // The number. Shrink a touch for two-or-more digits so it stays inside
      // the disc.
      const digits = String(this.markerNumber);
      const fs = digits.length >= 2 ? r * 1.0 : r * 1.25;
      ctx.font = `bold ${fs}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(digits, 0, 1);

      // Optional attached Label, drawn below the badge in the marker's colour
      // with a dark outline for legibility (matching the Arrow's label style).
      if (this.labelText) {
        const lfs = this.labelFontSize;
        ctx.font = `bold ${lfs}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const ly = r + 6 + lfs / 2;
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.strokeText(this.labelText, 0, ly);
        ctx.fillStyle = this.markerColor;
        ctx.fillText(this.labelText, 0, ly);
      }
    }

    toObject(propertiesToInclude?: string[]) {
      return {
        ...super.toObject(propertiesToInclude),
        markerNumber: this.markerNumber,
        markerColor: this.markerColor,
        labelText: this.labelText,
        labelFontSize: this.labelFontSize,
      };
    }

    static fromObject(object: any) {
      return Promise.resolve(new FabricNumberedMarkerRef(object));
    }
  }

  const FabricNumberedMarkerRef = FabricNumberedMarker;

  classRegistry.setClass(FabricNumberedMarker, "FabricNumberedMarker");
  fabricClassesReady = true;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PhotoAnnotator({
  open,
  onOpenChange,
  photos,
  initialPhotoIndex,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: Photo[];
  initialPhotoIndex: number;
  onSaved: () => void;
}) {
  // ── Photo navigation state ──
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(0, initialPhotoIndex)
  );
  const currentPhoto = photos[currentIndex] ?? null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  // ── Canvas state ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Wrapper around the <canvas>; multitouch (pinch / two-finger pan) is caught
  // here in the capture phase, before Fabric's own (bubble-phase) listeners, so
  // a two-finger gesture pans/zooms instead of drawing (#814, AC5).
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<any>(null);
  const fabricModuleRef = useRef<any>(null);
  const bgImageRef = useRef<any>(null);
  const imgDimensionsRef = useRef<{
    width: number;
    height: number;
    scale: number;
  }>({ width: 800, height: 600, scale: 1 });

  // ── Zoom / pan (issue #814) ──
  // The same pure transform model the Photo viewer uses, fed to Fabric as a
  // viewport transform. `transform` drives the on-screen zoom control; the ref
  // is the source of truth the gesture handlers read (no stale closures). The
  // annotator's canvas IS its viewport, sized to the fit-scaled Photo, so the
  // fit baseline is scale 1 and the ViewportContext is the canvas's own dims.
  const [transform, setTransform] = useState<Transform>(FIT);
  const transformRef = useRef<Transform>(FIT);
  // True from the moment a second finger lands until every finger lifts. While
  // set, the per-tool draw/place handlers bail, so a pinch never leaves a stray
  // Annotation behind (#814, AC5).
  const gestureActiveRef = useRef(false);
  // Pinch baseline carried move-to-move: last finger distance + midpoint.
  const pinchRef = useRef<{
    lastDist: number;
    lastMid: { x: number; y: number };
  } | null>(null);
  // Desktop Pan tool drag origin (viewport pixels), null when not dragging.
  const panDragRef = useRef<{ x: number; y: number } | null>(null);

  // ── Auto-save (issue #807, ADR 0024 split write) ──
  // One stable client for the whole annotator lifetime; the org claim is
  // resolved once for the insert branch of the cheap markup upsert.
  const [supabase] = useState(() => createClient());
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getActiveOrganizationId(supabase).then((id) => {
      if (!cancelled) setOrganizationId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Empty the transient alignment guides and repaint so they vanish (#818).
  // Safe to call when there are none — drawGuides simply draws nothing.
  const clearGuides = useCallback(() => {
    if (guideLinesRef.current.length === 0) return;
    guideLinesRef.current = [];
    fabricRef.current?.requestRenderAll();
  }, []);

  // Flatten the live canvas to a PNG blob for the Annotated Photo render. The
  // synchronous toDataURL runs first so the OUTGOING pixels are snapshotted
  // before any photo switch swaps the canvas; the fetch→blob tail is
  // canvas-independent. Injected into the auto-save hook so the hook stays
  // Fabric-free.
  const captureFlattenedBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    // Belt-and-suspenders: guides are after:render chrome and never enter
    // toDataURL anyway, but drop them before the snapshot so the live canvas is
    // clean too.
    guideLinesRef.current = [];
    canvas.discardActiveObject();
    // The flattened Annotated Photo must render at full Photo resolution
    // irrespective of on-screen zoom (#814 AC6): toDataURL bakes the viewport
    // transform into its output, so neutralise it to identity for the capture,
    // then restore the live view. This runs entirely before the first await, so
    // the OUTGOING pixels are still snapshotted before any photo switch. The
    // multiplier scales up from the fit-sized canvas to native resolution.
    const vpt = canvas.viewportTransform
      ? ([...canvas.viewportTransform] as number[])
      : [1, 0, 0, 1, 0, 0];
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.renderAll();
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
    canvas.setViewportTransform(vpt);
    canvas.renderAll();
    const res = await fetch(dataUrl);
    return await res.blob();
  }, []);

  const autoSave = useAnnotatorAutoSave({
    supabase,
    photo: currentPhoto,
    organizationId,
    captureFlattenedBlob,
    onPersisted: onSaved,
  });

  // ── Tool state ──
  const [activeTool, setActiveTool] = useState<Tool>("arrow");
  const [activeColor, setActiveColor] = useState("#F59E0B");
  const [activeThickness, setActiveThickness] = useState(4);
  const [canvasReady, setCanvasReady] = useState(false);

  // ── Crop state ──
  const [isCropping, setIsCropping] = useState(false);
  const [hasOriginalBackup, setHasOriginalBackup] = useState(false);
  const cropRectRef = useRef<any>(null);
  const cropRenderCallbackRef = useRef<any>(null);
  const hiddenObjectsRef = useRef<any[]>([]);

  // ── Snapping alignment guides (#818) ──
  // The transient guide lines to draw on the next render while a drag is
  // snapping. Written in object:moving and read by the after:render overlay; a
  // ref (not state) so updating it never re-renders React mid-drag. Always
  // emptied on drop / deselect so guides never persist — and, being canvas-only
  // chrome, they are absent from the flattened export regardless.
  const guideLinesRef = useRef<GuideLine[]>([]);

  // ── In-context toolbar (any selected Annotation) ──
  const [objectToolbar, setObjectToolbar] = useState<{
    x: number;
    y: number;
    target: any;
    controls: ToolbarControl[];
  } | null>(null);
  const [labelInput, setLabelInput] = useState<{
    target: any;
    text: string;
  } | null>(null);

  // ── Photo navigation ──
  // Tracks whether the current photo has edits since its last flattened
  // rebuild — the signal for whether leaving/closing needs an expensive rebuild.
  const isDirtyRef = useRef(false);

  // ── Polyline drawing ──
  const polyDrawingRef = useRef<{ points: { x: number; y: number }[] } | null>(
    null
  );
  const polyPreviewRef = useRef<{ x: number; y: number } | null>(null);

  // ── Shape drawing ──
  const isDrawingShape = useRef(false);
  const shapeStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentShape = useRef<any>(null);

  // ── History (undo / redo) ──
  // The pure stack (past/present/future of markup snapshots) is the source of
  // truth for what undo and redo restore; the two booleans mirror its derived
  // canUndo/canRedo so the toolbar buttons enable/disable in render.
  // isRestoringRef suppresses step capture while we replay a snapshot onto the
  // canvas. The cheap debounced markup write itself lives in the auto-save hook
  // (ADR 0024's split write); recordStep just feeds it.
  const historyRef = useRef<HistoryState<Annotation[]>>(createHistory([]));
  const isRestoringRef = useRef(false);
  const [canUndoState, setCanUndoState] = useState(false);
  const [canRedoState, setCanRedoState] = useState(false);

  // ── Refs that sync with state ──
  const activeToolRef = useRef<Tool>(activeTool);
  const activeColorRef = useRef(activeColor);
  const activeThicknessRef = useRef(activeThickness);
  // Read by the (tool-independent) view-gesture handlers so pinch/wheel/pan are
  // no-ops while cropping — the crop overlay reasons in raw canvas pixels and
  // would mis-align under a viewport transform.
  const isCroppingRef = useRef(isCropping);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    activeColorRef.current = activeColor;
  }, [activeColor]);
  useEffect(() => {
    activeThicknessRef.current = activeThickness;
  }, [activeThickness]);
  useEffect(() => {
    isCroppingRef.current = isCropping;
  }, [isCropping]);

  // ─── Zoom / pan helpers (issue #814) ───────────────────────────────────────

  // The transform math's view of the canvas. The annotator's canvas IS its
  // viewport — it's sized to the fit-scaled Photo — so the image and viewport
  // dimensions are identical and the fit baseline is scale 1. Null until the
  // Fabric canvas exists.
  const viewportCtx = useCallback((): ViewportContext | null => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    const w = canvas.getWidth();
    const h = canvas.getHeight();
    return { imageW: w, imageH: h, viewportW: w, viewportH: h };
  }, []);

  // Adopt `next` as the live view: the ref is the source of truth the gesture
  // handlers read (no stale closures), the state drives the on-screen zoom
  // control, and the matrix magnifies the whole Fabric scene about the viewport
  // centre. Because Fabric inverts the same matrix in getScenePoint, every
  // placement/hit-test keeps landing on the right Photo pixel while zoomed
  // (#814 AC3). The floating toolbar is dropped — its screen anchor is now stale.
  const commitTransform = useCallback((next: Transform) => {
    transformRef.current = next;
    setTransform(next);
    const canvas = fabricRef.current;
    if (canvas) {
      canvas.setViewportTransform(
        fabricViewportTransform(next, canvas.getWidth(), canvas.getHeight())
      );
      canvas.requestRenderAll();
    }
    setObjectToolbar(null);
  }, []);

  // A client (pointer / touch) coordinate mapped into canvas viewport pixels —
  // the focal point the shared zoom math takes. Uses the upper (event) canvas's
  // on-screen rect, folding in the CSS-vs-backing-store scale so a responsively
  // sized canvas still focuses on the true cursor / pinch point.
  const clientToViewport = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = fabricRef.current;
      const el = canvas?.upperCanvasEl as HTMLCanvasElement | undefined;
      if (!canvas || !el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        x: ((clientX - rect.left) / rect.width) * canvas.getWidth(),
        y: ((clientY - rect.top) / rect.height) * canvas.getHeight(),
      };
    },
    []
  );

  // Abandon any half-finished draw when a view gesture (a second finger) takes
  // over, so a pinch never commits a stray Annotation (#814 AC5). The in-flight
  // shape preview is removed and the brush stroke dropped; an in-progress
  // polyline is multi-tap and survives deliberately (the next tap continues it).
  const cancelInProgressDraw = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (isDrawingShape.current) {
      if (currentShape.current) canvas.remove(currentShape.current);
      currentShape.current = null;
      isDrawingShape.current = false;
    }
    canvas._isCurrentlyDrawing = false;
    canvas.requestRenderAll();
  }, []);

  // The ＋ / − buttons zoom one step about the viewport centre (no cursor focal).
  const zoomStep = useCallback(
    (factor: number) => {
      const ctx = viewportCtx();
      if (!ctx) return;
      const centre = { x: ctx.viewportW / 2, y: ctx.viewportH / 2 };
      commitTransform(zoomBy(transformRef.current, factor, centre, ctx));
    },
    [viewportCtx, commitTransform]
  );

  // Reset index when annotator opens
  useEffect(() => {
    if (open) {
      setCurrentIndex(Math.max(0, initialPhotoIndex));
    }
  }, [open, initialPhotoIndex]);

  // ─── Canvas Initialization ─────────────────────────────────────────────────

  const initCanvas = useCallback(async () => {
    if (!canvasRef.current || !currentPhoto) return;

    const fabric = await import("fabric");
    fabricModuleRef.current = fabric;
    initFabricClasses(fabric);

    if (fabricRef.current) {
      fabricRef.current.dispose();
      fabricRef.current = null;
    }

    try {
      // Load the ORIGINAL image (not annotated) to avoid double-rendering
      const photoUrl = originalPhotoUrl(currentPhoto, supabaseUrl);

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = document.createElement("img");
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = photoUrl;
      });

      const imgWidth = img.naturalWidth || 800;
      const imgHeight = img.naturalHeight || 600;
      const maxWidth = window.innerWidth - 72;
      const maxHeight = window.innerHeight;
      const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
      const canvasWidth = Math.round(imgWidth * scale);
      const canvasHeight = Math.round(imgHeight * scale);

      imgDimensionsRef.current = { width: imgWidth, height: imgHeight, scale };

      const canvas = new fabric.Canvas(canvasRef.current!, {
        width: canvasWidth,
        height: canvasHeight,
        backgroundColor: "#1a1a1a",
      });

      const fabricImg = new fabric.FabricImage(img, {
        left: 0,
        top: 0,
        width: imgWidth,
        height: imgHeight,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        originX: "left",
        originY: "top",
      });

      bgImageRef.current = fabricImg;
      canvas.backgroundImage = fabricImg;
      canvas.renderAll();
      fabricRef.current = canvas;

      canvas.isDrawingMode = false;
      canvas.selection = false;

      // Load annotations BEFORE setting canvasReady
      await loadAnnotations(canvas, currentPhoto.id);
      setCanvasReady(true);
      isDirtyRef.current = false;

      // Seed the undo/redo history with the just-loaded markup as the baseline
      // present: there's nothing to undo back past a Photo's saved state, and a
      // fresh stack means undo can never step across into another Photo's edits.
      historyRef.current = createHistory(snapshotObjects(canvas));
      setCanUndoState(false);
      setCanRedoState(false);

      // Check for original backup
      const supabase = createClient();
      const backupPath = currentPhoto.storage_path.replace(
        /\.[^.]+$/,
        "-original$&"
      );
      const { data: backupData } = await supabase.storage.from("photos").list(
        backupPath.substring(0, backupPath.lastIndexOf("/")),
        {
          search: backupPath.substring(backupPath.lastIndexOf("/") + 1),
        }
      );
      setHasOriginalBackup(
        !!backupData && backupData.some((f) => backupPath.endsWith(f.name))
      );
    } catch (err) {
      console.error("Failed to load image for annotation:", err);
      toast.error("Failed to load image.");
    }
  }, [currentPhoto, supabaseUrl]);

  // ─── Load Annotations (with v2/v1 migration) ──────────────────────────────

  async function loadAnnotations(canvas: any, photoId: string) {
    const fabric = fabricModuleRef.current;
    if (!fabric) return;

    const supabase = createClient();
    const { data } = await supabase
      .from("photo_annotations")
      .select("annotation_data")
      .eq("photo_id", photoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!data?.annotation_data || typeof data.annotation_data !== "object")
      return;

    // Migrate any stored shape (format 3 / version 2 / version 1) into one
    // uniform markup-object array, then load it over the freshly-attached
    // original photo. All format knowledge lives in parseAnnotations; the
    // background is preserved here because loadFromJSON replaces it.
    const objects = parseAnnotations(data.annotation_data);

    const bg = canvas.backgroundImage;
    await canvas.loadFromJSON({ version: "7.2.0", objects });
    canvas.backgroundImage = bg;
    attachEditorHandles(canvas, fabric);
    canvas.renderAll();
  }

  /**
   * After loading from JSON, give every reloaded Annotation the same
   * finger-sized editor handles as a freshly-drawn one (#810, AC6): the shared
   * handle size is not serialized, so loadFromJSON restores objects at Fabric's
   * small defaults. Re-apply it here, and re-attach vertex controls to
   * Polyline/Polygon (createPolyControls is likewise not restored). FabricArrow
   * brings its own custom endpoint controls from its constructor, and a
   * FabricNumberedMarker its own move-only config, so both are left untouched.
   */
  function attachEditorHandles(canvas: any, fabric: any) {
    canvas.getObjects().forEach((obj: any) => {
      const kind = annotationKind(obj.type);
      if (kind === "arrow" || kind === "marker") return;
      obj.set(handleSizeProps());
      if (kind === "polyline" || kind === "polygon") {
        if (fabric.createPolyControls) {
          obj.controls = fabric.createPolyControls(obj);
        }
        obj.hasBorders = false;
        obj.objectCaching = false;
        obj.cornerStyle = "circle";
        obj.cornerColor = "#FFFFFF";
        obj.cornerStrokeColor = obj.stroke || "#F59E0B";
        obj.transparentCorners = false;
      }
    });
  }

  // ─── Main open/photo/index effect ──────────────────────────────────────────

  useEffect(() => {
    if (open && currentPhoto) {
      setCanvasReady(false);
      setIsCropping(false);
      setObjectToolbar(null);
      setLabelInput(null);
      cropRectRef.current = null;
      cropRenderCallbackRef.current = null;
      hiddenObjectsRef.current = [];
      polyDrawingRef.current = null;
      polyPreviewRef.current = null;
      isDirtyRef.current = false;
      // Every photo opens / pages in at the fit baseline (#814 AC6). initCanvas
      // builds a fresh Fabric canvas, which starts at the identity viewport
      // transform that FIT maps to, so resetting the ref/state here is enough —
      // no canvas to write to yet.
      transformRef.current = FIT;
      setTransform(FIT);
      // Drop the previous Photo's undo/redo history immediately; initCanvas
      // re-seeds the stack once the new canvas loads. (Any pending markup save
      // is owned and flushed by the auto-save hook, not here.)
      historyRef.current = createHistory([]);
      setCanUndoState(false);
      setCanRedoState(false);
      const timer = setTimeout(() => initCanvas(), 200);
      return () => clearTimeout(timer);
    }
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
        setCanvasReady(false);
      }
    };
  }, [open, currentIndex, initCanvas]);

  // ─── Dirty tracking ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvasReady) return;

    const markDirty = () => {
      isDirtyRef.current = true;
      // Queue the cheap, debounced markup upsert for this edit (ADR 0024). The
      // expensive flattened render is left to flushAndRebuild on leave/close.
      // This effect subscribes only AFTER canvasReady — i.e. after loadFromJSON
      // restores saved annotations — so loading a photo never schedules a save.
      const json = canvas.toJSON([...ANNOTATION_CUSTOM_PROPS]);
      autoSave.scheduleMarkupSave(serializeAnnotations(json.objects));
    };
    // A finished freehand stroke and a committed text edit are completed steps
    // too — record them here. (Moves/resizes are recorded in the arrow-sync
    // effect's object:modified, after endpoint sync, so an arrow's geometry is
    // already current when snapshotted; shape/arrow/polyline placement is
    // recorded at their explicit finalize points, never on raw object:added,
    // so a mid-draw preview never lands in the stack.)
    const onCommit = () => recordStep();
    canvas.on("object:added", markDirty);
    canvas.on("object:modified", markDirty);
    canvas.on("object:removed", markDirty);
    canvas.on("path:created", onCommit);
    canvas.on("text:editing:exited", onCommit);

    return () => {
      canvas.off("object:added", markDirty);
      canvas.off("object:modified", markDirty);
      canvas.off("object:removed", markDirty);
      canvas.off("path:created", onCommit);
      canvas.off("text:editing:exited", onCommit);
    };
  }, [canvasReady, autoSave]);

  // ─── Selection / toolbar / movement sync (every Annotation kind) ────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvasReady) return;

    // The top-edge box the toolbar anchors to. The Arrow anchors on its raw
    // endpoints (unchanged from before); every other kind uses its bounding box.
    function anchorBoxFor(target: any): AnchorBox {
      if (annotationKind(target?.type) === "arrow") {
        return {
          left: Math.min(target.x1, target.x2),
          top: Math.min(target.y1, target.y2),
          width: Math.abs(target.x2 - target.x1),
        };
      }
      const r = target.getBoundingRect();
      return { left: r.left, top: r.top, width: r.width };
    }

    // Show the in-context toolbar for a selected object, or hide it if the
    // object is not a toolbar-eligible Annotation (background, crop rect, …).
    function showToolbar(target: any) {
      const kind = annotationKind(target?.type);
      if (!kind || target === cropRectRef.current) {
        setObjectToolbar(null);
        return;
      }
      const rect = canvas.getElement().getBoundingClientRect();
      const { x, y } = toolbarAnchorPoint(anchorBoxFor(target), rect);
      setObjectToolbar({ x, y, target, controls: toolbarControls(kind) });
    }

    function onSelected(e: any) {
      showToolbar(e.selected?.[0] || e.target);
    }

    function onDeselected() {
      setObjectToolbar(null);
      // Drop any guides left from the last drag so none linger after deselect.
      clearGuides();
    }

    function onMoving(e: any) {
      const target = e.target;
      // Snap the dragged Annotation into alignment with the others and record
      // which transient guide lines to draw this frame (#818). Only real
      // Annotations snap — never the crop rect or a multi-object selection
      // (annotationKind is falsy for both), and never the background image.
      const kind = annotationKind(target?.type);
      if (kind && target !== cropRectRef.current) {
        const movingRect = target.getBoundingRect();
        const others = (
          canvas.getObjects() as Array<{
            type?: string;
            getBoundingRect: () => Rect;
          }>
        )
          .filter(
            (o) =>
              o !== target &&
              o !== cropRectRef.current &&
              annotationKind(o.type)
          )
          .map((o) => o.getBoundingRect());
        const { snappedPosition, guideLines } = snapAnnotation(
          movingRect,
          others,
          { x: SNAP_THRESHOLD, y: SNAP_THRESHOLD }
        );
        // The engine returns the snapped bounding-box position; apply the shift
        // as a plain translation so it works for center-origin Arrows and
        // top-left shapes alike.
        const dx = snappedPosition.left - movingRect.left;
        const dy = snappedPosition.top - movingRect.top;
        if (dx !== 0 || dy !== 0) {
          target.set({
            left: (target.left ?? 0) + dx,
            top: (target.top ?? 0) + dy,
          });
          target.setCoords();
        }
        guideLinesRef.current = guideLines;
      }
      // Sync the Arrow's endpoints to the (possibly snapped) body position so
      // the whole Arrow — tip and tail — moves together and stays consistent.
      // Route through annotationKind: the live Fabric type is lowercase (#831).
      if (annotationKind(target?.type) === "arrow") {
        target._syncEndpointsToPosition();
      }
      // Hide toolbar during movement; it re-anchors on object:modified
      setObjectToolbar(null);
    }

    function onModified(e: any) {
      const target = e.target;
      if (annotationKind(target?.type) === "arrow") {
        target._syncEndpointsToPosition();
      }
      // The drag is over — clear the guides so they vanish on drop.
      clearGuides();
      showToolbar(target);
      // Record the move/resize/endpoint-drag as one undoable step — after any
      // arrow endpoint sync above so the snapshot captures its final geometry.
      recordStep();
    }

    // After:render overlay for the transient alignment guides. Drawn directly
    // on the canvas context (mirroring the crop / polyline overlays) so it is
    // editor-only chrome and never enters the flattened export. With no
    // zoom/pan yet, canvas coords equal the scene coords the engine works in.
    function drawGuides() {
      const guides = guideLinesRef.current;
      if (!guides || guides.length === 0) return;
      const ctx = canvas.getContext();
      if (!ctx) return;
      const cw = canvas.width!;
      const ch = canvas.height!;
      ctx.save();
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (const g of guides) {
        if (g.orientation === "vertical") {
          ctx.moveTo(g.position, 0);
          ctx.lineTo(g.position, ch);
        } else {
          ctx.moveTo(0, g.position);
          ctx.lineTo(cw, g.position);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    canvas.on("selection:created", onSelected);
    canvas.on("selection:updated", onSelected);
    canvas.on("selection:cleared", onDeselected);
    canvas.on("object:moving", onMoving);
    canvas.on("object:modified", onModified);
    canvas.on("after:render", drawGuides);

    return () => {
      canvas.off("selection:created", onSelected);
      canvas.off("selection:updated", onSelected);
      canvas.off("selection:cleared", onDeselected);
      canvas.off("object:moving", onMoving);
      canvas.off("object:modified", onModified);
      canvas.off("after:render", drawGuides);
    };
  }, [canvasReady]);

  // ─── Tool Behavior ─────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !canvasReady || !fabric) return;

    // Remove previous mouse handlers
    canvas.off("mouse:down");
    canvas.off("mouse:move");
    canvas.off("mouse:up");
    canvas.off("mouse:dblclick");

    // Clear any Pan-tool state the prior tool may have left behind.
    canvas.defaultCursor = "default";
    panDragRef.current = null;

    // Finalize any in-progress polyline when switching tools
    if (
      polyDrawingRef.current &&
      polyDrawingRef.current.points.length >= 2 &&
      activeTool !== "polyline"
    ) {
      finalizePolyline(false);
    } else if (activeTool !== "polyline") {
      polyDrawingRef.current = null;
      polyPreviewRef.current = null;
    }

    const makeShadow = () => new fabric.Shadow(SHADOW_CONFIG);

    if (activeTool === "freehand") {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = activeColor;
      canvas.freeDrawingBrush.width = activeThickness;
      canvas.freeDrawingBrush.shadow = makeShadow();
      canvas.selection = false;
    } else if (activeTool === "select") {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      // Ensure all objects are fully interactive in select mode
      canvas.forEachObject((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
      });
    } else if (activeTool === "text") {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.forEachObject((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
      });
      canvas.on("mouse:down", (opt: any) => {
        if (opt.target) return;
        canvas.discardActiveObject();
        canvas.renderAll();
        const pointer = canvas.getScenePoint(opt.e);
        const text = new fabric.IText("Text", {
          left: pointer.x,
          top: pointer.y,
          fontSize: 22,
          fill: activeColorRef.current,
          fontFamily: "Arial",
          fontWeight: "bold",
          stroke: "#000000",
          strokeWidth: 0.5,
          padding: 4,
          shadow: makeShadow(),
          ...handleSizeProps(),
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        canvas.renderAll();
      });
    } else if (activeTool === "polyline") {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.forEachObject((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
      });

      // ── Polyline drawing state machine ──
      canvas.on("mouse:down", (opt: any) => {
        if (opt.target) return;
        const pointer = canvas.getScenePoint(opt.e);
        const pt = { x: pointer.x, y: pointer.y };

        if (!polyDrawingRef.current) {
          // Start new polyline
          polyDrawingRef.current = { points: [pt] };
        } else {
          const pts = polyDrawingRef.current.points;
          // Check if clicking near the first point → close the shape
          if (pts.length >= 3) {
            const dx = pt.x - pts[0].x;
            const dy = pt.y - pts[0].y;
            if (Math.sqrt(dx * dx + dy * dy) < 20) {
              finalizePolyline(true);
              canvas.renderAll();
              return;
            }
          }
          pts.push(pt);
        }
        canvas.renderAll();
      });

      canvas.on("mouse:move", (opt: any) => {
        if (!polyDrawingRef.current) return;
        const pointer = canvas.getScenePoint(opt.e);
        polyPreviewRef.current = { x: pointer.x, y: pointer.y };
        canvas.renderAll();
      });

      canvas.on("mouse:dblclick", () => {
        if (polyDrawingRef.current && polyDrawingRef.current.points.length >= 2) {
          finalizePolyline(false);
          canvas.renderAll();
        }
      });

      // After:render overlay for in-progress polyline
      const drawPolyOverlay = () => {
        const drawing = polyDrawingRef.current;
        if (!drawing || drawing.points.length === 0) return;
        const ctx = canvas.getContext();
        if (!ctx) return;

        ctx.save();
        const color = activeColorRef.current;
        const thick = activeThicknessRef.current;

        // Draw completed segments
        ctx.strokeStyle = color;
        ctx.lineWidth = thick;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
        for (let i = 1; i < drawing.points.length; i++) {
          ctx.lineTo(drawing.points[i].x, drawing.points[i].y);
        }
        ctx.stroke();

        // Preview line from last point to cursor
        const preview = polyPreviewRef.current;
        if (preview && drawing.points.length > 0) {
          const last = drawing.points[drawing.points.length - 1];
          ctx.setLineDash([5, 5]);
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(preview.x, preview.y);
          ctx.stroke();
        }

        // Draw vertex dots
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        drawing.points.forEach((p, i) => {
          ctx.fillStyle = i === 0 ? "#FFFFFF" : color;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, i === 0 ? 6 : 4, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });

        ctx.restore();
      };

      canvas.on("after:render", drawPolyOverlay);

      return () => {
        canvas.off("after:render", drawPolyOverlay);
        canvas.off("mouse:down");
        canvas.off("mouse:move");
        canvas.off("mouse:up");
        canvas.off("mouse:dblclick");
      };
    } else if (activeTool === "crop") {
      canvas.isDrawingMode = false;
      canvas.selection = false;
    } else if (activeTool === "pan") {
      // ── Desktop Pan tool (issue #814 AC4) ──
      // A drag pans the magnified scene. Selection and drawing are off and every
      // object is made non-evented so a drag can never grab an Annotation; the
      // pan is clamped through the shared model so the Photo can't gap at an edge.
      // (Touch panning is two-finger, handled by the capture-phase listeners.)
      canvas.isDrawingMode = false;
      canvas.selection = false;
      canvas.forEachObject((obj: any) => {
        obj.selectable = false;
        obj.evented = false;
      });
      canvas.defaultCursor = "grab";
      canvas.setCursor("grab");

      const clientXY = (e: any) =>
        e.touches?.[0]
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
          : { x: e.clientX, y: e.clientY };

      canvas.on("mouse:down", (opt: any) => {
        const { x, y } = clientXY(opt.e);
        panDragRef.current = { x, y };
        canvas.setCursor("grabbing");
      });
      canvas.on("mouse:move", (opt: any) => {
        if (!panDragRef.current) return;
        const ctx = viewportCtx();
        if (!ctx) return;
        const { x, y } = clientXY(opt.e);
        const fPrev = clientToViewport(panDragRef.current.x, panDragRef.current.y);
        const fCur = clientToViewport(x, y);
        panDragRef.current = { x, y };
        if (fPrev && fCur) {
          commitTransform(
            pan(transformRef.current, fCur.x - fPrev.x, fCur.y - fPrev.y, ctx)
          );
        }
      });
      canvas.on("mouse:up", () => {
        panDragRef.current = null;
        canvas.setCursor("grab");
      });
    } else if (activeTool === "arrow") {
      // ── Arrow: tap-to-drop (issue #809) ──
      // A single tap drops one standard-size ↗ Arrow centered on the tap and
      // scaled to the Photo (via the pure arrow-geometry module), then
      // auto-selects it so its tip/tail handles are immediately grabbable —
      // mirroring how the text tool auto-activates the object it creates.
      // Drag-to-draw and its zero-length guard are gone: tap-drop can only ever
      // produce a valid standard Arrow.
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.forEachObject((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
      });

      // Scene point of a mouse:down that landed on empty canvas. Null when the
      // press hit an existing object, so tapping an Arrow selects it rather
      // than dropping a new one on top.
      let tapDown: { x: number; y: number } | null = null;

      canvas.on("mouse:down", (opt: any) => {
        if (opt.target) {
          tapDown = null;
          return;
        }
        const pointer = canvas.getScenePoint(opt.e);
        tapDown = { x: pointer.x, y: pointer.y };
      });

      canvas.on("mouse:up", () => {
        const tap = tapDown;
        tapDown = null;
        if (!tap) return;

        // Photo dimensions in scene/display coordinates (the space getScenePoint
        // reports): natural size scaled to the on-screen canvas.
        const { width, height, scale } = imgDimensionsRef.current;
        const { tip, tail } = createArrow(tap, {
          width: width * scale,
          height: height * scale,
        });
        const ArrowClass = fabric.classRegistry.getClass("FabricArrow");
        const arrow = new ArrowClass({
          x1: tail.x,
          y1: tail.y,
          x2: tip.x,
          y2: tip.y,
          arrowColor: activeColorRef.current,
          arrowThickness: activeThicknessRef.current,
        });
        canvas.add(arrow);
        canvas.setActiveObject(arrow);
        canvas.renderAll();
        recordStep();
      });
    } else if (activeTool === "marker") {
      // ── Numbered marker: tap-to-drop & auto-sequence (issue #816) ──
      // A single tap drops one badge centred on the tap, auto-numbered as the
      // next in the Photo's sequence and auto-selected — mirroring the Arrow's
      // tap-drop. The number comes from the pure nextMarkerNumber rule, fed the
      // numbers already on the canvas, so placement order is deterministic.
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.forEachObject((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
      });

      // Scene point of a mouse:down on empty canvas; null when the press hit an
      // existing object, so tapping a marker selects it rather than stacking a
      // new one on top.
      let tapDown: { x: number; y: number } | null = null;

      canvas.on("mouse:down", (opt: any) => {
        if (opt.target) {
          tapDown = null;
          return;
        }
        const pointer = canvas.getScenePoint(opt.e);
        tapDown = { x: pointer.x, y: pointer.y };
      });

      canvas.on("mouse:up", () => {
        const tap = tapDown;
        tapDown = null;
        if (!tap) return;

        const existingNumbers = canvas
          .getObjects()
          .filter((o: any) => o.type === "FabricNumberedMarker")
          .map((o: any) => o.markerNumber as number);
        const MarkerClass = fabric.classRegistry.getClass(
          "FabricNumberedMarker"
        );
        const marker = new MarkerClass({
          left: tap.x,
          top: tap.y,
          markerNumber: nextMarkerNumber(existingNumbers),
          markerColor: activeColorRef.current,
        });
        canvas.add(marker);
        canvas.setActiveObject(marker);
        canvas.renderAll();
        // Drop is this marker's explicit commit point (#813): record it into the
        // undo stack and schedule the markup save. object:added alone only
        // markDirty's the save — placement is never recorded on raw add.
        recordStep();
      });
    } else {
      // ── Shape tools: circle, rectangle ──
      canvas.isDrawingMode = false;
      canvas.selection = true;

      // Make all objects interactive
      canvas.forEachObject((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
      });

      canvas.on("mouse:down", (opt: any) => {
        if (opt.target) {
          // Clicked on an existing object — let Fabric handle selection natively
          // Don't start drawing a new shape
          return;
        }
        // Clicked on empty canvas — start drawing a new shape
        canvas.discardActiveObject();
        canvas.renderAll();
        const pointer = canvas.getScenePoint(opt.e);
        isDrawingShape.current = true;
        shapeStart.current = { x: pointer.x, y: pointer.y };
        currentShape.current = null;
      });

      canvas.on("mouse:move", (opt: any) => {
        if (!isDrawingShape.current) return;
        const pointer = canvas.getScenePoint(opt.e);
        const tool = activeToolRef.current;
        const color = activeColorRef.current;
        const thick = activeThicknessRef.current;
        const { x: sx, y: sy } = shapeStart.current;
        const dx = pointer.x - sx;
        const dy = pointer.y - sy;

        if (currentShape.current) canvas.remove(currentShape.current);

        let shape: any;
        if (tool === "circle") {
          shape = new fabric.Ellipse({
            left: Math.min(sx, pointer.x),
            top: Math.min(sy, pointer.y),
            rx: Math.abs(dx) / 2,
            ry: Math.abs(dy) / 2,
            fill: "transparent",
            stroke: color,
            strokeWidth: thick,
            selectable: false,
            shadow: new fabric.Shadow(SHADOW_CONFIG),
          });
        } else if (tool === "rectangle") {
          shape = new fabric.Rect({
            left: Math.min(sx, pointer.x),
            top: Math.min(sy, pointer.y),
            width: Math.abs(dx),
            height: Math.abs(dy),
            fill: "transparent",
            stroke: color,
            strokeWidth: thick,
            selectable: false,
            shadow: new fabric.Shadow(SHADOW_CONFIG),
          });
        }

        if (shape) {
          currentShape.current = shape;
          canvas.add(shape);
          canvas.renderAll();
        }
      });

      canvas.on("mouse:up", () => {
        if (!isDrawingShape.current) return;
        isDrawingShape.current = false;

        if (currentShape.current) {
          // Finalize circle/rectangle — make selectable
          currentShape.current.set({
            selectable: true,
            evented: true,
            ...handleSizeProps(),
          });
          currentShape.current.setCoords();
          canvas.renderAll();
          recordStep();
        }
        currentShape.current = null;
      });
    }

    // Cleanup for non-polyline tools (polyline returns its own cleanup above)
    return () => {
      canvas.off("mouse:down");
      canvas.off("mouse:move");
      canvas.off("mouse:up");
      canvas.off("mouse:dblclick");
    };
  }, [activeTool, activeColor, activeThickness, canvasReady]);

  // ─── Desktop wheel zoom (issue #814 AC1) ───────────────────────────────────
  // Scroll / trackpad-pinch magnifies about the cursor, independent of the
  // active tool. Fabric's mouse:wheel hands us the native event; an exponential
  // factor keeps each notch proportional so wheel and trackpad feel even.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvasReady) return;

    const onWheel = (opt: any) => {
      if (isCroppingRef.current) return;
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      const ctx = viewportCtx();
      const focal = clientToViewport(e.clientX, e.clientY);
      if (!ctx || !focal) return;
      const factor = Math.exp(-e.deltaY * 0.0015);
      commitTransform(zoomBy(transformRef.current, factor, focal, ctx));
    };

    canvas.on("mouse:wheel", onWheel);
    return () => canvas.off("mouse:wheel", onWheel);
  }, [canvasReady, viewportCtx, commitTransform, clientToViewport]);

  // ─── Touch: pinch-zoom + two-finger pan (issue #814 AC1/AC4/AC5) ───────────
  // Fabric has no native pinch and every one of its canvas listeners is
  // bubble-phase, so capture-phase listeners on the wrapper see each touch
  // first. The moment a second finger lands we own the gesture: stop
  // propagation (Fabric never draws), zoom by the change in finger spread about
  // the pinch midpoint, and pan by the midpoint's travel — both clamped through
  // the shared model. A lone finger falls straight through to Fabric, so
  // drawing / placing / selecting is untouched (AC5). `gestureActiveRef` stays
  // set until the LAST finger lifts, so a leftover finger can't resume a draw
  // mid-gesture, and at release Fabric's touch bookkeeping is reset so the next
  // single-finger draw isn't rejected by its main-touch identifier check.
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper || !canvasReady) return;

    const dist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a: Touch, b: Touch) => ({
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    });

    const onTouchStart = (e: TouchEvent) => {
      if (isCroppingRef.current || e.touches.length < 2) return;
      e.stopPropagation();
      e.preventDefault();
      // A second finger just joined a single-finger draw — abandon that draw.
      if (!gestureActiveRef.current) cancelInProgressDraw();
      gestureActiveRef.current = true;
      pinchRef.current = {
        lastDist: dist(e.touches[0], e.touches[1]),
        lastMid: mid(e.touches[0], e.touches[1]),
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isCroppingRef.current || !gestureActiveRef.current) return;
      // While the gesture owns the surface, eat every move — including a
      // momentary single-finger frame — so the leftover finger never draws.
      e.stopPropagation();
      e.preventDefault();
      if (e.touches.length < 2 || !pinchRef.current) return;
      const ctx = viewportCtx();
      if (!ctx) return;

      const d = dist(e.touches[0], e.touches[1]);
      const m = mid(e.touches[0], e.touches[1]);
      const prev = pinchRef.current;
      const fPrev = clientToViewport(prev.lastMid.x, prev.lastMid.y);
      const fCur = clientToViewport(m.x, m.y);
      pinchRef.current = { lastDist: d, lastMid: m };

      let next = transformRef.current;
      if (fCur && prev.lastDist > 0) {
        next = zoomBy(next, d / prev.lastDist, fCur, ctx);
      }
      if (fPrev && fCur) {
        next = pan(next, fCur.x - fPrev.x, fCur.y - fPrev.y, ctx);
      }
      commitTransform(next);
    };

    const endGesture = (e: TouchEvent) => {
      if (!gestureActiveRef.current) return;
      // Hold the gesture (and keep eating events) until EVERY finger is up.
      if (e.touches.length > 0) {
        e.stopPropagation();
        e.preventDefault();
        pinchRef.current =
          e.touches.length >= 2
            ? {
                lastDist: dist(e.touches[0], e.touches[1]),
                lastMid: mid(e.touches[0], e.touches[1]),
              }
            : null;
        return;
      }
      pinchRef.current = null;
      gestureActiveRef.current = false;
      const canvas = fabricRef.current;
      if (canvas) {
        delete canvas.mainTouchId;
        canvas._isCurrentlyDrawing = false;
      }
    };

    const opts = { capture: true, passive: false } as AddEventListenerOptions;
    wrapper.addEventListener("touchstart", onTouchStart, opts);
    wrapper.addEventListener("touchmove", onTouchMove, opts);
    wrapper.addEventListener("touchend", endGesture, opts);
    wrapper.addEventListener("touchcancel", endGesture, opts);
    return () => {
      wrapper.removeEventListener("touchstart", onTouchStart, opts);
      wrapper.removeEventListener("touchmove", onTouchMove, opts);
      wrapper.removeEventListener("touchend", endGesture, opts);
      wrapper.removeEventListener("touchcancel", endGesture, opts);
    };
  }, [
    canvasReady,
    viewportCtx,
    commitTransform,
    clientToViewport,
    cancelInProgressDraw,
  ]);

  // ─── Finalize Polyline ─────────────────────────────────────────────────────

  function finalizePolyline(closed: boolean) {
    const pts = polyDrawingRef.current?.points;
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!pts || pts.length < 2 || !canvas || !fabric) {
      polyDrawingRef.current = null;
      polyPreviewRef.current = null;
      return;
    }

    const PolyClass = closed ? fabric.Polygon : fabric.Polyline;
    const poly = new PolyClass(
      pts.map((p: any) => ({ x: p.x, y: p.y })),
      {
        stroke: activeColorRef.current,
        strokeWidth: activeThicknessRef.current,
        fill: "transparent",
        selectable: true,
        evented: true,
        objectCaching: false,
        shadow: new fabric.Shadow(SHADOW_CONFIG),
      }
    );

    // Add vertex controls
    if (fabric.createPolyControls) {
      poly.controls = fabric.createPolyControls(poly);
    }
    poly.hasBorders = false;
    poly.cornerStyle = "circle";
    poly.cornerColor = "#FFFFFF";
    poly.cornerStrokeColor = activeColorRef.current;
    poly.set(handleSizeProps());
    poly.transparentCorners = false;

    canvas.add(poly);
    canvas.renderAll();

    polyDrawingRef.current = null;
    polyPreviewRef.current = null;
    recordStep();
  }

  // ─── In-context Toolbar Handlers (every Annotation kind) ────────────────────

  // Label control. The per-object Label flow exists for Arrows and Numbered
  // markers (both render their own `labelText`); on other shapes the Label
  // control is present but a safe no-op until the Attached Labels slice (#804)
  // lands — it must never throw or corrupt the object.
  function handleLabel(target: any) {
    const kind = target ? annotationKind(target.type) : null;
    if (kind !== "arrow" && kind !== "marker") return;
    setLabelInput({
      target,
      text: target.labelText || "Label",
    });
    setObjectToolbar(null);
  }

  function handleLabelSubmit() {
    if (!labelInput) return;
    const canvas = fabricRef.current;
    const target = labelInput.target;
    target.labelText = labelInput.text || null;
    target.set("dirty", true);
    canvas?.renderAll();
    setLabelInput(null);
    // recordStep is this edit's commit point (#813): it snapshots the canvas —
    // capturing the just-set labelText via ANNOTATION_CUSTOM_PROPS — into the
    // undo stack AND schedules the debounced markup save, so the new label
    // reaches saved markup without a separate object:modified fire.
    recordStep();
  }

  // Duplicate control. The Arrow keeps its bespoke copy (its endpoints, not just
  // left/top, must shift); every other shape is cloned and nudged by the same
  // offset. Text boxes and freehand drawings expose no Copy control, so they
  // never reach here.
  async function handleCopy(target: any) {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !fabric || !target) return;

    if (annotationKind(target.type) === "arrow") {
      const ArrowClass = fabric.classRegistry.getClass("FabricArrow");
      const copy = new ArrowClass({
        x1: target.x1 + DUPLICATE_OFFSET,
        y1: target.y1 + DUPLICATE_OFFSET,
        x2: target.x2 + DUPLICATE_OFFSET,
        y2: target.y2 + DUPLICATE_OFFSET,
        arrowColor: target.arrowColor,
        arrowThickness: target.arrowThickness,
        labelText: target.labelText,
        labelFontSize: target.labelFontSize,
      });
      canvas.add(copy);
      canvas.renderAll();
      setObjectToolbar(null);
      recordStep();
      return;
    }

    const clone = await target.clone();
    clone.set({
      left: (clone.left ?? 0) + DUPLICATE_OFFSET,
      top: (clone.top ?? 0) + DUPLICATE_OFFSET,
      selectable: true,
      evented: true,
      // Keep a duplicate's editor handles finger-sized like every other
      // creation path (#810), not the small Fabric defaults clone() may carry.
      ...handleSizeProps(),
    });
    clone.setCoords();
    canvas.add(clone);
    // Restore vertex editing on duplicated polylines/polygons.
    const cloneKind = annotationKind(clone.type);
    if (
      (cloneKind === "polyline" || cloneKind === "polygon") &&
      fabric.createPolyControls
    ) {
      clone.controls = fabric.createPolyControls(clone);
      clone.objectCaching = false;
    }
    canvas.renderAll();
    setObjectToolbar(null);
    recordStep();
  }

  // Delete control. Uniform across kinds — remove the object, drop the
  // selection, and dismiss the toolbar.
  function handleDelete(target: any) {
    const canvas = fabricRef.current;
    if (!canvas || !target) return;
    canvas.remove(target);
    canvas.discardActiveObject();
    canvas.renderAll();
    setObjectToolbar(null);
    recordStep();
  }

  // ─── Crop System ───────────────────────────────────────────────────────────

  function drawCropOverlay(canvas: any) {
    const cropRect = cropRectRef.current;
    if (!cropRect || !canvas.getObjects().includes(cropRect)) return;
    const ctx = canvas.getContext();
    const cw = canvas.width!;
    const ch = canvas.height!;
    const left = cropRect.left!;
    const top = cropRect.top!;
    const w = cropRect.width! * (cropRect.scaleX || 1);
    const h = cropRect.height! * (cropRect.scaleY || 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + h);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left + w, top);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fill("evenodd");

    const thirdW = w / 3;
    const thirdH = h / 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + thirdW, top);
    ctx.lineTo(left + thirdW, top + h);
    ctx.moveTo(left + 2 * thirdW, top);
    ctx.lineTo(left + 2 * thirdW, top + h);
    ctx.moveTo(left, top + thirdH);
    ctx.lineTo(left + w, top + thirdH);
    ctx.moveTo(left, top + 2 * thirdH);
    ctx.lineTo(left + w, top + 2 * thirdH);
    ctx.stroke();
    ctx.restore();
  }

  function cleanupCropObjects(canvas: any) {
    if (cropRenderCallbackRef.current) {
      canvas.off("after:render", cropRenderCallbackRef.current);
      cropRenderCallbackRef.current = null;
    }
    if (cropRectRef.current) {
      canvas.remove(cropRectRef.current);
      cropRectRef.current = null;
    }
    hiddenObjectsRef.current.forEach((obj) => {
      obj.visible = true;
    });
    hiddenObjectsRef.current = [];
    canvas.off("object:moving", handleCropObjMove);
    canvas.off("object:scaling", handleCropObjScale);
  }

  function handleCropObjMove(e: any) {
    const canvas = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect || e.target !== cropRect) return;
    const cw = canvas.width!;
    const ch = canvas.height!;
    const w = cropRect.width! * (cropRect.scaleX || 1);
    const h = cropRect.height! * (cropRect.scaleY || 1);
    cropRect.set({
      left: Math.max(0, Math.min(cropRect.left!, cw - w)),
      top: Math.max(0, Math.min(cropRect.top!, ch - h)),
    });
    canvas.renderAll();
  }

  function handleCropObjScale(e: any) {
    const canvas = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect || e.target !== cropRect) return;
    const cw = canvas.width!;
    const ch = canvas.height!;
    let w = cropRect.width! * (cropRect.scaleX || 1);
    let h = cropRect.height! * (cropRect.scaleY || 1);
    if (w < 50) {
      cropRect.set({ scaleX: 50 / cropRect.width! });
      w = 50;
    }
    if (h < 50) {
      cropRect.set({ scaleY: 50 / cropRect.height! });
      h = 50;
    }
    if (cropRect.left! < 0) cropRect.set({ left: 0 });
    if (cropRect.top! < 0) cropRect.set({ top: 0 });
    if (cropRect.left! + w > cw)
      cropRect.set({ scaleX: (cw - cropRect.left!) / cropRect.width! });
    if (cropRect.top! + h > ch)
      cropRect.set({ scaleY: (ch - cropRect.top!) / cropRect.height! });
    canvas.renderAll();
  }

  function handleStartCrop() {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !fabric) return;

    // Crop reasons in raw canvas pixels (overlay + toCanvasElement), so snap the
    // view back to fit first — any active zoom would otherwise mis-align the
    // crop rectangle against the Photo (#814).
    commitTransform(FIT);

    setIsCropping(true);
    setActiveTool("crop");

    const existingObjects = canvas.getObjects().slice();
    existingObjects.forEach((obj: any) => {
      obj.visible = false;
    });
    hiddenObjectsRef.current = existingObjects;

    const cw = canvas.width!;
    const ch = canvas.height!;
    const sw = 2;
    const cropRect = new fabric.Rect({
      left: sw,
      top: sw,
      width: cw - sw * 2,
      height: ch - sw * 2,
      fill: "rgba(255,255,255,0.01)",
      stroke: "#FFFFFF",
      strokeWidth: sw,
      strokeUniform: true,
      originX: "left",
      originY: "top",
      cornerColor: "#FFFFFF",
      cornerStrokeColor: "#FFFFFF",
      cornerSize: 12,
      transparentCorners: false,
      cornerStyle: "rect",
      selectable: true,
      evented: true,
      lockRotation: true,
      hasRotatingPoint: false,
      perPixelTargetFind: false,
    });
    cropRectRef.current = cropRect;

    const renderCallback = () => drawCropOverlay(canvas);
    cropRenderCallbackRef.current = renderCallback;
    canvas.on("after:render", renderCallback);
    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);
    canvas.renderAll();
    canvas.on("object:moving", handleCropObjMove);
    canvas.on("object:scaling", handleCropObjScale);
  }

  function handleResetCrop() {
    const canvas = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect) return;
    const cw = canvas.width!;
    const ch = canvas.height!;
    const sw = 2;
    cropRect.set({
      left: sw,
      top: sw,
      width: cw - sw * 2,
      height: ch - sw * 2,
      scaleX: 1,
      scaleY: 1,
    });
    cropRect.setCoords();
    canvas.setActiveObject(cropRect);
    canvas.renderAll();
  }

  async function handleApplyCrop() {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    const cropRect = cropRectRef.current;
    const bgImg = bgImageRef.current;
    if (!canvas || !fabric || !cropRect || !bgImg || !currentPhoto) return;

    const left = cropRect.left!;
    const top = cropRect.top!;
    const cWidth = cropRect.width! * (cropRect.scaleX || 1);
    const cHeight = cropRect.height! * (cropRect.scaleY || 1);

    cleanupCropObjects(canvas);

    const { scale } = imgDimensionsRef.current;
    const multiplier = 1 / scale;
    const fullResCanvas = canvas.toCanvasElement(multiplier);
    const srcLeft = Math.round(left * multiplier);
    const srcTop = Math.round(top * multiplier);
    const srcWidth = Math.round(cWidth * multiplier);
    const srcHeight = Math.round(cHeight * multiplier);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = srcWidth;
    tempCanvas.height = srcHeight;
    const ctx = tempCanvas.getContext("2d")!;
    ctx.drawImage(
      fullResCanvas,
      srcLeft,
      srcTop,
      srcWidth,
      srcHeight,
      0,
      0,
      srcWidth,
      srcHeight
    );

    const supabase = createClient();
    const backupPath = currentPhoto.storage_path.replace(
      /\.[^.]+$/,
      "-original$&"
    );
    if (!hasOriginalBackup) {
      try {
        await supabase.storage
          .from("photos")
          .copy(currentPhoto.storage_path, backupPath);
        setHasOriginalBackup(true);
      } catch (err) {
        console.error("Failed to backup original:", err);
      }
    }

    try {
      const blob = await new Promise<Blob>((resolve) => {
        tempCanvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92);
      });
      await supabase.storage
        .from("photos")
        .upload(currentPhoto.storage_path, blob, {
          upsert: true,
          contentType: "image/jpeg",
        });
    } catch (err) {
      console.error("Failed to upload cropped image:", err);
    }

    const croppedDataUrl = tempCanvas.toDataURL("image/jpeg", 0.92);
    const croppedImg = await new Promise<HTMLImageElement>((resolve) => {
      const el = document.createElement("img");
      el.onload = () => resolve(el);
      el.src = croppedDataUrl;
    });

    const maxWidth = window.innerWidth - 72;
    const maxHeight = window.innerHeight;
    const newScale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight, 1);
    const newCanvasWidth = Math.round(srcWidth * newScale);
    const newCanvasHeight = Math.round(srcHeight * newScale);

    const newFabricImg = new fabric.FabricImage(croppedImg, {
      left: 0,
      top: 0,
      width: srcWidth,
      height: srcHeight,
      scaleX: newScale,
      scaleY: newScale,
      angle: 0,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });

    canvas.getObjects().forEach((obj: any) => canvas.remove(obj));
    canvas.setDimensions({ width: newCanvasWidth, height: newCanvasHeight });
    bgImageRef.current = newFabricImg;
    canvas.backgroundImage = newFabricImg;
    canvas.renderAll();

    imgDimensionsRef.current = {
      width: srcWidth,
      height: srcHeight,
      scale: newScale,
    };

    setIsCropping(false);
    setActiveTool("arrow");
    toast.success("Image cropped and saved.");
  }

  async function handleRestoreOriginal() {
    if (!currentPhoto || !hasOriginalBackup) return;

    const supabase = createClient();
    const backupPath = currentPhoto.storage_path.replace(
      /\.[^.]+$/,
      "-original$&"
    );

    try {
      const { data: backupBlob } = await supabase.storage
        .from("photos")
        .download(backupPath);
      if (!backupBlob) throw new Error("Backup not found");

      await supabase.storage
        .from("photos")
        .upload(currentPhoto.storage_path, backupBlob, {
          upsert: true,
          contentType: backupBlob.type,
        });

      await supabase.storage.from("photos").remove([backupPath]);
      setHasOriginalBackup(false);

      toast.success("Original image restored.");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("Failed to restore original:", err);
      toast.error("Failed to restore original image.");
    }
  }

  function handleCancelCrop() {
    const canvas = fabricRef.current;
    if (canvas) {
      cleanupCropObjects(canvas);
      canvas.renderAll();
    }
    setIsCropping(false);
    setActiveTool("arrow");
  }

  // ─── Rotate ────────────────────────────────────────────────────────────────

  function handleRotate() {
    const canvas = fabricRef.current;
    const bgImg = bgImageRef.current;
    if (!canvas || !bgImg) return;

    // Rotating resizes the canvas; reset the view to fit so a prior zoom can't
    // leave the re-dimensioned scene mis-framed (#814).
    commitTransform(FIT);

    const { width, height } = imgDimensionsRef.current;
    const newImgWidth = height;
    const newImgHeight = width;
    const maxWidth = window.innerWidth - 72;
    const maxHeight = window.innerHeight;
    const newScale = Math.min(
      maxWidth / newImgWidth,
      maxHeight / newImgHeight,
      1
    );
    const canvasWidth = Math.round(newImgWidth * newScale);
    const canvasHeight = Math.round(newImgHeight * newScale);

    imgDimensionsRef.current = {
      width: newImgWidth,
      height: newImgHeight,
      scale: newScale,
    };

    const currentAngle = bgImg.angle || 0;
    bgImg.set({
      angle: currentAngle + 90,
      scaleX: newScale,
      scaleY: newScale,
      left: canvasWidth / 2,
      top: canvasHeight / 2,
      originX: "center",
      originY: "center",
    });

    canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
    canvas.renderAll();
  }

  // ─── History capture & restore ─────────────────────────────────────────────

  /** Snapshot the current markup objects (carrying the FabricArrow custom props
   *  so an arrow's geometry, color, label and styling round-trip) — the opaque
   *  T the pure history stack stores. The background photo is excluded; only the
   *  user-placed annotations are versioned. */
  function snapshotObjects(canvas: any): Annotation[] {
    return canvas.toJSON([...ANNOTATION_CUSTOM_PROPS]).objects as Annotation[];
  }

  /** Mirror the stack's derived canUndo/canRedo onto state so the toolbar
   *  buttons enable/disable immediately after every step, undo and redo. */
  function syncHistoryFlags() {
    setCanUndoState(historyCanUndo(historyRef.current));
    setCanRedoState(historyCanRedo(historyRef.current));
  }

  /** Push the canvas's current state as one completed step, refresh the derived
   *  flags, mark the Photo dirty (so the on-exit PNG rebuild still fires per ADR
   *  0024), and feed the cheap debounced markup save. Called at every commit
   *  point — never mid-draw, so a preview object can't land in the stack — and
   *  suppressed while we're replaying a snapshot back onto the canvas. */
  function recordStep() {
    const canvas = fabricRef.current;
    if (!canvas || isRestoringRef.current) return;
    const objects = snapshotObjects(canvas);
    historyRef.current = pushHistory(historyRef.current, objects);
    syncHistoryFlags();
    isDirtyRef.current = true;
    autoSave.scheduleMarkupSave(serializeAnnotations(objects));
  }

  /** Replay a stored snapshot onto the canvas, preserving the background and
   *  re-attaching polyline vertex controls, exactly like the initial load.
   *  Guarded with isRestoringRef so the object churn it causes never records a
   *  new step. */
  async function restoreSnapshot(objects: Annotation[]) {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !fabric) return;
    isRestoringRef.current = true;
    try {
      const bg = canvas.backgroundImage;
      canvas.discardActiveObject();
      await canvas.loadFromJSON({ version: "7.2.0", objects });
      canvas.backgroundImage = bg;
      attachEditorHandles(canvas, fabric);
      canvas.renderAll();
    } finally {
      isRestoringRef.current = false;
    }
    setObjectToolbar(null);
  }

  // ─── Undo / Redo / Clear ───────────────────────────────────────────────────

  function handleUndo() {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // While a polyline is actively being drawn, Undo backs out the last placed
    // vertex (and dismisses the in-progress polyline once a single point is
    // left) instead of popping the committed history stack.
    if (polyDrawingRef.current) {
      const pts = polyDrawingRef.current.points;
      if (pts.length > 1) {
        pts.pop();
      } else {
        polyDrawingRef.current = null;
        polyPreviewRef.current = null;
      }
      canvas.renderAll();
      return;
    }

    if (!historyCanUndo(historyRef.current)) return;
    historyRef.current = undoHistory(historyRef.current);
    const restored = historyRef.current.present;
    void restoreSnapshot(restored);
    syncHistoryFlags();
    isDirtyRef.current = true;
    // Feed the cheap debounced markup save from the restored snapshot itself,
    // not the canvas — restoreSnapshot's loadFromJSON is async, so reading the
    // canvas here would capture the pre-undo state (and an undo back to an empty
    // canvas fires no object events to piggyback on).
    autoSave.scheduleMarkupSave(serializeAnnotations(restored));
  }

  function handleRedo() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (!historyCanRedo(historyRef.current)) return;
    historyRef.current = redoHistory(historyRef.current);
    const restored = historyRef.current.present;
    void restoreSnapshot(restored);
    syncHistoryFlags();
    isDirtyRef.current = true;
    autoSave.scheduleMarkupSave(serializeAnnotations(restored));
  }

  function handleClear() {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Dismiss any in-progress polyline first — it isn't a committed object.
    polyDrawingRef.current = null;
    polyPreviewRef.current = null;

    const objects = canvas.getObjects().slice();
    if (objects.length === 0) {
      canvas.renderAll();
      return;
    }
    objects.forEach((obj: any) => canvas.remove(obj));
    setObjectToolbar(null);
    canvas.renderAll();

    // Record the emptied canvas as ONE undoable step (a push of the empty
    // snapshot, not the stack-reset clear) so an immediate Undo brings every
    // annotation back at once.
    recordStep();
  }

  // ─── Close ─────────────────────────────────────────────────────────────────

  // Auto-save means there's no explicit "Save" button: every edit has already
  // debounced its cheap markup write. On close we only need to flush whatever
  // is still in the debounce window and rebuild the flattened Annotated Photo
  // (the expensive half of the ADR 0024 split write), then let the dialog go.
  // The rebuild runs in the background so closing feels instant.
  function handleClose() {
    if (isDirtyRef.current) {
      void autoSave.flushAndRebuild();
      isDirtyRef.current = false;
    }
    onOpenChange(false);
  }

  // ─── Photo Navigation ─────────────────────────────────────────────────────

  // Leaving a photo is a "leave" event too: flush + rebuild the OUTGOING photo
  // (passed explicitly so a write that lands after the swap can't be misfiled
  // onto the incoming one), then advance immediately. No save/discard prompt —
  // the edits are already persisted.
  function requestNav(targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= photos.length) return;
    if (isDirtyRef.current && currentPhoto) {
      void autoSave.flushAndRebuild(currentPhoto);
      isDirtyRef.current = false;
    }
    setCurrentIndex(targetIndex);
  }

  // ─── Keyboard Navigation ──────────────────────────────────────────────────

  useEffect(() => {
    if (!open || !canvasReady) return;

    function onKeyDown(e: KeyboardEvent) {
      // Don't navigate or undo/redo when editing text
      const active = fabricRef.current?.getActiveObject();
      if (active?.isEditing) return;

      // Undo / Redo: ⌘Z / Ctrl+Z, and ⇧⌘Z / Ctrl+Shift+Z to redo.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        requestNav(currentIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        requestNav(currentIndex + 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, canvasReady, currentIndex, photos.length]);

  // ─── Color / thickness editor for the selected Annotation (issue #815) ──────

  // With a styleable Annotation selected, the bottom palette edits THAT object
  // and pre-highlights its current color/thickness; with nothing styleable
  // selected it sets the defaults for the next new markup. Text boxes and the
  // background are excluded by supportsStyleEditor.
  const styleTarget =
    objectToolbar &&
    supportsStyleEditor(annotationKind(objectToolbar.target?.type))
      ? objectToolbar.target
      : null;
  const paletteColor = styleTarget ? currentColor(styleTarget) : activeColor;
  const paletteThickness = styleTarget
    ? currentThickness(styleTarget)
    : activeThickness;

  // Restyle the selected Annotation in place, then persist via the cheap markup
  // path: refresh an Arrow's bounds for its rescaled head, repaint, and fire
  // object:modified so the existing markDirty → debounced save runs (the
  // expensive flattened rebuild still waits for leave/close). Returns false when
  // nothing styleable is selected, so the caller falls back to setting defaults.
  function restyleSelected(mutate: (target: StyleTarget) => void): boolean {
    if (!styleTarget) return false;
    mutate(styleTarget);
    if (styleTarget.type === "FabricArrow") styleTarget._updateBounds();
    styleTarget.set("dirty", true);
    const canvas = fabricRef.current;
    canvas?.requestRenderAll();
    canvas?.fire("object:modified", { target: styleTarget });
    return true;
  }

  function handlePickColor(value: string) {
    if (!restyleSelected((t) => applyColor(t, value))) setActiveColor(value);
  }

  function handlePickThickness(value: number) {
    if (!restyleSelected((t) => applyThickness(t, value)))
      setActiveThickness(value);
  }

  // ─── Guard ─────────────────────────────────────────────────────────────────

  if (!open || photos.length === 0) return null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[100] flex bg-[#1a1a1a]">
      {/* Left Sidebar */}
      <div className="w-[56px] bg-[#111111] border-r border-[#333] flex flex-col items-center py-3 gap-1 overflow-y-auto">
        {/* Select tool */}
        <button
          onClick={() => !isCropping && setActiveTool("select")}
          title="Select"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            activeTool === "select"
              ? "bg-[#2B5EA7] text-white"
              : "text-[#999] hover:text-white hover:bg-[#333]"
          )}
        >
          <MousePointer size={18} />
        </button>

        {/* Pan tool (issue #814) */}
        <button
          onClick={() => !isCropping && setActiveTool("pan")}
          title="Pan"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            activeTool === "pan"
              ? "bg-[#2B5EA7] text-white"
              : "text-[#999] hover:text-white hover:bg-[#333]"
          )}
        >
          <Hand size={18} />
        </button>

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Drawing tools */}
        {TOOLS.map((tool) => (
          <button
            key={tool.value}
            onClick={() => !isCropping && setActiveTool(tool.value)}
            title={tool.label}
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
              activeTool === tool.value
                ? "bg-[#2B5EA7] text-white"
                : "text-[#999] hover:text-white hover:bg-[#333]"
            )}
          >
            <tool.icon size={18} />
          </button>
        ))}

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Colors */}
        {ANNOTATION_COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => handlePickColor(color.value)}
            title={color.label}
            className={cn(
              "w-6 h-6 rounded-full border-2 transition-all",
              paletteColor === color.value
                ? "border-white scale-125"
                : "border-[#555] hover:border-[#888]"
            )}
            style={{ backgroundColor: color.value }}
          />
        ))}

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Line Thickness */}
        {ANNOTATION_THICKNESSES.map((t) => (
          <button
            key={t.value}
            onClick={() => handlePickThickness(t.value)}
            title={t.label}
            className={cn(
              "w-10 h-8 rounded-lg flex items-center justify-center transition-all",
              paletteThickness === t.value
                ? "border border-white scale-110"
                : "border border-transparent hover:border-[#555]"
            )}
          >
            <div
              className="rounded-full"
              style={{
                width: 20,
                height: t.value,
                backgroundColor: paletteColor,
              }}
            />
          </button>
        ))}

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Rotate */}
        <button
          onClick={handleRotate}
          title="Rotate 90°"
          disabled={isCropping}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#999] hover:text-white hover:bg-[#333] transition-colors disabled:opacity-30"
        >
          <RotateCw size={18} />
        </button>

        {/* Crop */}
        <button
          onClick={isCropping ? undefined : handleStartCrop}
          title="Crop"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            isCropping
              ? "bg-[#2B5EA7] text-white"
              : "text-[#999] hover:text-white hover:bg-[#333]"
          )}
        >
          <Crop size={18} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo / Redo / Clear */}
        <button
          onClick={handleUndo}
          disabled={!canUndoState}
          title="Undo (⌘Z)"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            canUndoState
              ? "text-[#999] hover:text-white hover:bg-[#333]"
              : "text-[#555] cursor-not-allowed"
          )}
        >
          <Undo2 size={18} />
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedoState}
          title="Redo (⇧⌘Z)"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            canRedoState
              ? "text-[#999] hover:text-white hover:bg-[#333]"
              : "text-[#555] cursor-not-allowed"
          )}
        >
          <Redo2 size={18} />
        </button>
        <button
          onClick={handleClear}
          title="Clear All"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#999] hover:text-[#C41E2A] hover:bg-[#333] transition-colors"
        >
          <Trash2 size={18} />
        </button>
      </div>

      {/* Main canvas area */}
      <div className="flex-1 flex flex-col relative">
        {/* Photo counter */}
        {photos.length > 1 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-black/60 text-white text-xs px-3 py-1 rounded-full">
            {currentIndex + 1} / {photos.length}
          </div>
        )}

        {/* Crop floating panel */}
        {isCropping && (
          <div className="absolute top-4 left-2 z-10 bg-white rounded-xl shadow-2xl w-[170px] overflow-hidden">
            <div className="px-4 pt-3 pb-2">
              <h3 className="text-sm font-semibold text-[#1a1a1a]">
                Crop Image
              </h3>
            </div>
            <div className="h-px bg-[#e5e5e5]" />
            <div className="p-3 flex flex-col gap-2">
              <button
                onClick={handleResetCrop}
                className="w-full px-3 py-2 bg-[#f0f0f0] hover:bg-[#e5e5e5] text-[#333] text-sm font-medium rounded-lg transition-colors"
              >
                Reset Crop
              </button>
              <button
                onClick={handleApplyCrop}
                className="w-full px-3 py-2 bg-[#0F6E56] hover:bg-[#0a5a46] text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <Check size={14} />
                Apply
              </button>
              <button
                onClick={handleCancelCrop}
                className="w-full px-3 py-2 bg-[#f0f0f0] hover:bg-[#e5e5e5] text-[#555] text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
              {hasOriginalBackup && (
                <>
                  <div className="h-px bg-[#e5e5e5] my-1" />
                  <button
                    onClick={handleRestoreOriginal}
                    className="w-full px-3 py-2 bg-[#f0f0f0] hover:bg-[#FCEBEB] text-[#791F1F] text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ImageOff size={12} />
                    Restore Original
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* In-context action toolbar (every selected Annotation) */}
        {objectToolbar && (
          <div
            className="absolute z-20 flex items-center gap-0.5 bg-[#333] rounded-lg shadow-xl p-1"
            style={{
              left: objectToolbar.x,
              top: Math.max(8, objectToolbar.y - 52),
              transform: "translateX(-50%)",
            }}
          >
            {objectToolbar.controls.includes("label") && (
              <button
                onClick={() => handleLabel(objectToolbar.target)}
                title={objectToolbar.target?.labelText ? "Edit Label" : "Add Text"}
                className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#555] transition-colors"
              >
                <Type size={18} />
              </button>
            )}
            {objectToolbar.controls.includes("copy") && (
              <button
                onClick={() => handleCopy(objectToolbar.target)}
                title="Duplicate"
                className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#555] transition-colors"
              >
                <Copy size={18} />
              </button>
            )}
            {objectToolbar.controls.includes("delete") && (
              <button
                onClick={() => handleDelete(objectToolbar.target)}
                title="Delete"
                className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#C41E2A] transition-colors"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        )}

        {/* Label input (Arrow or Numbered marker) */}
        {labelInput &&
          (() => {
            // Anchor above the object: an Arrow over its endpoints, a marker
            // over its centre. Same canvas-pixel placement the Arrow has always
            // used (it ignores the canvas's centring offset by design).
            const t = labelInput.target;
            const isArrow = t.type === "FabricArrow";
            const popupLeft =
              (isArrow ? (t.x1 + t.x2) / 2 : t.left ?? 0) - 28;
            const popupTop =
              (isArrow ? Math.min(t.y1, t.y2) : t.top ?? 0) - 80;
            return (
              <div
                className="absolute z-30 bg-[#333] rounded-lg shadow-xl p-2 flex items-center gap-2"
                style={{ left: popupLeft, top: popupTop }}
              >
                <input
                  autoFocus
                  value={labelInput.text}
                  onChange={(e) =>
                    setLabelInput({ ...labelInput, text: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLabelSubmit();
                    if (e.key === "Escape") setLabelInput(null);
                  }}
                  className="bg-[#222] text-white text-sm px-2 py-1 rounded border border-[#555] outline-none focus:border-[#2B5EA7] w-32"
                  placeholder="Label text..."
                />
                <button
                  onClick={handleLabelSubmit}
                  className="w-7 h-7 rounded bg-[#0F6E56] text-white flex items-center justify-center hover:bg-[#0a5a46]"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setLabelInput(null)}
                  className="w-7 h-7 rounded bg-[#555] text-white flex items-center justify-center hover:bg-[#666]"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })()}

        {/* Navigation arrows */}
        {photos.length > 1 && currentIndex > 0 && (
          <button
            onClick={() => requestNav(currentIndex - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        {photos.length > 1 && currentIndex < photos.length - 1 && (
          <button
            onClick={() => requestNav(currentIndex + 1)}
            className="absolute right-14 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
          >
            <ChevronRight size={24} />
          </button>
        )}

        {/* Canvas */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {!canvasReady && (
            <div className="flex items-center gap-2">
              <Loader2 size={24} className="animate-spin text-[#999]" />
              <span className="text-sm text-[#999]">Loading editor...</span>
            </div>
          )}
          <div
            ref={canvasWrapperRef}
            className={cn(!canvasReady && "hidden")}
            // touch-action:none lets our capture-phase pinch / two-finger-pan
            // handlers own multitouch instead of the browser's native scroll-zoom.
            style={{ touchAction: "none" }}
          >
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* Zoom control (issue #814) — magnifies the whole scene (Photo +
            Annotations) via the shared transform model the Photo viewer uses. */}
        {canvasReady && !isCropping && (
          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-0.5 bg-black/60 text-white rounded-full p-1 shadow-lg">
            <button
              onClick={() => zoomStep(1 / ZOOM_STEP)}
              disabled={transform.scale <= MIN_SCALE}
              aria-label="zoom out"
              title="Zoom out"
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ZoomOut size={18} />
            </button>
            <button
              onClick={() => commitTransform(FIT)}
              aria-label="reset zoom to fit"
              title="Fit to screen"
              className="px-2 min-w-[3.75rem] h-9 rounded-full flex items-center justify-center gap-1 text-xs font-medium hover:bg-white/10 transition-colors"
            >
              <Maximize2 size={13} />
              {Math.round(transform.scale * 100)}%
            </button>
            <button
              onClick={() => zoomStep(ZOOM_STEP)}
              disabled={transform.scale >= MAX_SCALE}
              aria-label="zoom in"
              title="Zoom in"
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ZoomIn size={18} />
            </button>
          </div>
        )}

        {/* Done - top right. Edits auto-save; this just flushes + closes. */}
        <div className="absolute top-3 right-4 flex items-center gap-2">
          <button
            onClick={handleClose}
            title="Done"
            className="w-10 h-10 rounded-full bg-[#0F6E56] hover:bg-[#0a5a46] text-white flex items-center justify-center transition-colors shadow-lg"
          >
            <Check size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Photo } from "@/lib/types";
import { originalPhotoUrl } from "@/lib/jobs/photo-url";
import { persistAnnotatedRender } from "@/lib/jobs/persist-annotated-render";
import {
  ANNOTATION_CUSTOM_PROPS,
  parseAnnotations,
  serializeAnnotations,
} from "@/lib/jobs/photo-annotation-format";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Circle,
  Square,
  Type,
  MousePointer,
  Undo2,
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
} from "lucide-react";
import { toast } from "sonner";

// ─── Types & Constants ───────────────────────────────────────────────────────

type Tool =
  | "select"
  | "freehand"
  | "circle"
  | "rectangle"
  | "text"
  | "arrow"
  | "polyline"
  | "crop";

const COLORS = [
  { value: "#F59E0B", label: "Yellow" },
  { value: "#C41E2A", label: "Red" },
  { value: "#2B5EA7", label: "Blue" },
  { value: "#0F6E56", label: "Green" },
  { value: "#FFFFFF", label: "White" },
  { value: "#1A1A1A", label: "Black" },
];

const THICKNESSES = [
  { value: 2, label: "Thin" },
  { value: 4, label: "Medium" },
  { value: 8, label: "Thick" },
];

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
];

const SHADOW_CONFIG = {
  color: "rgba(0,0,0,0.6)",
  blur: 4,
  offsetX: 2,
  offsetY: 2,
};

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
      const headLen = thick * 4;
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
          sizeX: 20,
          sizeY: 20,
          touchSizeX: 30,
          touchSizeY: 30,
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
            ctx.arc(left, top, 8, 0, 2 * Math.PI);
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
  const fabricRef = useRef<any>(null);
  const fabricModuleRef = useRef<any>(null);
  const bgImageRef = useRef<any>(null);
  const imgDimensionsRef = useRef<{
    width: number;
    height: number;
    scale: number;
  }>({ width: 800, height: 600, scale: 1 });

  // ── Tool state ──
  const [activeTool, setActiveTool] = useState<Tool>("arrow");
  const [activeColor, setActiveColor] = useState("#F59E0B");
  const [activeThickness, setActiveThickness] = useState(4);
  const [canvasReady, setCanvasReady] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Crop state ──
  const [isCropping, setIsCropping] = useState(false);
  const [hasOriginalBackup, setHasOriginalBackup] = useState(false);
  const cropRectRef = useRef<any>(null);
  const cropRenderCallbackRef = useRef<any>(null);
  const hiddenObjectsRef = useRef<any[]>([]);

  // ── Arrow toolbar ──
  const [arrowToolbar, setArrowToolbar] = useState<{
    x: number;
    y: number;
    arrow: any;
  } | null>(null);
  const [labelInput, setLabelInput] = useState<{
    arrow: any;
    text: string;
  } | null>(null);

  // ── Photo navigation ──
  const [navPrompt, setNavPrompt] = useState<number | null>(null);
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

  // ── Refs that sync with state ──
  const activeToolRef = useRef<Tool>(activeTool);
  const activeColorRef = useRef(activeColor);
  const activeThicknessRef = useRef(activeThickness);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    activeColorRef.current = activeColor;
  }, [activeColor]);
  useEffect(() => {
    activeThicknessRef.current = activeThickness;
  }, [activeThickness]);

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
    attachPolyControls(canvas, fabric);
    canvas.renderAll();
  }

  /** After loading from JSON, add vertex controls to Polyline/Polygon objects */
  function attachPolyControls(canvas: any, fabric: any) {
    canvas.getObjects().forEach((obj: any) => {
      if (obj.type === "Polyline" || obj.type === "Polygon") {
        if (fabric.createPolyControls) {
          obj.controls = fabric.createPolyControls(obj);
        }
        obj.hasBorders = false;
        obj.objectCaching = false;
        obj.cornerStyle = "circle";
        obj.cornerColor = "#FFFFFF";
        obj.cornerStrokeColor = obj.stroke || "#F59E0B";
        obj.cornerSize = 14;
        obj.transparentCorners = false;
      }
    });
  }

  // ─── Main open/photo/index effect ──────────────────────────────────────────

  useEffect(() => {
    if (open && currentPhoto) {
      setCanvasReady(false);
      setIsCropping(false);
      setArrowToolbar(null);
      setLabelInput(null);
      setNavPrompt(null);
      cropRectRef.current = null;
      cropRenderCallbackRef.current = null;
      hiddenObjectsRef.current = [];
      polyDrawingRef.current = null;
      polyPreviewRef.current = null;
      isDirtyRef.current = false;
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
    };
    canvas.on("object:added", markDirty);
    canvas.on("object:modified", markDirty);
    canvas.on("object:removed", markDirty);

    return () => {
      canvas.off("object:added", markDirty);
      canvas.off("object:modified", markDirty);
      canvas.off("object:removed", markDirty);
    };
  }, [canvasReady]);

  // ─── Arrow selection / toolbar / movement sync ─────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvasReady) return;

    function onSelected(e: any) {
      const target = e.selected?.[0] || e.target;
      if (target?.type === "FabricArrow") {
        const canvasEl = canvas.getElement();
        const rect = canvasEl.getBoundingClientRect();
        const midX = (target.x1 + target.x2) / 2;
        const midY = Math.min(target.y1, target.y2);
        setArrowToolbar({
          x: rect.left + midX - 56,
          y: rect.top + midY,
          arrow: target,
        });
      } else {
        setArrowToolbar(null);
      }
    }

    function onDeselected() {
      setArrowToolbar(null);
    }

    function onMoving(e: any) {
      const target = e.target;
      // Sync FabricArrow endpoints when the body is dragged
      if (target?.type === "FabricArrow") {
        target._syncEndpointsToPosition();
      }
      // Hide toolbar during movement
      setArrowToolbar(null);
    }

    function onModified(e: any) {
      const target = e.target;
      if (target?.type === "FabricArrow") {
        target._syncEndpointsToPosition();
        const canvasEl = canvas.getElement();
        const rect = canvasEl.getBoundingClientRect();
        const midX = (target.x1 + target.x2) / 2;
        const midY = Math.min(target.y1, target.y2);
        setArrowToolbar({ x: rect.left + midX - 56, y: rect.top + midY, arrow: target });
      }
    }

    canvas.on("selection:created", onSelected);
    canvas.on("selection:updated", onSelected);
    canvas.on("selection:cleared", onDeselected);
    canvas.on("object:moving", onMoving);
    canvas.on("object:modified", onModified);

    return () => {
      canvas.off("selection:created", onSelected);
      canvas.off("selection:updated", onSelected);
      canvas.off("selection:cleared", onDeselected);
      canvas.off("object:moving", onMoving);
      canvas.off("object:modified", onModified);
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
    } else {
      // ── Shape tools: circle, rectangle, arrow ──
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
        } else if (tool === "arrow") {
          // Preview arrow as temporary path
          const ang = Math.atan2(dy, dx);
          const hl = thick * 4;
          const hx1 = pointer.x - hl * Math.cos(ang - Math.PI / 6);
          const hy1 = pointer.y - hl * Math.sin(ang - Math.PI / 6);
          const hx2 = pointer.x - hl * Math.cos(ang + Math.PI / 6);
          const hy2 = pointer.y - hl * Math.sin(ang + Math.PI / 6);
          shape = new fabric.Path(
            `M ${sx} ${sy} L ${pointer.x} ${pointer.y} M ${hx1} ${hy1} L ${pointer.x} ${pointer.y} L ${hx2} ${hy2}`,
            {
              stroke: color,
              strokeWidth: thick,
              strokeLineCap: "round",
              strokeLineJoin: "round",
              fill: "transparent",
              selectable: false,
              evented: false,
            }
          );
        }

        if (shape) {
          currentShape.current = shape;
          canvas.add(shape);
          canvas.renderAll();
        }
      });

      canvas.on("mouse:up", (opt: any) => {
        if (!isDrawingShape.current) return;
        isDrawingShape.current = false;

        if (activeToolRef.current === "arrow" && currentShape.current) {
          canvas.remove(currentShape.current);
          const pointer = canvas.getScenePoint(opt.e);
          const { x: sx, y: sy } = shapeStart.current;
          const dist = Math.sqrt((pointer.x - sx) ** 2 + (pointer.y - sy) ** 2);

          if (dist > 10) {
            const ArrowClass = fabric.classRegistry.getClass("FabricArrow");
            const arrow = new ArrowClass({
              x1: sx,
              y1: sy,
              x2: pointer.x,
              y2: pointer.y,
              arrowColor: activeColorRef.current,
              arrowThickness: activeThicknessRef.current,
            });
            canvas.add(arrow);
            canvas.renderAll();
          }
        } else if (currentShape.current) {
          // Finalize circle/rectangle — make selectable
          currentShape.current.set({ selectable: true, evented: true });
          currentShape.current.setCoords();
          canvas.renderAll();
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
    poly.cornerSize = 14;
    poly.transparentCorners = false;

    canvas.add(poly);
    canvas.renderAll();

    polyDrawingRef.current = null;
    polyPreviewRef.current = null;
  }

  // ─── Arrow Toolbar Handlers ────────────────────────────────────────────────

  function handleArrowAddText(arrow: any) {
    if (!arrow) return;
    setLabelInput({
      arrow,
      text: arrow.labelText || "Label",
    });
    setArrowToolbar(null);
  }

  function handleArrowLabelSubmit() {
    if (!labelInput) return;
    const canvas = fabricRef.current;
    labelInput.arrow.labelText = labelInput.text || null;
    labelInput.arrow.set("dirty", true);
    canvas?.renderAll();
    setLabelInput(null);
  }

  function handleArrowCopy(arrow: any) {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !fabric || !arrow) return;

    const ArrowClass = fabric.classRegistry.getClass("FabricArrow");
    const copy = new ArrowClass({
      x1: arrow.x1 + 30,
      y1: arrow.y1 + 30,
      x2: arrow.x2 + 30,
      y2: arrow.y2 + 30,
      arrowColor: arrow.arrowColor,
      arrowThickness: arrow.arrowThickness,
      labelText: arrow.labelText,
      labelFontSize: arrow.labelFontSize,
    });
    canvas.add(copy);
    canvas.renderAll();
    setArrowToolbar(null);
  }

  function handleArrowDelete(arrow: any) {
    const canvas = fabricRef.current;
    if (!canvas || !arrow) return;
    canvas.remove(arrow);
    canvas.renderAll();
    setArrowToolbar(null);
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

  // ─── Undo & Clear ─────────────────────────────────────────────────────────

  function handleUndo() {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // If actively drawing a polyline, undo the last placed point
    if (polyDrawingRef.current) {
      const pts = polyDrawingRef.current.points;
      if (pts.length > 1) {
        pts.pop();
        canvas.renderAll();
        return;
      } else {
        polyDrawingRef.current = null;
        polyPreviewRef.current = null;
        canvas.renderAll();
        return;
      }
    }

    const objects = canvas.getObjects();
    if (objects.length === 0) return;
    const last = objects[objects.length - 1];
    canvas.remove(last);
    setArrowToolbar(null);
    canvas.renderAll();
  }

  function handleClear() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().slice().forEach((obj: any) => canvas.remove(obj));
    polyDrawingRef.current = null;
    polyPreviewRef.current = null;
    setArrowToolbar(null);
    canvas.renderAll();
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(closeAfter = true) {
    const canvas = fabricRef.current;
    if (!canvas || !currentPhoto) return;

    setSaving(true);
    const supabase = createClient();

    try {
      // Serialize the markup objects (with their FabricArrow custom props) into
      // the stored envelope. serializeAnnotations owns the annotation_data shape
      // and carries markup only — the flattened Annotated Photo is a separate
      // write below (ADR 0024).
      const json = canvas.toJSON([...ANNOTATION_CUSTOM_PROPS]);
      const annotationData = serializeAnnotations(json.objects);

      // Upsert annotation record
      const { data: existing } = await supabase
        .from("photo_annotations")
        .select("id")
        .eq("photo_id", currentPhoto.id)
        .limit(1)
        .single();

      if (existing) {
        await supabase
          .from("photo_annotations")
          .update({ annotation_data: annotationData })
          .eq("id", existing.id);
      } else {
        await supabase.from("photo_annotations").insert({
          organization_id: await getActiveOrganizationId(supabase),
          photo_id: currentPhoto.id,
          annotation_data: annotationData,
          created_by: "Eric",
        });
      }

      // Export the flattened annotated PNG to a UNIQUE path per save: Supabase
      // Storage's CDN keys its cache by path, so re-annotating to the old stable
      // `-annotated.png` served the previous render until the cache aged out. A
      // per-save path is a guaranteed cache miss. After the row points at the new
      // file, best-effort delete the prior one so superseded renders don't pile
      // up in Storage (a failed delete is harmless — it leaves an orphan, never a
      // stale render).
      try {
        canvas.discardActiveObject();
        canvas.renderAll();

        const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        await persistAnnotatedRender(supabase, {
          photoId: currentPhoto.id,
          storagePath: currentPhoto.storage_path,
          previousAnnotatedPath: currentPhoto.annotated_path,
          blob,
          token: Date.now().toString(36),
        });
      } catch {
        console.log("Could not export annotated image. JSON annotations saved.");
      }

      toast.success("Annotations saved.");
      isDirtyRef.current = false;
      onSaved();

      if (closeAfter) {
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Save annotation error:", err);
      toast.error("Failed to save annotations.");
    }

    setSaving(false);
  }

  function handleDiscard() {
    onOpenChange(false);
  }

  // ─── Photo Navigation ─────────────────────────────────────────────────────

  function requestNav(targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= photos.length) return;
    if (isDirtyRef.current) {
      setNavPrompt(targetIndex);
    } else {
      setCurrentIndex(targetIndex);
    }
  }

  async function handleNavSave() {
    if (navPrompt === null) return;
    const target = navPrompt;
    setNavPrompt(null);
    await handleSave(false);
    setCurrentIndex(target);
  }

  function handleNavDiscard() {
    if (navPrompt === null) return;
    const target = navPrompt;
    setNavPrompt(null);
    isDirtyRef.current = false;
    setCurrentIndex(target);
  }

  // ─── Keyboard Navigation ──────────────────────────────────────────────────

  useEffect(() => {
    if (!open || !canvasReady) return;

    function onKeyDown(e: KeyboardEvent) {
      // Don't navigate when editing text
      const active = fabricRef.current?.getActiveObject();
      if (active?.isEditing) return;

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
        {COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => setActiveColor(color.value)}
            title={color.label}
            className={cn(
              "w-6 h-6 rounded-full border-2 transition-all",
              activeColor === color.value
                ? "border-white scale-125"
                : "border-[#555] hover:border-[#888]"
            )}
            style={{ backgroundColor: color.value }}
          />
        ))}

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Line Thickness */}
        {THICKNESSES.map((t) => (
          <button
            key={t.value}
            onClick={() => setActiveThickness(t.value)}
            title={t.label}
            className={cn(
              "w-10 h-8 rounded-lg flex items-center justify-center transition-all",
              activeThickness === t.value
                ? "border border-white scale-110"
                : "border border-transparent hover:border-[#555]"
            )}
          >
            <div
              className="rounded-full"
              style={{
                width: 20,
                height: t.value,
                backgroundColor: activeColor,
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

        {/* Undo / Clear */}
        <button
          onClick={handleUndo}
          title="Undo"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#999] hover:text-white hover:bg-[#333] transition-colors"
        >
          <Undo2 size={18} />
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

        {/* Arrow action toolbar */}
        {arrowToolbar && (
          <div
            className="absolute z-20 flex items-center gap-0.5 bg-[#333] rounded-lg shadow-xl p-1"
            style={{
              left: arrowToolbar.x,
              top: Math.max(8, arrowToolbar.y - 52),
              transform: "translateX(-50%)",
            }}
          >
            <button
              onClick={() => handleArrowAddText(arrowToolbar.arrow)}
              title={arrowToolbar.arrow?.labelText ? "Edit Label" : "Add Text"}
              className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#555] transition-colors"
            >
              <Type size={18} />
            </button>
            <button
              onClick={() => handleArrowCopy(arrowToolbar.arrow)}
              title="Duplicate"
              className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#555] transition-colors"
            >
              <Copy size={18} />
            </button>
            <button
              onClick={() => handleArrowDelete(arrowToolbar.arrow)}
              title="Delete"
              className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#C41E2A] transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}

        {/* Arrow label input */}
        {labelInput && (
          <div
            className="absolute z-30 bg-[#333] rounded-lg shadow-xl p-2 flex items-center gap-2"
            style={{
              left: ((labelInput.arrow.x1 + labelInput.arrow.x2) / 2) - 28,
              top: Math.min(labelInput.arrow.y1, labelInput.arrow.y2) - 80,
            }}
          >
            <input
              autoFocus
              value={labelInput.text}
              onChange={(e) =>
                setLabelInput({ ...labelInput, text: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleArrowLabelSubmit();
                if (e.key === "Escape") setLabelInput(null);
              }}
              className="bg-[#222] text-white text-sm px-2 py-1 rounded border border-[#555] outline-none focus:border-[#2B5EA7] w-32"
              placeholder="Label text..."
            />
            <button
              onClick={handleArrowLabelSubmit}
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
        )}

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

        {/* Unsaved changes prompt */}
        {navPrompt !== null && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
            <div className="bg-white rounded-xl p-5 shadow-2xl max-w-sm">
              <p className="text-sm text-gray-700 mb-4">
                You have unsaved changes. Save before switching photos?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleNavSave}
                  className="px-4 py-2 bg-[#0F6E56] text-white text-sm font-medium rounded-lg hover:bg-[#0a5a46] transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={handleNavDiscard}
                  className="px-4 py-2 bg-[#C41E2A] text-white text-sm font-medium rounded-lg hover:bg-[#A3171F] transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={() => setNavPrompt(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {!canvasReady && (
            <div className="flex items-center gap-2">
              <Loader2 size={24} className="animate-spin text-[#999]" />
              <span className="text-sm text-[#999]">Loading editor...</span>
            </div>
          )}
          <div className={cn(!canvasReady && "hidden")}>
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* Save / Discard - top right */}
        <div className="absolute top-3 right-4 flex items-center gap-2">
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            title="Save & Close"
            className="w-10 h-10 rounded-full bg-[#0F6E56] hover:bg-[#0a5a46] text-white flex items-center justify-center transition-colors disabled:opacity-50 shadow-lg"
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Check size={20} />
            )}
          </button>
          <button
            onClick={handleDiscard}
            title="Discard & Close"
            className="w-10 h-10 rounded-full bg-[#C41E2A] hover:bg-[#A3171F] text-white flex items-center justify-center transition-colors shadow-lg"
          >
            <X size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

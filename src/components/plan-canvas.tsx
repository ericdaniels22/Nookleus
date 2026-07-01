"use client";

import { useEffect, useRef } from "react";

import type { Room } from "@/lib/types";
import { type Point, translateFootprint } from "@/lib/sketch/footprint";
import { snapWall, shouldClosePolygon } from "@/lib/sketch/footprint-draw";

// Issue #890 — the MagicPlan-style multi-room plan canvas (ADR 0026). This is the
// editor's Fabric glue: it renders every placed Room on a light dotted grid with
// thick black centerline walls, a centered name + area label, and always-on
// per-wall dimension labels; supports panning (drag empty space) and zoom (wheel
// or the shell's control); lets the user click a Room to select it and drag it to
// move (a move updates only the Room's origin — the footprint and its cached
// measurements are position-invariant); and, in "adding" mode, draws a new
// footprint corner-by-corner (reusing the pure snapWall / shouldClosePolygon core
// from #879) then emits it. The imperative Fabric wiring is verified visually, not
// in unit tests; the shell that owns state (PlanEditor) mocks this component.
//
// Fabric is loaded with a dynamic `await import("fabric")` inside the effect so it
// never evaluates during SSR (this Fabric touches the DOM on module eval). The
// canvas is imperative, so live state lives in refs; React only feeds it props.

const PX_PER_FT = 24; // scene scale: one foot is 24 device px at 100% zoom
const CLOSE_THRESHOLD_FT = 1.2; // tap within this of the first corner closes the loop
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
// The dotted grid is a bounded region — generous enough for a whole house, and
// panning past it just reveals blank canvas (fit-to-content is deferred, #890).
const GRID_MIN_FT = -40;
const GRID_MAX_FT = 260;
// The floor origin (0,0) is parked this many px in from the top-left on first
// paint so a fresh plan drawn outward from 0,0 sits comfortably in view.
const INITIAL_PAN_PX = 80;

const WALL_STROKE = "#111827"; // thick black centerline walls
const WALL_STROKE_SELECTED = "#2563eb"; // the selected Room's walls, accented
const WALL_WIDTH = 7;
const GRID_DOT = "#cbd5e1";
const LABEL_FILL = "#1f2937";
const DIM_FILL = "#475569";

export interface PlanCanvasProps {
  /** Every Room placed on the active Floor, drawn at its origin (ADR 0026). */
  rooms: Room[];
  /** The selected Room, highlighted and echoed to the inspector. */
  selectedRoomId: string | null;
  /** "adding" → the next completed footprint places a new Room. */
  mode: "idle" | "adding";
  /** Zoom as a percentage (100 = 1:1). */
  zoom: number;
  /** Click a Room (or empty space → null) to change the selection. */
  onSelectRoom: (roomId: string | null) => void;
  /** Drag a Room to a new position — reports the new origin on drop. */
  onMoveRoom: (roomId: string, origin: Point) => void;
  /** A newly-drawn footprint's closed loop of corners, in floor coordinates. */
  onFootprintComplete: (footprint: Point[]) => void;
  /** Wheel zoom reports the new percentage so the shell's control stays in sync. */
  onZoomChange?: (zoom: number) => void;
}

/** One decimal, trailing zero trimmed: 12 → "12", 12.5 → "12.5". */
function ft(value: number): string {
  return Number(value.toFixed(1)).toString();
}

/** The axis-aligned centre of a footprint (floor space), for the Room label. */
function centroid(points: Point[]): Point {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export default function PlanCanvas({
  rooms,
  selectedRoomId,
  mode,
  zoom,
  onSelectRoom,
  onMoveRoom,
  onFootprintComplete,
  onZoomChange,
}: PlanCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  // Fabric module + Canvas instance, set once the dynamic import resolves.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canvasRef = useRef<any>(null);
  // Placed-Room groups by id, so a selection recolor or a rooms rebuild can find
  // and replace them without disturbing the grid or the draft overlay.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomGroupsRef = useRef<Map<string, any>>(new Map());
  // The in-progress footprint (feet) while "adding", plus its Fabric overlay.
  const draftRef = useRef<Point[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draftOverlayRef = useRef<any[]>([]);
  // Pan bookkeeping — a drag on empty space pans; a small drag is a deselect click.
  const panRef = useRef<{ panning: boolean; x: number; y: number; moved: boolean }>({
    panning: false,
    x: 0,
    y: 0,
    moved: false,
  });
  // Suppress selection side-effects while we rebuild groups programmatically.
  const syncingRef = useRef(false);
  // The last zoom we applied, so the zoom effect skips a value wheel just set.
  const appliedZoomRef = useRef(100);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Latest props read by the once-built Fabric handlers.
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const selectedRef = useRef(selectedRoomId);
  selectedRef.current = selectedRoomId;
  const onSelectRef = useRef(onSelectRoom);
  onSelectRef.current = onSelectRoom;
  const onMoveRef = useRef(onMoveRoom);
  onMoveRef.current = onMoveRoom;
  const onCompleteRef = useRef(onFootprintComplete);
  onCompleteRef.current = onFootprintComplete;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const ftToPx = (p: Point) => ({ x: p.x * PX_PER_FT, y: p.y * PX_PER_FT });

  // Build the Fabric Group for one Room: its thick centerline walls, a centered
  // name + area label, and a length label at every wall midpoint. Children live in
  // floor-space px (footprint shifted by origin); the group moves as a unit.
  function buildRoomGroup(room: Room, selected: boolean) {
    const fabric = fabricRef.current;
    const placed = translateFootprint(room.footprint, room.origin);
    const pts = placed.map(ftToPx);

    const wall = new fabric.Polygon(pts, {
      fill: "rgba(17,24,39,0.03)",
      stroke: selected ? WALL_STROKE_SELECTED : WALL_STROKE,
      strokeWidth: WALL_WIDTH,
      strokeLineJoin: "round",
      objectCaching: false,
      selectable: false,
      evented: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [wall];

    const c = ftToPx(centroid(placed));
    const label = new fabric.Text(`${room.name}\n${ft(room.floor_area)} sq ft`, {
      left: c.x,
      top: c.y,
      fontSize: 14,
      fontFamily: "sans-serif",
      fontWeight: "600",
      fill: LABEL_FILL,
      textAlign: "center",
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });
    parts.push(label);

    // Always-on per-wall dimension labels at each edge midpoint.
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      const b = placed[(i + 1) % placed.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.05) continue;
      const mid = ftToPx({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      parts.push(
        new fabric.Text(`${ft(len)}'`, {
          left: mid.x,
          top: mid.y,
          fontSize: 12,
          fontFamily: "sans-serif",
          fill: DIM_FILL,
          backgroundColor: "rgba(248,250,252,0.85)",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        }),
      );
    }

    const group = new fabric.Group(parts, {
      subTargetCheck: false,
      hasControls: false,
      hasBorders: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      hoverCursor: "move",
      selectable: modeRef.current === "idle",
      evented: modeRef.current === "idle",
    });
    // Stash what a drag needs: the Room id, its current origin, and the group's
    // Fabric-assigned position, so a move is read as a pure left/top delta.
    group.roomId = room.id;
    group.originFt = room.origin;
    group.baseLeft = group.left;
    group.baseTop = group.top;
    group.wall = wall;
    return group;
  }

  // Rebuild every Room group from the current rooms prop. Guarded so removing an
  // active group during teardown doesn't fire a spurious deselect.
  function redrawRooms() {
    const canvas = canvasRef.current;
    if (!canvas || !fabricRef.current) return;
    syncingRef.current = true;
    for (const group of roomGroupsRef.current.values()) canvas.remove(group);
    roomGroupsRef.current.clear();
    for (const room of roomsRef.current) {
      const group = buildRoomGroup(room, room.id === selectedRef.current);
      roomGroupsRef.current.set(room.id, group);
      canvas.add(group);
    }
    canvas.requestRenderAll();
    syncingRef.current = false;
  }

  // Recolor walls to reflect the current selection without a full rebuild.
  function applySelectionHighlight() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const [id, group] of roomGroupsRef.current) {
      group.wall.set(
        "stroke",
        id === selectedRef.current ? WALL_STROKE_SELECTED : WALL_STROKE,
      );
      group.dirty = true;
    }
    canvas.requestRenderAll();
  }

  // Repaint the in-progress "adding" footprint: the open wall chain, its length
  // labels, and the corner dots (first corner highlighted as the close target).
  function redrawDraft() {
    const fabric = fabricRef.current;
    const canvas = canvasRef.current;
    if (!fabric || !canvas) return;
    for (const obj of draftOverlayRef.current) canvas.remove(obj);
    draftOverlayRef.current = [];

    const corners = draftRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const add = (obj: any) => {
      draftOverlayRef.current.push(obj);
      canvas.add(obj);
    };

    for (let i = 0; i < corners.length - 1; i++) {
      const a = ftToPx(corners[i]);
      const b = ftToPx(corners[i + 1]);
      add(
        new fabric.Line([a.x, a.y, b.x, b.y], {
          stroke: WALL_STROKE,
          strokeWidth: WALL_WIDTH,
          strokeLineCap: "round",
          selectable: false,
          evented: false,
        }),
      );
      const len = Math.hypot(
        corners[i + 1].x - corners[i].x,
        corners[i + 1].y - corners[i].y,
      );
      add(
        new fabric.Text(`${ft(len)}'`, {
          left: (a.x + b.x) / 2,
          top: (a.y + b.y) / 2,
          fontSize: 12,
          fill: DIM_FILL,
          backgroundColor: "rgba(248,250,252,0.85)",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        }),
      );
    }
    corners.forEach((c, i) => {
      const p = ftToPx(c);
      add(
        new fabric.Circle({
          left: p.x,
          top: p.y,
          radius: i === 0 ? 6 : 4,
          fill: i === 0 ? "#f59e0b" : "#2563eb",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        }),
      );
    });
    canvas.requestRenderAll();
  }

  function clearDraft() {
    const canvas = canvasRef.current;
    for (const obj of draftOverlayRef.current) canvas?.remove(obj);
    draftOverlayRef.current = [];
    draftRef.current = [];
  }

  useEffect(() => {
    let disposed = false;

    (async () => {
      const fabric = await import("fabric");
      if (disposed || !canvasElRef.current || !wrapperRef.current) return;

      if (canvasRef.current) {
        canvasRef.current.dispose();
        canvasRef.current = null;
      }

      fabricRef.current = fabric;
      const { clientWidth, clientHeight } = wrapperRef.current;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: clientWidth || 800,
        height: clientHeight || 600,
        backgroundColor: "#f8fafc",
        selection: false,
        preserveObjectStacking: true,
      });
      canvasRef.current = canvas;

      // The static dotted foot grid, drawn once behind everything. Dashed light
      // lines read as a dotted grid and pan/zoom with the content.
      for (let fx = GRID_MIN_FT; fx <= GRID_MAX_FT; fx++) {
        canvas.add(
          new fabric.Line(
            [fx * PX_PER_FT, GRID_MIN_FT * PX_PER_FT, fx * PX_PER_FT, GRID_MAX_FT * PX_PER_FT],
            {
              stroke: GRID_DOT,
              strokeWidth: 1,
              strokeDashArray: [1, 5],
              selectable: false,
              evented: false,
            },
          ),
        );
      }
      for (let fy = GRID_MIN_FT; fy <= GRID_MAX_FT; fy++) {
        canvas.add(
          new fabric.Line(
            [GRID_MIN_FT * PX_PER_FT, fy * PX_PER_FT, GRID_MAX_FT * PX_PER_FT, fy * PX_PER_FT],
            {
              stroke: GRID_DOT,
              strokeWidth: 1,
              strokeDashArray: [1, 5],
              selectable: false,
              evented: false,
            },
          ),
        );
      }

      // Park the floor origin a little in from the corner and apply the start zoom.
      canvas.setViewportTransform([1, 0, 0, 1, INITIAL_PAN_PX, INITIAL_PAN_PX]);
      appliedZoomRef.current = zoom;
      canvas.zoomToPoint(new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), zoom / 100);

      redrawRooms();

      // Selection → tell the shell which Room (if any) is active. Guarded so a
      // rebuild's teardown doesn't masquerade as a user deselect.
      const reportSelection = () => {
        if (syncingRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const active = canvas.getActiveObject() as any;
        onSelectRef.current(active?.roomId ?? null);
      };
      canvas.on("selection:created", reportSelection);
      canvas.on("selection:updated", reportSelection);
      canvas.on("selection:cleared", () => {
        if (syncingRef.current) return;
        onSelectRef.current(null);
      });

      // A finished drag reports the Room's new origin as a pure left/top delta.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("object:modified", (opt: any) => {
        const g = opt.target;
        if (!g || g.roomId == null) return;
        const dxFt = (g.left - g.baseLeft) / PX_PER_FT;
        const dyFt = (g.top - g.baseTop) / PX_PER_FT;
        onMoveRef.current(g.roomId, {
          x: g.originFt.x + dxFt,
          y: g.originFt.y + dyFt,
        });
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("mouse:down", (opt: any) => {
        // Drawing a new Room: place corners, close on the first-corner tap.
        if (modeRef.current === "adding") {
          const sp = canvas.getScenePoint(opt.e);
          const rawFt = { x: sp.x / PX_PER_FT, y: sp.y / PX_PER_FT };
          const corners = draftRef.current;
          if (corners.length === 0) {
            draftRef.current = [{ x: Math.round(rawFt.x), y: Math.round(rawFt.y) }];
          } else {
            const prev = corners[corners.length - 1];
            const candidate = snapWall(prev, rawFt);
            if (shouldClosePolygon(corners, candidate, CLOSE_THRESHOLD_FT)) {
              const finished = corners;
              clearDraft();
              onCompleteRef.current(finished);
              return;
            }
            if (candidate.x !== prev.x || candidate.y !== prev.y) {
              draftRef.current = [...corners, candidate];
            }
          }
          redrawDraft();
          return;
        }

        // Idle: a drag on empty space pans; a Room target is left to Fabric to move.
        if (!opt.target) {
          const p = canvas.getViewportPoint(opt.e);
          panRef.current = { panning: true, x: p.x, y: p.y, moved: false };
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("mouse:move", (opt: any) => {
        const pan = panRef.current;
        if (!pan.panning) return;
        const p = canvas.getViewportPoint(opt.e);
        const dx = p.x - pan.x;
        const dy = p.y - pan.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
        canvas.relativePan(new fabric.Point(dx, dy));
        pan.x = p.x;
        pan.y = p.y;
      });

      canvas.on("mouse:up", () => {
        const pan = panRef.current;
        // A click on empty space (no drag) clears the selection.
        if (pan.panning && !pan.moved && modeRef.current === "idle") {
          canvas.discardActiveObject();
          onSelectRef.current(null);
          canvas.requestRenderAll();
        }
        pan.panning = false;
      });

      // Wheel zoom around the pointer; the shell's control mirrors the new value.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("mouse:wheel", (opt: any) => {
        const delta = opt.e.deltaY;
        let z = canvas.getZoom() * 100 * 0.999 ** delta;
        z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
        canvas.zoomToPoint(canvas.getScenePoint(opt.e), z / 100);
        appliedZoomRef.current = Math.round(z);
        onZoomChangeRef.current?.(Math.round(z));
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });

      // Keep the drawing surface sized to its container.
      const resize = () => {
        const el = wrapperRef.current;
        if (!el || !canvasRef.current) return;
        canvasRef.current.setDimensions({
          width: el.clientWidth,
          height: el.clientHeight,
        });
        canvasRef.current.requestRenderAll();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(wrapperRef.current);
      resizeObserverRef.current = observer;
    })();

    // Capture the ref-held collections for the cleanup (they persist for the
    // component's life, but the linter wants a stable local).
    const roomGroups = roomGroupsRef.current;
    return () => {
      disposed = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (canvasRef.current) {
        canvasRef.current.dispose();
        canvasRef.current = null;
      }
      roomGroups.clear();
      draftOverlayRef.current = [];
    };
    // Built once; live values are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render the Room groups whenever the plan changes.
  useEffect(() => {
    redrawRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  // Reflect a selection change as a wall-colour highlight (no full rebuild).
  useEffect(() => {
    applySelectionHighlight();
  }, [selectedRoomId]);

  // Apply the shell's zoom, unless a wheel event already set this exact value.
  useEffect(() => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!canvas || !fabric) return;
    if (appliedZoomRef.current === zoom) return;
    appliedZoomRef.current = zoom;
    canvas.zoomToPoint(
      new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2),
      zoom / 100,
    );
  }, [zoom]);

  // Toggle Room interactivity with the mode: while "adding", Rooms are inert so
  // taps place corners; leaving "adding" abandons any half-drawn footprint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const idle = mode === "idle";
    for (const group of roomGroupsRef.current.values()) {
      group.selectable = idle;
      group.evented = idle;
    }
    if (idle) {
      clearDraft();
    } else {
      canvas.discardActiveObject();
    }
    canvas.requestRenderAll();
  }, [mode]);

  return (
    <div ref={wrapperRef} className="absolute inset-0">
      <canvas ref={canvasElRef} className="touch-none" />
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

import type { Room } from "@/lib/types";
import { type Point, translateFootprint } from "@/lib/sketch/footprint";
import {
  mergeCollinear,
  snapWall,
  shouldClosePolygon,
} from "@/lib/sketch/footprint-draw";
import { deleteVertex, moveVertex } from "@/lib/sketch/footprint-edit";

// Issue #890 / #862 — the MagicPlan-style multi-room plan canvas (ADR 0026). This
// is the editor's Fabric glue: it renders every placed Room on a light dotted grid
// with thick black centerline walls, a centered name + area label, and always-on
// per-wall dimension labels; supports panning (drag empty space) and zoom (wheel
// or the shell's control); lets the user click a Room to select it and drag it to
// move (a move updates only the Room's origin — the footprint and its cached
// measurements are position-invariant).
//
// The #862 Apple-Pencil interaction model (documented here and in the PR):
//
//   • Drawing ("adding" mode) — DRAG to draw. Press the Pencil at a corner and
//     drag: the wall rubber-bands from the last corner to the pen with live
//     right-angle + clean-foot snapping (snapWall), its length shown; lift to drop
//     that corner. Repeat corner-to-corner; lift near the first corner (≥3 corners
//     placed) to close the loop (shouldClosePolygon). A plain tap still drops a
//     corner, so the #879 tap-to-place model keeps working — a drag is just a tap
//     whose lift landed somewhere new.
//   • Editing a selected Room's vertices — every corner carries a round drag
//     handle. Drag a handle to move that corner (moveVertex) with a live shape
//     preview; on drop the reworked footprint is straightened (mergeCollinear, so
//     a corner dragged flat onto its wall folds away) and emitted. Double-tap a
//     handle to delete that corner (deleteVertex), unless only a triangle remains.
//   • Editing walls (exact length) and deleting walls live in the inspector, not
//     the canvas (they need a typed number / a discrete control).
//
// Every reshape emits the footprint in PLACED floor coordinates via onEditFootprint;
// the shell PATCHes it and the server re-normalizes + recomputes the cache (M1), so
// measurements refresh on each committed edit. All the geometry is the pure, tested
// core (footprint-draw / footprint-edit); the imperative Fabric wiring here is
// verified visually, not in unit tests — the shell that owns state (PlanEditor)
// mocks this component.
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
  /** Reshape a Room — a vertex dragged or a corner deleted on the canvas (#862)
   * — reporting its reworked footprint in PLACED floor coordinates. */
  onEditFootprint: (roomId: string, placedFootprint: Point[]) => void;
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
  onEditFootprint,
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
  // Pen state while drawing: true between press and lift so mouse:move rubber-bands
  // the prospective wall and mouse:up commits (or closes) it. The rubber-band
  // overlay (line + length + ghost corner) lives in its own Fabric layer.
  const penRef = useRef<{ drawing: boolean }>({ drawing: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rubberBandRef = useRef<any[]>([]);
  // Draggable corner handles for the selected Room, and — while one is being
  // dragged — the live reshaped footprint (placed feet) plus its preview overlay.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vertexHandlesRef = useRef<any[]>([]);
  const draggingVertexRef = useRef<{ roomId: string; footprint: Point[] } | null>(
    null,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editPreviewRef = useRef<any[]>([]);
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
  const onEditFootprintRef = useRef(onEditFootprint);
  onEditFootprintRef.current = onEditFootprint;
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
    // The selected Room's corner handles ride on top of the fresh groups.
    redrawVertexHandles();
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
    clearRubberBand();
  }

  // The prospective next wall while the pen is down: the snapped segment from the
  // last committed corner to the pen, its length, and a ghost corner at the tip.
  function redrawRubberBand(from: Point, to: Point) {
    const fabric = fabricRef.current;
    const canvas = canvasRef.current;
    if (!fabric || !canvas) return;
    clearRubberBand();
    const a = ftToPx(from);
    const b = ftToPx(to);
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const add = (obj: any) => {
      rubberBandRef.current.push(obj);
      canvas.add(obj);
    };
    if (len >= 0.05) {
      add(
        new fabric.Line([a.x, a.y, b.x, b.y], {
          stroke: WALL_STROKE_SELECTED,
          strokeWidth: WALL_WIDTH,
          strokeLineCap: "round",
          strokeDashArray: [4, 6],
          selectable: false,
          evented: false,
        }),
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
    add(
      new fabric.Circle({
        left: b.x,
        top: b.y,
        radius: 4,
        fill: "#2563eb",
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
      }),
    );
    canvas.requestRenderAll();
  }

  function clearRubberBand() {
    const canvas = canvasRef.current;
    for (const obj of rubberBandRef.current) canvas?.remove(obj);
    rubberBandRef.current = [];
  }

  // Draggable corner handles for the selected Room (idle mode only). Removal is
  // wrapped in the sync guard so discarding an active handle mid-rebuild doesn't
  // masquerade as a user deselect (selection:cleared is ignored while syncing).
  function redrawVertexHandles() {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!canvas || !fabric) return;
    syncingRef.current = true;
    for (const h of vertexHandlesRef.current) canvas.remove(h);
    vertexHandlesRef.current = [];
    syncingRef.current = false;

    if (modeRef.current !== "idle") return;
    const id = selectedRef.current;
    if (!id) return;
    const room = roomsRef.current.find((r) => r.id === id);
    if (!room) return;

    const placed = translateFootprint(room.footprint, room.origin);
    placed.forEach((corner, i) => {
      const p = ftToPx(corner);
      const handle = new fabric.Circle({
        left: p.x,
        top: p.y,
        radius: 7,
        fill: "#ffffff",
        stroke: WALL_STROKE_SELECTED,
        strokeWidth: 2,
        originX: "center",
        originY: "center",
        hasControls: false,
        hasBorders: false,
        hoverCursor: "grab",
        selectable: true,
        evented: true,
      });
      handle.roomId = room.id;
      handle.cornerIndex = i;
      vertexHandlesRef.current.push(handle);
      canvas.add(handle);
    });
    canvas.requestRenderAll();
  }

  // While a corner handle is being dragged, hide the selected Room's group and
  // draw a lightweight preview of the reshaped footprint (walls + length labels)
  // so the shape follows the pen; committed on drop, cleared on release.
  function showEditPreview(roomId: string, placed: Point[]) {
    const fabric = fabricRef.current;
    const canvas = canvasRef.current;
    if (!fabric || !canvas) return;
    const group = roomGroupsRef.current.get(roomId);
    if (group) group.visible = false;

    for (const obj of editPreviewRef.current) canvas.remove(obj);
    editPreviewRef.current = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const add = (obj: any) => {
      editPreviewRef.current.push(obj);
      canvas.add(obj);
    };
    for (let i = 0; i < placed.length; i++) {
      const a = ftToPx(placed[i]);
      const b = ftToPx(placed[(i + 1) % placed.length]);
      add(
        new fabric.Line([a.x, a.y, b.x, b.y], {
          stroke: WALL_STROKE_SELECTED,
          strokeWidth: WALL_WIDTH,
          strokeLineJoin: "round",
          strokeLineCap: "round",
          selectable: false,
          evented: false,
        }),
      );
      const len = Math.hypot(
        placed[(i + 1) % placed.length].x - placed[i].x,
        placed[(i + 1) % placed.length].y - placed[i].y,
      );
      if (len < 0.05) continue;
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
    // Keep the dragged handle on top of the fresh preview lines.
    for (const h of vertexHandlesRef.current) canvas.bringObjectToFront(h);
    canvas.requestRenderAll();
  }

  function clearEditPreview() {
    const canvas = canvasRef.current;
    for (const obj of editPreviewRef.current) canvas?.remove(obj);
    editPreviewRef.current = [];
    for (const group of roomGroupsRef.current.values()) group.visible = true;
    canvas?.requestRenderAll();
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

      // Dragging a corner handle: live-preview the reshaped footprint under the
      // pen (moveVertex on the Room's placed corners), stashing it to commit on
      // drop.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("object:moving", (opt: any) => {
        const h = opt.target;
        if (!h || h.cornerIndex == null) return;
        const room = roomsRef.current.find((r) => r.id === h.roomId);
        if (!room) return;
        const placed = translateFootprint(room.footprint, room.origin);
        const feet = { x: h.left / PX_PER_FT, y: h.top / PX_PER_FT };
        const live = moveVertex(placed, h.cornerIndex, feet);
        draggingVertexRef.current = { roomId: h.roomId, footprint: live };
        showEditPreview(h.roomId, live);
      });

      // A finished drag: a corner handle drop reshapes the Room (straightened by
      // mergeCollinear so a corner dragged flat folds away); a Room group drop
      // reports the new origin as a pure left/top delta.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("object:modified", (opt: any) => {
        const g = opt.target;
        if (!g) return;
        if (g.cornerIndex != null) {
          const live = draggingVertexRef.current;
          draggingVertexRef.current = null;
          clearEditPreview();
          if (live) {
            onEditFootprintRef.current(live.roomId, mergeCollinear(live.footprint));
          }
          return;
        }
        if (g.roomId == null) return;
        const dxFt = (g.left - g.baseLeft) / PX_PER_FT;
        const dyFt = (g.top - g.baseTop) / PX_PER_FT;
        onMoveRef.current(g.roomId, {
          x: g.originFt.x + dxFt,
          y: g.originFt.y + dyFt,
        });
      });

      // Double-tap a corner handle to delete that corner (deleteVertex), unless
      // only a triangle remains — the smallest real Room.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("mouse:dblclick", (opt: any) => {
        const h = opt.target;
        if (!h || h.cornerIndex == null) return;
        const room = roomsRef.current.find((r) => r.id === h.roomId);
        if (!room) return;
        const placed = translateFootprint(room.footprint, room.origin);
        if (placed.length <= 3) return;
        onEditFootprintRef.current(
          h.roomId,
          mergeCollinear(deleteVertex(placed, h.cornerIndex)),
        );
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("mouse:down", (opt: any) => {
        // Drawing a new Room: press anchors the stroke. The first press drops the
        // starting corner; the pen is now "down" so a drag rubber-bands the next
        // wall and the lift (mouse:up) commits it — a plain tap is just a lift
        // that landed on a new spot.
        if (modeRef.current === "adding") {
          if (draftRef.current.length === 0) {
            const sp = canvas.getScenePoint(opt.e);
            const rawFt = { x: sp.x / PX_PER_FT, y: sp.y / PX_PER_FT };
            draftRef.current = [{ x: Math.round(rawFt.x), y: Math.round(rawFt.y) }];
            redrawDraft();
          }
          penRef.current.drawing = true;
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
        // While drawing with the pen down, rubber-band the prospective next wall
        // from the last corner to the pen, snapped square + to whole feet.
        if (modeRef.current === "adding") {
          if (!penRef.current.drawing) return;
          const corners = draftRef.current;
          if (corners.length === 0) return;
          const sp = canvas.getScenePoint(opt.e);
          const rawFt = { x: sp.x / PX_PER_FT, y: sp.y / PX_PER_FT };
          const prev = corners[corners.length - 1];
          redrawRubberBand(prev, snapWall(prev, rawFt));
          return;
        }

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("mouse:up", (opt: any) => {
        // Lifting the pen commits (or closes on) the rubber-banded wall.
        if (modeRef.current === "adding" && penRef.current.drawing) {
          penRef.current.drawing = false;
          clearRubberBand();
          const corners = draftRef.current;
          if (corners.length === 0) return;
          const sp = canvas.getScenePoint(opt.e);
          const rawFt = { x: sp.x / PX_PER_FT, y: sp.y / PX_PER_FT };
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
            redrawDraft();
          }
          return;
        }

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
      rubberBandRef.current = [];
      vertexHandlesRef.current = [];
      editPreviewRef.current = [];
    };
    // Built once; live values are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render the Room groups whenever the plan changes.
  useEffect(() => {
    redrawRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  // Reflect a selection change as a wall-colour highlight (no full rebuild), and
  // move the corner drag handles onto the newly-selected Room (#862).
  useEffect(() => {
    applySelectionHighlight();
    redrawVertexHandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      penRef.current.drawing = false;
    }
    // Corner handles belong to idle editing only — hidden while adding.
    redrawVertexHandles();
    canvas.requestRenderAll();
    // Live values are read through refs; helpers are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div ref={wrapperRef} className="absolute inset-0">
      <canvas ref={canvasElRef} className="touch-none" />
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

import { type Point } from "@/lib/sketch/footprint";
import { snapWall, shouldClosePolygon } from "@/lib/sketch/footprint-draw";

// Issue #879 — Sketch S2, the tap-to-place footprint drawing surface.
//
// The MagicPlan-style canvas: tap corner-to-corner on a scaled grid (1 ft per
// grid square), each new wall snapping to a right angle and a clean foot, and a
// tap back near the first corner closing the loop. This is the THIN Fabric layer
// — all of the geometry it relies on is the pure, unit-tested core
// (footprint-draw.ts: snapWall + shouldClosePolygon; footprint.ts: the area /
// perimeter formulas, exercised through the live measurements). So this file
// itself is left untested and is mocked in the builder's tests, exactly like the
// photo annotator's Fabric glue. Per-wall exact-length editing and corner
// dragging are deferred to S3.
//
// Fabric is loaded with a dynamic `await import("fabric")` inside the effect so it
// never evaluates during SSR (this version of Fabric touches the DOM on module
// eval). Drawing state lives in refs, not React state, because Fabric owns the
// canvas imperatively; the only thing React cares about is the emitted footprint.

const PX_PER_FT = 24; // grid scale: one foot is 24 device px
const CANVAS_W = 600;
const CANVAS_H = 420;
// A tap within this many feet of the first corner closes the loop rather than
// dropping another corner — generous enough for a fingertip on a touch screen.
const CLOSE_THRESHOLD_FT = 1.2;

interface FootprintCanvasProps {
  /** Emits the drawn footprint (feet) after every corner placed, cleared, or undone. */
  onFootprintChange: (points: Point[]) => void;
}

export default function FootprintCanvas({
  onFootprintChange,
}: FootprintCanvasProps) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  // Fabric module + Canvas instance, set once the dynamic import resolves.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canvasRef = useRef<any>(null);
  // The placed corners (feet) and whether the loop has been closed.
  const cornersRef = useRef<Point[]>([]);
  const completeRef = useRef(false);
  // Fabric objects making up the current footprint overlay (walls, dots, labels),
  // tracked so a redraw can clear the previous frame without disturbing the grid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlayRef = useRef<any[]>([]);
  // Keep the latest callback without re-running the (heavy) canvas effect.
  const onChangeRef = useRef(onFootprintChange);
  onChangeRef.current = onFootprintChange;

  const feetToPx = (p: Point) => ({ x: p.x * PX_PER_FT, y: p.y * PX_PER_FT });

  // Repaint the footprint overlay from cornersRef/completeRef. Reads the Fabric
  // refs so the toolbar handlers can call it too; a no-op until the canvas exists.
  function redraw() {
    const fabric = fabricRef.current;
    const canvas = canvasRef.current;
    if (!fabric || !canvas) return;

    for (const obj of overlayRef.current) canvas.remove(obj);
    overlayRef.current = [];

    const corners = cornersRef.current;
    const complete = completeRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const add = (obj: any) => {
      overlayRef.current.push(obj);
      canvas.add(obj);
    };

    // Walls: the open chain between consecutive corners, plus the closing edge
    // (last → first) once the loop is closed. Each carries a midpoint length label.
    const edgeCount = corners.length < 2 ? 0 : complete ? corners.length : corners.length - 1;
    for (let i = 0; i < edgeCount; i++) {
      const a = feetToPx(corners[i]);
      const b = feetToPx(corners[(i + 1) % corners.length]);
      add(
        new fabric.Line([a.x, a.y, b.x, b.y], {
          stroke: "#38bdf8",
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }),
      );
      const lenFt = Math.hypot(
        corners[(i + 1) % corners.length].x - corners[i].x,
        corners[(i + 1) % corners.length].y - corners[i].y,
      );
      add(
        new fabric.Text(`${Math.round(lenFt)}'`, {
          left: (a.x + b.x) / 2 + 4,
          top: (a.y + b.y) / 2 + 4,
          fontSize: 12,
          fill: "#bae6fd",
          selectable: false,
          evented: false,
        }),
      );
    }

    // Corner dots — the first is highlighted so the user knows where to tap to close.
    corners.forEach((c, i) => {
      const p = feetToPx(c);
      add(
        new fabric.Circle({
          left: p.x,
          top: p.y,
          radius: i === 0 ? 6 : 4,
          fill: i === 0 ? "#f59e0b" : "#38bdf8",
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        }),
      );
    });

    canvas.requestRenderAll();
  }

  function emit() {
    onChangeRef.current(cornersRef.current);
  }

  // Toolbar handlers — operate on the corner array, then redraw + emit.
  function handleUndo() {
    if (cornersRef.current.length === 0) return;
    cornersRef.current = cornersRef.current.slice(0, -1);
    completeRef.current = false;
    redraw();
    emit();
  }

  function handleClear() {
    cornersRef.current = [];
    completeRef.current = false;
    redraw();
    emit();
  }

  useEffect(() => {
    let disposed = false;

    (async () => {
      const fabric = await import("fabric");
      if (disposed || !canvasElRef.current) return;

      // Guard the dev/StrictMode double-invoke: dispose any canvas already bound
      // to this element before binding a fresh one.
      if (canvasRef.current) {
        canvasRef.current.dispose();
        canvasRef.current = null;
      }

      fabricRef.current = fabric;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundColor: "#0f172a",
        selection: false,
      });
      canvasRef.current = canvas;

      // The static foot grid, drawn once behind the overlay.
      for (let x = 0; x <= CANVAS_W; x += PX_PER_FT) {
        canvas.add(
          new fabric.Line([x, 0, x, CANVAS_H], {
            stroke: "#1e293b",
            strokeWidth: 1,
            selectable: false,
            evented: false,
          }),
        );
      }
      for (let y = 0; y <= CANVAS_H; y += PX_PER_FT) {
        canvas.add(
          new fabric.Line([0, y, CANVAS_W, y], {
            stroke: "#1e293b",
            strokeWidth: 1,
            selectable: false,
            evented: false,
          }),
        );
      }
      canvas.requestRenderAll();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas.on("mouse:down", (opt: any) => {
        if (completeRef.current) return; // loop already closed; ignore further taps
        const sp = canvas.getScenePoint(opt.e);
        const rawFeet = { x: sp.x / PX_PER_FT, y: sp.y / PX_PER_FT };
        const corners = cornersRef.current;

        if (corners.length === 0) {
          // First corner snaps straight to the nearest foot.
          cornersRef.current = [
            { x: Math.round(rawFeet.x), y: Math.round(rawFeet.y) },
          ];
        } else {
          const prev = corners[corners.length - 1];
          const candidate = snapWall(prev, rawFeet);
          if (shouldClosePolygon(corners, candidate, CLOSE_THRESHOLD_FT)) {
            completeRef.current = true; // close the loop; corners already enclose it
          } else if (candidate.x !== prev.x || candidate.y !== prev.y) {
            // Ignore a zero-length wall (a double tap on the same square).
            cornersRef.current = [...corners, candidate];
          }
        }

        redraw();
        emit();
      });
    })();

    return () => {
      disposed = true;
      if (canvasRef.current) {
        canvasRef.current.dispose();
        canvasRef.current = null;
      }
      overlayRef.current = [];
    };
    // The canvas is built once; the live callback is read through onChangeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasElRef}
        className="touch-none rounded-lg border border-border"
      />
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Tap to place corners; tap the first corner to close the loop.
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleUndo}
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
          >
            Undo corner
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
          >
            Clear
          </button>
        </span>
      </div>
    </div>
  );
}

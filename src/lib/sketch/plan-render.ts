// Issue #868 — Sketch S8, the dimensioned-plan render model for a Photo Report.
//
// ADR 0026 §"On-canvas labels are owned here" makes the Photo-Report plan page a
// *separate render* from the interactive Fabric editor. This pure module turns a
// Floor's placed Rooms into a self-contained, PDF-agnostic plan model so the
// @react-pdf page component stays dumb — it renders exactly the fields handed to
// it, with no geometry or label logic of its own.
//
// The model is expressed entirely in feet: a padded viewBox sized to the Floor's
// envelope, each Room's placed wall polygon (footprint shifted into shared floor
// space, then into the padded box), its name + area label at the footprint
// centre, and a dimension label at every wall's midpoint. It mirrors the editor's
// own label conventions (plan-canvas.tsx): area as "N sq ft", walls as "N'",
// both via one-decimal-trimmed feet.

import { translateFootprint, type Point } from "./footprint";

/** A Room as the plan renderer consumes it — normalized footprint + placement. */
export interface PlanRenderRoom {
  name: string;
  /** Normalized footprint (min corner at 0,0), a closed loop of corners. */
  footprint: Point[];
  /** Where the footprint's min corner sits in shared floor space (ADR 0026). */
  origin: Point;
  /** Cached floor area, shown as the Room's area label. */
  floorArea: number;
}

export interface PlanRenderInput {
  floorName: string;
  rooms: PlanRenderRoom[];
}

/** A single wall's dimension label, positioned at that wall's midpoint. */
export interface WallLabel {
  x: number;
  y: number;
  text: string;
}

/** One Room, fully placed and labelled in the padded plan coordinate space. */
export interface PlanRenderRoomOut {
  /** The placed wall polygon, in padded-viewBox feet. */
  polygon: Point[];
  name: string;
  /** The area label, e.g. "120 sq ft". */
  areaLabel: string;
  /** Where the name + area label sit — the footprint's bounding-box centre. */
  labelAt: Point;
  /** A dimension label at every wall's midpoint, walked corner-to-corner. */
  wallLabels: WallLabel[];
}

export interface PlanRender {
  floorName: string;
  /** The padded plan envelope, as a (0,0)-based box: <Svg viewBox="0 0 W H">. */
  viewBox: { width: number; height: number };
  rooms: PlanRenderRoomOut[];
}

/** A 1 ft margin on every side, so no wall sits flush against the page edge. */
const PLAN_PADDING_FT = 1;

/**
 * Format a length in feet the way the editor does (plan-canvas.tsx): trim to one
 * decimal, then drop a trailing ".0" so whole feet read "12", not "12.0".
 */
function ft(value: number): string {
  return Number(value.toFixed(1)).toString();
}

/**
 * Build a Floor's dimensioned-plan render model from its placed Rooms — the pure
 * heart of the Photo-Report Sketch page (AC2). Rooms with fewer than three
 * corners are still being drawn and have no enclosed shape, so they are skipped.
 */
export function buildSketchPlanRender(input: PlanRenderInput): PlanRender {
  // Place every renderable Room into shared floor space (ADR 0026): a stored
  // footprint is relative to its own min corner, so shift it by its origin.
  const placed = input.rooms
    .filter((room) => room.footprint.length >= 3)
    .map((room) => ({
      room,
      points: translateFootprint(room.footprint, room.origin),
    }));

  // The Floor's envelope across every placed Room. With nothing to draw it
  // collapses to the origin, so the viewBox is just the padding on each side.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { points } of placed) {
    for (const { x, y } of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (placed.length === 0) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  // Shift the whole Floor so its min corner lands at (padding, padding), leaving
  // a uniform margin from the page edge.
  const shift = (p: Point): Point => ({
    x: p.x - minX + PLAN_PADDING_FT,
    y: p.y - minY + PLAN_PADDING_FT,
  });

  const rooms: PlanRenderRoomOut[] = placed.map(({ room, points }) => {
    const polygon = points.map(shift);

    // Label anchor: the centre of the placed footprint's bounding box.
    let pMinX = Infinity;
    let pMinY = Infinity;
    let pMaxX = -Infinity;
    let pMaxY = -Infinity;
    for (const { x, y } of polygon) {
      if (x < pMinX) pMinX = x;
      if (y < pMinY) pMinY = y;
      if (x > pMaxX) pMaxX = x;
      if (y > pMaxY) pMaxY = y;
    }
    const labelAt: Point = {
      x: (pMinX + pMaxX) / 2,
      y: (pMinY + pMaxY) / 2,
    };

    // A dimension label at every wall's midpoint, walking the closed loop so the
    // final edge closes the last corner back to the first.
    const wallLabels: WallLabel[] = polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        text: `${ft(Math.hypot(b.x - a.x, b.y - a.y))}'`,
      };
    });

    return {
      polygon,
      name: room.name,
      areaLabel: `${ft(room.floorArea)} sq ft`,
      labelAt,
      wallLabels,
    };
  });

  return {
    floorName: input.floorName,
    viewBox: {
      width: maxX - minX + PLAN_PADDING_FT * 2,
      height: maxY - minY + PLAN_PADDING_FT * 2,
    },
    rooms,
  };
}

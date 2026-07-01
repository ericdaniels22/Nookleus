// Issue #860 / #879 — M1, the Room measurement calculator.
//
// A pure module: given a Room's footprint and its ceiling height, derive the
// floor/ceiling/wall area, perimeter, and volume an Estimate later pulls from.
// This is the single source of truth for "how big is this space" (CONTEXT.md
// "Room"; ADR 0024 — wall area is perimeter × height, less openings). No
// persistence, no I/O — just geometry — so the rule is unit-testable in one spot
// and reused identically by the API and the builder UI.
//
// S2 (#879) generalized the core from a width × length rectangle to an arbitrary
// polygon footprint (L-rooms, bays): `measureFootprint` is now the engine, and
// the original `measureRoom` is the rectangle case — it builds a 4-point
// footprint and delegates, so every #860 number is preserved exactly.
//
// Wall thickness is a Floor-level default (CONTEXT.md "Floor") but does not enter
// these area formulas: MagicPlan-style interior/exterior thickness affects how
// adjoining rooms snap, not a single room's perimeter × height. Openings (doors,
// windows) do count: their combined width × height area is deducted from gross
// wall area to give net wall area (#866), which is the default wall measurement.

import {
  polygonArea,
  polygonPerimeter,
  rectangleFootprint,
  type Point,
} from "./footprint";

export interface RoomInput {
  /** Footprint width, in the Sketch's linear unit (feet). */
  width: number;
  /** Footprint length, in the Sketch's linear unit (feet). */
  length: number;
  /** Ceiling height — a Floor default, overridable per Room. */
  ceilingHeight: number;
}

/**
 * An opening (door or window) cut into a Room's walls. Only the fields M1 needs
 * to size the hole live here — its `width × height` area is what net wall area
 * deducts (#866; ADR 0024 — wall area is perimeter × height, less openings).
 * Wall placement (which wall, offset along it) is carried on the persisted/wire
 * type for the 2D editor; the pure area math is placement-invariant.
 */
export interface Opening {
  /** What kind of opening this is — drives the door/window counts (#866 M2/M3). */
  type: "door" | "window";
  /** Opening width, in the Sketch's linear unit (feet). */
  width: number;
  /** Opening height, in the Sketch's linear unit (feet). */
  height: number;
}

export interface FootprintInput {
  /** Ordered corner points of the Room's footprint (a closed loop). */
  footprint: Point[];
  /** Ceiling height — a Floor default, overridable per Room. */
  ceilingHeight: number;
  /**
   * Openings (doors, windows) cut into the walls. Their combined area is
   * deducted from gross wall area to give net wall area (#866). Absent or empty
   * → net equals gross.
   */
  openings?: Opening[];
}

export interface RoomMeasurements {
  /** Footprint area (width × length). */
  floorArea: number;
  /** Ceiling area — equal to floor area for a flat ceiling with no openings. */
  ceilingArea: number;
  /** Footprint perimeter (2 × (width + length)). */
  perimeter: number;
  /** Wall area before openings (perimeter × ceiling height). */
  grossWallArea: number;
  /** Wall area after openings (gross − Σ opening areas); the default wall measurement (#866). */
  netWallArea: number;
  /** Enclosed volume (floor area × ceiling height). */
  volume: number;
}

/**
 * Measure an arbitrary polygon footprint — the generalized M1 engine (#879).
 * Floor/ceiling area come from the shoelace formula, perimeter from the
 * closed-loop edge sum, and wall area/volume scale by ceiling height. A
 * footprint of under three points has no enclosed area, so it reads as all
 * zeros (never NaN) while the user is still tapping out corners.
 */
export function measureFootprint({
  footprint,
  ceilingHeight,
  openings,
}: FootprintInput): RoomMeasurements {
  // A negative ceiling height is never a real Room; reject it at the calculator
  // boundary so a negative volume can't flow downstream into an Estimate. The
  // footprint itself needs no sign check — shoelace area is taken absolute.
  if (ceilingHeight < 0) {
    throw new RangeError(
      `measureFootprint: ceiling height must be non-negative (got ${ceilingHeight})`,
    );
  }

  const floorArea = polygonArea(footprint);
  const perimeter = polygonPerimeter(footprint);
  const grossWallArea = perimeter * ceilingHeight;

  // Net wall area is gross less the area every opening cuts out (#866). No
  // openings → the sum is 0 → net equals gross, as before. A negative dimension
  // would subtract as a negative — inflating net above gross — so reject it at
  // the boundary, matching the ceiling-height and rectangle-dimension guards.
  const openingArea = (openings ?? []).reduce((sum, opening) => {
    if (opening.width < 0 || opening.height < 0) {
      throw new RangeError(
        `measureFootprint: opening dimensions must be non-negative (got width=${opening.width}, height=${opening.height})`,
      );
    }
    return sum + opening.width * opening.height;
  }, 0);

  return {
    floorArea,
    ceilingArea: floorArea,
    perimeter,
    grossWallArea,
    netWallArea: grossWallArea - openingArea,
    volume: floorArea * ceilingHeight,
  };
}

/**
 * Measure a rectangular Room (the #860 case). Kept as a thin wrapper so the
 * rectangle path — and its non-negative-dimension guard — stays a named, tested
 * entry point; it builds a 4-point footprint and delegates to the engine.
 */
export function measureRoom({
  width,
  length,
  ceilingHeight,
}: RoomInput): RoomMeasurements {
  // A negative dimension is never a real Room. Reject it at the calculator
  // boundary so a negative area can't flow downstream into an Estimate
  // quantity; a zero dimension is allowed (a half-drawn Room reads as 0).
  if (width < 0 || length < 0 || ceilingHeight < 0) {
    throw new RangeError(
      `measureRoom: dimensions must be non-negative (got width=${width}, length=${length}, ceilingHeight=${ceilingHeight})`,
    );
  }

  return measureFootprint({
    footprint: rectangleFootprint(width, length),
    ceilingHeight,
  });
}

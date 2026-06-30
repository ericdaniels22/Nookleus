// Issue #860 — M1, the Room measurement calculator.
//
// A pure module: given a Room's rectangular footprint (width × length) and its
// ceiling height, derive the floor/ceiling/wall area, perimeter, and volume an
// Estimate later pulls from. This is the single source of truth for "how big is
// this space" (CONTEXT.md "Room"; ADR 0024 — wall area is perimeter × height,
// less openings). No persistence, no I/O — just geometry — so the rule is
// unit-testable in one spot and reused identically by the API and the builder UI.
//
// Wall thickness is a Floor-level default (CONTEXT.md "Floor") but does not enter
// these area formulas: MagicPlan-style interior/exterior thickness affects how
// adjoining rooms snap, not a single room's perimeter × height. Openings (doors,
// windows) are not modeled yet, so net wall area equals gross for now.

export interface RoomInput {
  /** Footprint width, in the Sketch's linear unit (feet). */
  width: number;
  /** Footprint length, in the Sketch's linear unit (feet). */
  length: number;
  /** Ceiling height — a Floor default, overridable per Room. */
  ceilingHeight: number;
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
  /** Wall area after openings; equals gross until openings are modeled. */
  netWallArea: number;
  /** Enclosed volume (floor area × ceiling height). */
  volume: number;
}

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

  const floorArea = width * length;
  const perimeter = 2 * (width + length);
  const grossWallArea = perimeter * ceilingHeight;

  return {
    floorArea,
    ceilingArea: floorArea,
    perimeter,
    grossWallArea,
    netWallArea: grossWallArea, // no openings yet → net == gross
    volume: floorArea * ceilingHeight,
  };
}

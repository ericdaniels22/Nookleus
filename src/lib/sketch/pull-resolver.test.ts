// Issue #861 — M3, the Room-measurement pull resolver.
//
// M1 (measure-room) says "how big is this space"; M3 is the pure step that turns
// a Room's measurements plus a chosen kind into the single number an Estimate
// line item freezes into its `quantity`, and the breadcrumb it records about
// where that number came from (CONTEXT.md "Room"; ADR 0025 — a line item pulls
// its quantity from a Room measurement as a re-pullable snapshot). Keeping it a
// pure module means the mapping and the freeze are unit-testable in one spot and
// reused identically by the pull API route.

import { describe, expect, it } from "vitest";

import type { RoomMeasurements } from "./measure-room";
import {
  ROOM_MEASUREMENT_KINDS,
  ROOM_MEASUREMENT_KIND_LABELS,
  resolveRoomPull,
  roomMeasurementValue,
} from "./pull-resolver";

// A Room whose six measurements are all distinct, so a wrong kind→field mapping
// can never accidentally land on the right number.
const MEASUREMENTS: RoomMeasurements = {
  floorArea: 12,
  ceilingArea: 13,
  perimeter: 14,
  grossWallArea: 112,
  netWallArea: 100,
  volume: 96,
};

describe("roomMeasurementValue", () => {
  it("reads floor_area from the floor area field", () => {
    expect(roomMeasurementValue(MEASUREMENTS, "floor_area")).toBe(12);
  });

  it("maps every room-scope kind to its own measurement field", () => {
    // Each of the six snake_case kinds must read its own camelCase field. The
    // distinct MEASUREMENTS values mean a swapped pair (e.g. floor↔ceiling)
    // would surface here as a wrong number. Net wall area is the default wall
    // measurement (#861), but gross is pullable too.
    expect(roomMeasurementValue(MEASUREMENTS, "floor_area")).toBe(12);
    expect(roomMeasurementValue(MEASUREMENTS, "ceiling_area")).toBe(13);
    expect(roomMeasurementValue(MEASUREMENTS, "perimeter")).toBe(14);
    expect(roomMeasurementValue(MEASUREMENTS, "wall_area_gross")).toBe(112);
    expect(roomMeasurementValue(MEASUREMENTS, "wall_area_net")).toBe(100);
    expect(roomMeasurementValue(MEASUREMENTS, "volume")).toBe(96);
  });

  it("rejects an unknown kind instead of returning undefined", () => {
    // A bad kind from the wire must surface as an error here, not flow onward
    // as an `undefined` quantity that later reads as NaN in an Estimate total.
    expect(() =>
      roomMeasurementValue(MEASUREMENTS, "square_footage" as never),
    ).toThrow();
  });
});

describe("ROOM_MEASUREMENT_KIND_LABELS", () => {
  it("gives every kind a human-readable label for the picker and badge", () => {
    // The badge and the picker both render these; every wire kind must have one,
    // and the wall labels must distinguish net (the default) from gross.
    for (const kind of ROOM_MEASUREMENT_KINDS) {
      expect(ROOM_MEASUREMENT_KIND_LABELS[kind]).toBeTruthy();
    }
    expect(ROOM_MEASUREMENT_KIND_LABELS.wall_area_net).toBe("Net wall area");
    expect(ROOM_MEASUREMENT_KIND_LABELS.wall_area_gross).toBe("Gross wall area");
    expect(ROOM_MEASUREMENT_KIND_LABELS.floor_area).toBe("Floor area");
  });
});

describe("resolveRoomPull", () => {
  const IDS = {
    sketchId: "sk-1",
    floorId: "fl-1",
    roomId: "rm-1",
    roomName: "Living Room",
  } as const;

  it("resolves the chosen kind into a frozen Room-scoped source breadcrumb", () => {
    const pull = resolveRoomPull({
      ...IDS,
      measurements: MEASUREMENTS,
      kind: "wall_area_net",
      pulledAt: "2026-06-30T12:00:00.000Z",
    });

    // The value the line item freezes into `quantity` is the resolved net wall
    // area, and the same value is recorded in the source breadcrumb.
    expect(pull.value).toBe(100);
    expect(pull.source).toEqual({
      scope: "room",
      sketch_id: "sk-1",
      floor_id: "fl-1",
      room_id: "rm-1",
      room_name: "Living Room",
      kind: "wall_area_net",
      value: 100,
      pulled_at: "2026-06-30T12:00:00.000Z",
    });
  });

  it("freezes the value — re-measuring the Room afterward does not move it", () => {
    // The whole point of the snapshot (ADR 0004): once pulled, the line item's
    // quantity is fixed. Mutating the source measurements after the pull — as a
    // re-scan of the Sketch would — must leave the frozen value untouched.
    const live: RoomMeasurements = { ...MEASUREMENTS };
    const pull = resolveRoomPull({
      ...IDS,
      measurements: live,
      kind: "floor_area",
      pulledAt: "2026-06-30T12:00:00.000Z",
    });

    live.floorArea = 999; // the Room grew after the pull

    expect(pull.value).toBe(12);
    expect(pull.source.value).toBe(12);
  });
});

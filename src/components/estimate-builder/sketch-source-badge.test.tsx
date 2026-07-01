// Isolated tests for SketchSourceBadge (#861; #865 grows it to Floor and
// whole-Sketch scope) — the little chip that marks a line item whose quantity was
// pulled (and frozen) from a Sketch. It reads the frozen `sketch_source`
// breadcrumb and names the source scope and the measurement.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SketchSourceBadge } from "./sketch-source-badge";
import type {
  FloorSketchSource,
  RoomSketchSource,
  WholeSketchSource,
} from "@/lib/sketch/pull-resolver";

function makeSource(overrides: Partial<RoomSketchSource> = {}): RoomSketchSource {
  return {
    scope: "room",
    sketch_id: "sk-1",
    floor_id: "fl-1",
    room_id: "rm-1",
    room_name: "Living Room",
    kind: "wall_area_net",
    value: 100,
    pulled_at: "2026-06-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("SketchSourceBadge", () => {
  it("names the source Room and the measurement kind", () => {
    render(<SketchSourceBadge source={makeSource()} />);

    const badge = screen.getByTestId("sketch-source-badge");
    // The badge tells the reader exactly which Room and which measurement the
    // frozen quantity came from.
    expect(badge.textContent).toContain("Living Room");
    expect(badge.textContent).toContain("Net wall area");
  });

  it("uses the human label for a different kind", () => {
    render(<SketchSourceBadge source={makeSource({ kind: "floor_area", room_name: "Kitchen" })} />);

    const badge = screen.getByTestId("sketch-source-badge");
    expect(badge.textContent).toContain("Kitchen");
    expect(badge.textContent).toContain("Floor area");
  });

  it("names the source Floor for a Floor-scoped pull", () => {
    // A Floor-scoped pull carries no Room — the badge must name the Floor
    // instead, so the reader sees the number came from a whole level's total.
    const source: FloorSketchSource = {
      scope: "floor",
      sketch_id: "sk-1",
      floor_id: "fl-1",
      floor_name: "Ground Floor",
      kind: "floor_area",
      value: 420,
      pulled_at: "2026-06-30T12:00:00.000Z",
    };
    render(<SketchSourceBadge source={source} />);

    const badge = screen.getByTestId("sketch-source-badge");
    expect(badge.textContent).toContain("Ground Floor");
    expect(badge.textContent).toContain("Floor area");
  });

  it("names the object category for an object_count pull", () => {
    // An object_count pull is scoped by category, not a measurement — the badge
    // must name the category ("Cabinets"), since the widened "object_count" kind
    // alone tells the reader nothing about what was counted (#867).
    render(
      <SketchSourceBadge
        source={makeSource({
          kind: "object_count",
          object_category: "cabinets",
          room_name: "Kitchen",
          value: 3,
        })}
      />,
    );

    const badge = screen.getByTestId("sketch-source-badge");
    expect(badge.textContent).toContain("Kitchen");
    expect(badge.textContent).toContain("Cabinets");
  });

  it("names the whole Sketch for a Sketch-scoped pull", () => {
    // The coarsest pull spans every Floor — the badge shows a fixed "Whole
    // Sketch" label since there is no single Room or Floor to name.
    const source: WholeSketchSource = {
      scope: "sketch",
      sketch_id: "sk-1",
      kind: "volume",
      value: 9600,
      pulled_at: "2026-06-30T12:00:00.000Z",
    };
    render(<SketchSourceBadge source={source} />);

    const badge = screen.getByTestId("sketch-source-badge");
    expect(badge.textContent).toContain("Whole Sketch");
    expect(badge.textContent).toContain("Volume");
  });
});

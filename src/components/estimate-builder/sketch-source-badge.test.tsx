// Isolated tests for SketchSourceBadge (#861) — the little chip that marks a
// line item whose quantity was pulled (and frozen) from a Sketch Room. It reads
// the frozen `sketch_source` breadcrumb and names the Room and the measurement.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SketchSourceBadge } from "./sketch-source-badge";
import type { SketchSource } from "@/lib/sketch/pull-resolver";

function makeSource(overrides: Partial<SketchSource> = {}): SketchSource {
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
});

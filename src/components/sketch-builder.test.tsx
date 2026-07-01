// Issue #860 / #879 — the in-Job Sketch builder. These tests pin the surface's
// user-facing behaviour: the Room measurements recompute live as the footprint is
// drawn, a new Room is persisted through the rooms API and joins the visible list,
// and Rooms that were already saved (passed in on reload) render with their
// measurements. The geometry itself is M1's own test
// (src/lib/sketch/measure-room.test.ts) and the drawing/snapping is the footprint
// core's test; here we only check the builder wires the drawn footprint → M1 → the
// screen and the API. The Fabric drawing surface is mocked to a stub that emits a
// fixed footprint, so these tests never touch a real canvas.
//
// No jest-dom matchers (none configured) — assertions read the DOM directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { Floor, Room } from "@/lib/types";

// The drawing surface is the thin, untested Fabric glue. Mock it to a button that
// emits a 3 × 4 rectangle footprint, so "draw" is one deterministic click.
const RECT_FOOTPRINT = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 4 },
  { x: 0, y: 4 },
];

vi.mock("./footprint-canvas", () => ({
  default: ({
    onFootprintChange,
  }: {
    onFootprintChange: (points: { x: number; y: number }[]) => void;
  }) => (
    <button type="button" onClick={() => onFootprintChange(RECT_FOOTPRINT)}>
      draw rectangle
    </button>
  ),
}));

import SketchBuilder from "./sketch-builder";

function makeFloor(overrides: Partial<Floor> = {}): Floor {
  return {
    id: "floor-1",
    organization_id: "org-1",
    sketch_id: "sketch-1",
    name: "Ground Floor",
    default_ceiling_height: 8,
    interior_wall_thickness: 0.33,
    exterior_wall_thickness: 0.5,
    sort_order: 0,
    created_at: "2026-06-30T00:00:00Z",
    updated_at: "2026-06-30T00:00:00Z",
    ...overrides,
  };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    organization_id: "org-1",
    floor_id: "floor-1",
    name: "Living Room",
    footprint: RECT_FOOTPRINT,
    width: 3,
    length: 4,
    ceiling_height_override: null,
    floor_area: 12,
    ceiling_area: 12,
    perimeter: 14,
    gross_wall_area: 112,
    net_wall_area: 112,
    volume: 96,
    sort_order: 0,
    created_at: "2026-06-30T00:00:00Z",
    updated_at: "2026-06-30T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SketchBuilder — live measurements (#879)", () => {
  it("recomputes the derived measurements once a footprint is drawn", async () => {
    render(
      <SketchBuilder
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor({ default_ceiling_height: 8 })}
        initialRooms={[]}
      />,
    );

    // Draw the 3 × 4 rectangle footprint via the stubbed canvas.
    fireEvent.click(screen.getByRole("button", { name: /draw rectangle/i }));

    // 3 × 4 footprint at the Floor's inherited 8ft ceiling:
    //   floor area 12, perimeter 14, gross wall 112, volume 96.
    expect(screen.getByTestId("measure-floorArea").textContent).toContain("12");
    expect(screen.getByTestId("measure-perimeter").textContent).toContain("14");
    expect(screen.getByTestId("measure-grossWallArea").textContent).toContain(
      "112",
    );
    expect(screen.getByTestId("measure-volume").textContent).toContain("96");
  });
});

describe("SketchBuilder — adding a Room (#879)", () => {
  it("persists the drawn footprint through the rooms API and shows it in the list", async () => {
    const created = makeRoom({ id: "room-new", name: "Living Room" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ room: created }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SketchBuilder
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor({ default_ceiling_height: 8 })}
        initialRooms={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText(/room name/i), {
      target: { value: "Living Room" },
    });
    // Drawing a footprint is what enables the Add button.
    fireEvent.click(screen.getByRole("button", { name: /draw rectangle/i }));
    fireEvent.click(screen.getByRole("button", { name: /add room/i }));

    // The POST carries the Floor + the drawn footprint to the Job's rooms
    // endpoint — no width/length, which the server derives from the footprint.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/job-1/sketch/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      floorId: "floor-1",
      name: "Living Room",
      footprint: RECT_FOOTPRINT,
      ceilingHeightOverride: null,
    });

    // The created Room joins the visible list.
    expect(await screen.findByText("Living Room")).toBeDefined();
  });

  it("keeps the Add button disabled until a footprint of at least three corners is drawn", () => {
    render(
      <SketchBuilder
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[]}
      />,
    );

    const addButton = screen.getByRole("button", { name: /add room/i });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /draw rectangle/i }));

    expect((addButton as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SketchBuilder — reload survival (#879)", () => {
  it("renders Rooms that were already saved with their measurements", () => {
    render(
      <SketchBuilder
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[
          makeRoom({ id: "room-1", name: "Kitchen", floor_area: 12, volume: 96 }),
          makeRoom({ id: "room-2", name: "Bedroom", floor_area: 20, volume: 160 }),
        ]}
      />,
    );

    // Both persisted Rooms are listed by name without any interaction…
    expect(screen.getByText("Kitchen")).toBeDefined();
    expect(screen.getByText("Bedroom")).toBeDefined();
    // …and their derived measurements come along (the Kitchen's floor area).
    const kitchen = screen.getByText("Kitchen").closest("li");
    expect(kitchen?.textContent).toContain("12");
  });
});

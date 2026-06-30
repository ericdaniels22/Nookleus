// Issue #860 — the in-Job Sketch builder. These tests pin the surface's
// user-facing behaviour: the Room measurements recompute live as you type, a new
// Room is persisted through the rooms API and joins the visible list, and Rooms
// that were already saved (passed in on reload) render with their measurements.
// The geometry itself is M1's own test (src/lib/sketch/measure-room.test.ts);
// here we only check the builder wires inputs → M1 → the screen and the API.
//
// No jest-dom matchers (none configured) — assertions read the DOM directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { Floor, Room } from "@/lib/types";
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

describe("SketchBuilder — live measurements (#860)", () => {
  it("recomputes the derived measurements as the width and length change", async () => {
    render(
      <SketchBuilder
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor({ default_ceiling_height: 8 })}
        initialRooms={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText(/width/i), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/length/i), {
      target: { value: "4" },
    });

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

describe("SketchBuilder — adding a Room (#860)", () => {
  it("persists the Room through the rooms API and shows it in the list", async () => {
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
    fireEvent.change(screen.getByLabelText(/width/i), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/length/i), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add room/i }));

    // The POST carries the Floor + footprint to the Job's rooms endpoint.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/job-1/sketch/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      floorId: "floor-1",
      name: "Living Room",
      width: 3,
      length: 4,
      ceilingHeightOverride: null,
    });

    // The created Room joins the visible list.
    expect(await screen.findByText("Living Room")).toBeDefined();
  });
});

describe("SketchBuilder — reload survival (#860)", () => {
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

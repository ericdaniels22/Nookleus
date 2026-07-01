// Issue #890 — the full-screen desktop plan editor. These tests pin the shell's
// user-facing behaviour: the multi-room plan is handed to the canvas, clicking a
// Room opens the right inspector, the inspector edits (rename, ceiling override,
// delete) and a drag-to-move all round-trip through the rooms API touching only
// what changed (ADR 0026 — a move writes origin alone, measurements unchanged),
// and "+ Add room" draws a new Room. The Fabric MagicPlan canvas is the untested
// glue, so it's mocked to a harness that exposes buttons for select / move /
// finish-footprint; these tests never touch a real canvas.
//
// No jest-dom matchers (none configured) — assertions read the DOM directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { Floor, Room } from "@/lib/types";

const RECT_FOOTPRINT = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 4 },
  { x: 0, y: 4 },
];

// The MagicPlan canvas is thin, untested Fabric glue. Mock it to a harness that
// surfaces its props (mode/zoom/selection) and a button per interaction the
// shell wires: select a Room, drag it to (5,7), and finish drawing a rectangle.
vi.mock("./plan-canvas", () => ({
  default: ({
    rooms,
    selectedRoomId,
    mode,
    zoom,
    onSelectRoom,
    onMoveRoom,
    onFootprintComplete,
  }: {
    rooms: Room[];
    selectedRoomId: string | null;
    mode: string;
    zoom: number;
    onSelectRoom: (id: string | null) => void;
    onMoveRoom: (id: string, origin: { x: number; y: number }) => void;
    onFootprintComplete: (points: { x: number; y: number }[]) => void;
  }) => (
    <div data-testid="plan-canvas">
      <div data-testid="canvas-mode">{mode}</div>
      <div data-testid="canvas-zoom">{zoom}</div>
      <div data-testid="canvas-selected">{selectedRoomId ?? ""}</div>
      {rooms.map((r) => (
        <div key={r.id}>
          <button type="button" onClick={() => onSelectRoom(r.id)}>
            select {r.name}
          </button>
          <button type="button" onClick={() => onMoveRoom(r.id, { x: 5, y: 7 })}>
            drag {r.name}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onFootprintComplete(RECT_FOOTPRINT)}>
        finish footprint
      </button>
    </div>
  ),
}));

import PlanEditor from "./plan-editor";

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
    origin: { x: 0, y: 0 },
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

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlanEditor — shell (#890)", () => {
  it("renders the Floor and hands the whole multi-room plan to the canvas", () => {
    render(
      <PlanEditor
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor({ name: "Ground Floor" })}
        initialRooms={[
          makeRoom({ id: "room-1", name: "Kitchen" }),
          makeRoom({ id: "room-2", name: "Bedroom" }),
        ]}
      />,
    );

    // The top bar names the active Floor and links back to the Job.
    expect(screen.getByText(/ground floor/i)).toBeDefined();
    const back = screen.getByRole("link", { name: /back/i });
    expect(back.getAttribute("href")).toBe("/jobs/job-1");

    // Both Rooms reach the canvas; nothing is selected on first paint.
    expect(screen.getByRole("button", { name: /select kitchen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /select bedroom/i })).toBeDefined();
    expect(screen.getByTestId("canvas-selected").textContent).toBe("");
  });

  it("opens the inspector with the Room's name, measurements and a Delete action when a Room is selected", () => {
    render(
      <PlanEditor
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[
          makeRoom({
            id: "room-1",
            name: "Kitchen",
            floor_area: 12,
            perimeter: 14,
            gross_wall_area: 112,
            volume: 96,
          }),
        ]}
      />,
    );

    // No inspector until a Room is picked.
    expect(screen.queryByLabelText(/room name/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /select kitchen/i }));

    // The selection reaches the canvas and the inspector opens on that Room.
    expect(screen.getByTestId("canvas-selected").textContent).toBe("room-1");
    const nameInput = screen.getByLabelText(/room name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Kitchen");

    // The six cached measurements are shown (read straight off the Room row).
    expect(screen.getByTestId("measure-floorArea").textContent).toContain("12");
    expect(screen.getByTestId("measure-perimeter").textContent).toContain("14");
    expect(screen.getByTestId("measure-grossWallArea").textContent).toContain(
      "112",
    );
    expect(screen.getByTestId("measure-volume").textContent).toContain("96");

    expect(screen.getByRole("button", { name: /delete/i })).toBeDefined();
  });

  it("adds a Room: '+ Add room' arms the canvas, and finishing a footprint POSTs it and places it on the plan", async () => {
    const created = makeRoom({
      id: "room-new",
      name: "Room",
      floor_area: 12,
      perimeter: 14,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ room: created }), { status: 201 }),
      );

    render(
      <PlanEditor
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[makeRoom({ id: "room-1", name: "Kitchen" })]}
      />,
    );

    // Idle until armed.
    expect(screen.getByTestId("canvas-mode").textContent).toBe("idle");

    // "+ Add room" arms the canvas to place the next drawn footprint.
    fireEvent.click(screen.getByRole("button", { name: /add room/i }));
    expect(screen.getByTestId("canvas-mode").textContent).toBe("adding");

    // Finishing a footprint POSTs it to this Floor's rooms collection.
    fireEvent.click(screen.getByRole("button", { name: /finish footprint/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/job-1/sketch/rooms");
    expect(init?.method).toBe("POST");
    const sent = JSON.parse(String(init?.body));
    expect(sent.floorId).toBe("floor-1");
    expect(sent.footprint).toEqual(RECT_FOOTPRINT);

    // The saved Room joins the plan and the canvas disarms.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /select room$/i }),
      ).toBeDefined(),
    );
    expect(screen.getByTestId("canvas-mode").textContent).toBe("idle");
  });

  it("moves a Room: dragging it PATCHes only its origin (ADR 0026 — measurements are position-invariant)", async () => {
    // The server echoes the row with the new origin; its measurements are
    // unchanged because a move never touches the footprint.
    const moved = makeRoom({
      id: "room-1",
      name: "Kitchen",
      origin: { x: 5, y: 7 },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ room: moved }), { status: 200 }),
      );

    render(
      <PlanEditor
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[makeRoom({ id: "room-1", name: "Kitchen" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /drag kitchen/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/job-1/sketch/rooms/room-1");
    expect(init?.method).toBe("PATCH");
    // Only the origin is sent — no footprint, no measurements.
    const sent = JSON.parse(String(init?.body));
    expect(sent).toEqual({ origin: { x: 5, y: 7 } });
  });

  it("edits a Room: renaming and overriding the ceiling height Saves via PATCH and reflects the recomputed measurements", async () => {
    // A ceiling override re-derives the cache server-side; the echoed row carries
    // the new name and the recomputed measurements the inspector then shows.
    const edited = makeRoom({
      id: "room-1",
      name: "Primary Bath",
      ceiling_height_override: 10,
      gross_wall_area: 140,
      volume: 120,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ room: edited }), { status: 200 }),
      );

    render(
      <PlanEditor
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[
          makeRoom({
            id: "room-1",
            name: "Kitchen",
            ceiling_height_override: null,
            gross_wall_area: 112,
            volume: 96,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select kitchen/i }));

    fireEvent.change(screen.getByLabelText(/room name/i), {
      target: { value: "Primary Bath" },
    });
    fireEvent.change(screen.getByLabelText(/ceiling height/i), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/job-1/sketch/rooms/room-1");
    expect(init?.method).toBe("PATCH");
    const sent = JSON.parse(String(init?.body));
    expect(sent.name).toBe("Primary Bath");
    expect(sent.ceilingHeightOverride).toBe(10);

    // The inspector now shows the server-recomputed measurements.
    await waitFor(() =>
      expect(screen.getByTestId("measure-volume").textContent).toContain("120"),
    );
    expect(screen.getByTestId("measure-grossWallArea").textContent).toContain(
      "140",
    );
  });

  it("deletes a Room: the inspector's Delete removes it via DELETE and closes the inspector", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    render(
      <PlanEditor
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[makeRoom({ id: "room-1", name: "Kitchen" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select kitchen/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/job-1/sketch/rooms/room-1");
    expect(init?.method).toBe("DELETE");

    // The Room leaves the plan and the inspector closes.
    await waitFor(() => expect(screen.queryByLabelText(/room name/i)).toBeNull());
    expect(
      screen.queryByRole("button", { name: /select kitchen/i }),
    ).toBeNull();
  });

  it("zooms: the −/%/+/Fit control changes the displayed zoom and hands it to the canvas", () => {
    render(
      <PlanEditor
        jobId="job-1"
        sketchId="sketch-1"
        floor={makeFloor()}
        initialRooms={[makeRoom({ id: "room-1", name: "Kitchen" })]}
      />,
    );

    // Opens at 1:1 and the canvas sees it.
    expect(screen.getByText("100%")).toBeDefined();
    expect(screen.getByTestId("canvas-zoom").textContent).toBe("100");

    // Zoom in steps up; the canvas follows.
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(screen.getByText("125%")).toBeDefined();
    expect(screen.getByTestId("canvas-zoom").textContent).toBe("125");

    // Zoom out steps back down.
    fireEvent.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(screen.getByText("100%")).toBeDefined();

    // Fit returns to 1:1 from any zoom.
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    fireEvent.click(screen.getByRole("button", { name: /fit/i }));
    expect(screen.getByText("100%")).toBeDefined();
    expect(screen.getByTestId("canvas-zoom").textContent).toBe("100");
  });
});

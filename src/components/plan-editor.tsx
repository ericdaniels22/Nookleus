"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Maximize, Minus, Pencil, Plus, Trash2, X } from "lucide-react";

import type { Floor, Room, SketchObject } from "@/lib/types";
import { translateFootprint, type Point } from "@/lib/sketch/footprint";
import { deleteWall, setWallLength } from "@/lib/sketch/footprint-edit";
import { floorStatistics, sketchStatistics } from "@/lib/sketch/room-stats";
import {
  objectInventory,
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_LABELS,
  type ObjectCategory,
} from "@/lib/sketch/object-inventory";
import PlanCanvas from "./plan-canvas";
import { StatisticsPanel } from "./statistics-panel";

// The 3D dollhouse is a client-only WebGL island (three needs a real GL
// context, so it can't server-render). Load it lazily on the first flip to 3D —
// no three in the initial bundle, matching the Jarvis NeuralNetwork3D idiom.
const Sketch3DViewer = dynamic(() => import("./sketch-3d-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading 3D view…
    </div>
  ),
});

/** Trim trailing zeros so "12.000" reads as "12" but "12.5" survives. */
function fmt(value: number): string {
  return Number(Number(value).toFixed(3)).toString();
}

// Issue #890 — the full-screen desktop plan editor (ADR 0026). Replaces the
// centered #879 form with an edge-to-edge canvas: a top bar (back / Floor /
// + Add room), the multi-room MagicPlan canvas, a right inspector when a Room is
// selected (name + ceiling override + the six M1 measurements + Delete), and a
// bottom-floating zoom control. This shell owns all editor state and is the
// single client writer to the rooms API; the canvas (PlanCanvas) is Fabric glue
// it drives. Moving a Room writes only its origin — the footprint and its
// measurements are position-invariant (ADR 0026).

interface PlanEditorProps {
  jobId: string;
  sketchId: string;
  /** Every Floor of the Sketch; the first is the active one on first paint. */
  floors: Floor[];
  /**
   * Every Room saved across all Floors (each carries its `floor_id`), so the
   * plan survives a reload and the whole-Sketch Statistics can be totalled.
   */
  initialRooms: Room[];
  /**
   * Every known-category object placed across all Rooms (#867). Optional — a
   * Sketch with no objects yet omits it. Each carries its `room_id`, so the
   * canvas can draw only the active Floor's and the inventory can be totalled.
   */
  initialObjects?: SketchObject[];
}

export default function PlanEditor({
  jobId,
  floors: initialFloors,
  initialRooms,
  initialObjects = [],
}: PlanEditorProps) {
  const [floors, setFloors] = useState<Floor[]>(initialFloors);
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [objects, setObjects] = useState<SketchObject[]>(initialObjects);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  // Which placed object is selected (#867) — opens the object inspector (edit
  // category / delete). A Room and an object are never selected at once: picking
  // one clears the other, so exactly one right-hand panel shows.
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "adding">("idle");
  // Placing a known-category object mirrors "adding" a Room (#867): the palette
  // arms a category (`objectDraft`), the canvas reports where it was dropped, and
  // the shell POSTs the armed category to that Room. `objectPaletteOpen` toggles
  // the category menu; null draft means nothing is armed.
  const [objectDraft, setObjectDraft] = useState<ObjectCategory | null>(null);
  const [objectPaletteOpen, setObjectPaletteOpen] = useState(false);
  // Which dimension the plan is shown in. 2D is the authoring surface; 3D is the
  // read-only extruded dollhouse (#870). Switching to 3D drops any selection and
  // the add-a-Room arm so returning to 2D is clean.
  const [viewDim, setViewDim] = useState<"2d" | "3d">("2d");
  // Which Floor is on the canvas. Rooms are filtered to it; switching Floors
  // just changes this id (the Rooms of other Floors stay in state for stats).
  const [activeFloorId, setActiveFloorId] = useState<string>(floors[0]?.id ?? "");
  // The active Floor's name is editable inline; `renamingFloor` toggles the field
  // and `floorNameDraft` holds the in-progress name until Save.
  const [renamingFloor, setRenamingFloor] = useState(false);
  const [floorNameDraft, setFloorNameDraft] = useState("");
  // Zoom as a percentage (100 = 1:1), stepped 25% at a time within a sane range.
  // "Fit" returns to 1:1; true fit-to-content recentring is canvas glue (#890).
  const [zoom, setZoom] = useState(100);
  const clampZoom = (z: number) => Math.min(400, Math.max(25, Math.round(z)));
  const zoomIn = () => setZoom((z) => clampZoom(z + 25));
  const zoomOut = () => setZoom((z) => clampZoom(z - 25));
  const zoomFit = () => setZoom(100);

  // The Floor the canvas is showing, and the Rooms placed on it. Other Floors'
  // Rooms stay in `rooms` so the whole-Sketch Statistics can total them.
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? floors[0];
  const activeRooms = rooms.filter((r) => r.floor_id === activeFloor?.id);
  // The objects that live in the active Floor's Rooms — what the canvas draws.
  const activeRoomIds = new Set(activeRooms.map((r) => r.id));
  const activeObjects = objects.filter((o) => activeRoomIds.has(o.room_id));

  const selectedRoom = activeRooms.find((r) => r.id === selectedRoomId) ?? null;
  const selectedObject =
    activeObjects.find((o) => o.id === selectedObjectId) ?? null;

  // Selecting a Room or an object is exclusive — each clears the other so only
  // one right-hand panel is open at a time.
  function selectRoom(roomId: string | null) {
    setSelectedObjectId(null);
    setSelectedRoomId(roomId);
  }
  function selectObject(objectId: string | null) {
    setSelectedRoomId(null);
    setSelectedObjectId(objectId);
  }

  // The Statistics roll-up (M2): the active Floor's totals and the whole-Sketch
  // totals (every Floor's Rooms summed). Pure — the numbers come straight off the
  // Rooms' cached measurements (room-stats.ts).
  const floorAggregate = floorStatistics(activeRooms);
  const sketchAggregate = sketchStatistics(
    floors.map((f) => rooms.filter((r) => r.floor_id === f.id)),
  );

  // Switching Floors just changes which Floor the canvas draws. The prior
  // selection (a Room on the old Floor) and any half-drawn footprint are dropped
  // so the inspector never dangles on an off-Floor Room.
  function selectFloor(floorId: string) {
    setActiveFloorId(floorId);
    setSelectedRoomId(null);
    setMode("idle");
  }

  // Adding a Floor grows the Sketch (a second storey, a detached structure). The
  // server names the Sketch it belongs to, so we send only a starting name — the
  // Nth Floor — which the user can rename. The new Floor becomes active with an
  // empty canvas.
  async function addFloor() {
    const res = await fetch(`/api/jobs/${jobId}/sketch/floors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Floor ${floors.length + 1}` }),
    });
    if (!res.ok) return;
    const { floor } = (await res.json()) as { floor: Floor };
    setFloors((prev) => [...prev, floor]);
    selectFloor(floor.id);
  }

  // Renaming the active Floor writes only its name (the level defaults and its
  // Rooms are untouched). We take the echoed row so the tab relabels at once.
  function startRenamingFloor() {
    setFloorNameDraft(activeFloor?.name ?? "");
    setRenamingFloor(true);
  }

  async function saveFloorName() {
    const name = floorNameDraft.trim();
    if (!activeFloor || !name) {
      setRenamingFloor(false);
      return;
    }
    const res = await fetch(
      `/api/jobs/${jobId}/sketch/floors/${activeFloor.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    setRenamingFloor(false);
    if (!res.ok) return;
    const { floor } = (await res.json()) as { floor: Floor };
    setFloors((prev) => prev.map((f) => (f.id === floor.id ? floor : f)));
  }

  // Moving a Room writes only its origin (ADR 0026) — the footprint and its
  // cached measurements are position-invariant, so the PATCH carries nothing
  // else. We replace the row with what the server echoes back.
  async function moveRoom(roomId: string, origin: Point) {
    const res = await fetch(`/api/jobs/${jobId}/sketch/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin }),
    });
    if (!res.ok) return;
    const { room } = (await res.json()) as { room: Room };
    setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
  }

  // A newly-drawn footprint becomes a Room. The server computes its cached
  // measurements from M1 (the app is the single writer of the cache), so we POST
  // the drawn corners and append the row it returns, then disarm the canvas.
  async function completeFootprint(footprint: Point[]) {
    setMode("idle");
    const res = await fetch(`/api/jobs/${jobId}/sketch/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ floorId: activeFloor.id, footprint }),
    });
    if (!res.ok) return;
    const { room } = (await res.json()) as { room: Room };
    setRooms((prev) => [...prev, room]);
  }

  // Reshaping a Room — a wall length typed, a wall deleted, or (on the canvas) a
  // corner dragged — PATCHes the reworked footprint in PLACED floor coordinates.
  // The server re-normalizes it (min corner → 0,0), lifts the shift into origin,
  // and recomputes the cache (ADR 0026); we take the echoed row wholesale so the
  // shape, its position and every measurement stay consistent.
  async function editFootprint(roomId: string, placedFootprint: Point[]) {
    const res = await fetch(`/api/jobs/${jobId}/sketch/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ footprint: placedFootprint }),
    });
    if (!res.ok) return;
    const { room } = (await res.json()) as { room: Room };
    setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
  }

  // Renaming or overriding a Room's ceiling height Saves through the same PATCH.
  // A ceiling change re-derives the cached measurements server-side, so we take
  // the echoed row wholesale — name, override and the recomputed measurements.
  async function saveRoom(
    roomId: string,
    edits: { name: string; ceilingHeightOverride: number | null },
  ) {
    const res = await fetch(`/api/jobs/${jobId}/sketch/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edits),
    });
    if (!res.ok) return;
    const { room } = (await res.json()) as { room: Room };
    setRooms((prev) => prev.map((r) => (r.id === room.id ? room : r)));
  }

  // Deleting a Room removes it from the Floor and closes the inspector. We drop
  // it from local state only once the server confirms the delete.
  async function deleteRoom(roomId: string) {
    const res = await fetch(`/api/jobs/${jobId}/sketch/rooms/${roomId}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
    setSelectedRoomId((current) => (current === roomId ? null : current));
  }

  // Dropping an armed object into a Room (#867). The palette arms a category; the
  // canvas reports the drop position. We POST the category and position to that
  // Room's objects collection, append the echoed row, and disarm — one drop, one
  // object (re-arm from the palette to place another).
  async function placeObject(roomId: string, position: Point) {
    const category = objectDraft;
    if (!category) return;
    setObjectDraft(null);
    const res = await fetch(`/api/jobs/${jobId}/sketch/rooms/${roomId}/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, position }),
    });
    if (!res.ok) return;
    const { object } = (await res.json()) as { object: SketchObject };
    setObjects((prev) => [...prev, object]);
  }

  // Removing a placed object (#867). We DELETE it from its Room's collection,
  // then drop it from state and clear the selection so the object inspector
  // closes. Nothing re-derives — objects are count-only.
  async function deleteObject(objectId: string, roomId: string) {
    const res = await fetch(
      `/api/jobs/${jobId}/sketch/rooms/${roomId}/objects/${objectId}`,
      { method: "DELETE" },
    );
    if (!res.ok) return;
    setObjects((prev) => prev.filter((o) => o.id !== objectId));
    setSelectedObjectId(null);
  }

  // Re-categorizing a placed object (#867) — the only edit the inspector offers
  // (objects are count-only; position/rotation are a canvas drag). We PATCH just
  // the category and replace the row with the echoed one.
  async function changeObjectCategory(
    objectId: string,
    roomId: string,
    category: ObjectCategory,
  ) {
    const res = await fetch(
      `/api/jobs/${jobId}/sketch/rooms/${roomId}/objects/${objectId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      },
    );
    if (!res.ok) return;
    const { object } = (await res.json()) as { object: SketchObject };
    setObjects((prev) => prev.map((o) => (o.id === object.id ? object : o)));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Link
          href={`/jobs/${jobId}`}
          aria-label="Back to job"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Back
        </Link>
        <nav aria-label="Floors" className="flex items-center gap-1">
          {floors.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => selectFloor(f.id)}
              aria-current={f.id === activeFloor?.id ? "true" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                f.id === activeFloor?.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {f.name}
            </button>
          ))}
          <button
            type="button"
            aria-label="Add floor"
            onClick={addFloor}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <Plus size={14} />
            Floor
          </button>
        </nav>

        {renamingFloor ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveFloorName();
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor="floor-name" className="sr-only">
              Floor name
            </label>
            <input
              id="floor-name"
              type="text"
              autoFocus
              value={floorNameDraft}
              onChange={(e) => setFloorNameDraft(e.target.value)}
              className="w-40 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              aria-label="Save floor"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
          </form>
        ) : (
          <button
            type="button"
            aria-label="Rename floor"
            onClick={startRenamingFloor}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <Pencil size={14} />
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div
            role="group"
            aria-label="View"
            className="inline-flex items-center rounded-lg border border-border p-0.5"
          >
            {(["2d", "3d"] as const).map((dim) => (
              <button
                key={dim}
                type="button"
                onClick={() => {
                  setViewDim(dim);
                  // Entering the read-only dollhouse drops any 2D selection and
                  // disarms add-a-Room / any armed object, so returning to 2D is a
                  // clean slate.
                  if (dim === "3d") {
                    setSelectedRoomId(null);
                    setSelectedObjectId(null);
                    setObjectDraft(null);
                    setObjectPaletteOpen(false);
                    setMode("idle");
                  }
                }}
                aria-pressed={viewDim === dim}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  viewDim === dim
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {dim.toUpperCase()}
              </button>
            ))}
          </div>

          {viewDim === "2d" ? (
            <>
              {/* Object palette (#867): arm a known category, then the next canvas
                  drop places it. Toggling the menu never enters room-draw mode;
                  arming a category cancels any half-drawn Room. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setObjectPaletteOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={objectPaletteOpen}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/60"
                >
                  <Plus size={16} />
                  Add object
                </button>
                {objectPaletteOpen ? (
                  <div
                    role="menu"
                    aria-label="Object categories"
                    className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-border bg-card py-1 shadow-lg"
                  >
                    {OBJECT_CATEGORIES.map((category) => (
                      <button
                        key={category}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setObjectDraft(category);
                          setObjectPaletteOpen(false);
                          setMode("idle");
                        }}
                        className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted/60"
                      >
                        {OBJECT_CATEGORY_LABELS[category]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => {
                  setObjectDraft(null);
                  setMode("adding");
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus size={16} />
                Add room
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="relative flex-1">
        {viewDim === "3d" ? (
          // The read-only dollhouse: the same active Floor's Rooms, extruded. No
          // inspector, no 2D zoom control — orbiting is the only interaction.
          <Sketch3DViewer rooms={activeRooms} floor={activeFloor} />
        ) : (
          <>
            <PlanCanvas
              rooms={activeRooms}
              selectedRoomId={selectedRoomId}
              mode={mode}
              zoom={zoom}
              objects={activeObjects}
              objectDraft={objectDraft}
              selectedObjectId={selectedObjectId}
              onSelectRoom={selectRoom}
              onMoveRoom={moveRoom}
              onFootprintComplete={completeFootprint}
              onEditFootprint={editFootprint}
              onPlaceObject={placeObject}
              onSelectObject={selectObject}
              onZoomChange={(z) => setZoom(clampZoom(z))}
            />

            {selectedObject ? (
              <ObjectInspector
                key={selectedObject.id}
                object={selectedObject}
                onChangeCategory={(category) =>
                  changeObjectCategory(
                    selectedObject.id,
                    selectedObject.room_id,
                    category,
                  )
                }
                onDelete={() =>
                  deleteObject(selectedObject.id, selectedObject.room_id)
                }
              />
            ) : selectedRoom ? (
              <RoomInspector
                key={selectedRoom.id}
                room={selectedRoom}
                floor={activeFloor}
                objects={objects.filter((o) => o.room_id === selectedRoom.id)}
                onSave={(edits) => saveRoom(selectedRoom.id, edits)}
                onEditFootprint={(placed) =>
                  editFootprint(selectedRoom.id, placed)
                }
                onDelete={() => deleteRoom(selectedRoom.id)}
              />
            ) : (
              <aside
                aria-label="Statistics"
                className="absolute right-0 top-0 h-full w-72 overflow-y-auto border-l border-border bg-card p-4"
              >
                <StatisticsPanel
                  floor={floorAggregate}
                  sketch={sketchAggregate}
                  floorName={activeFloor?.name}
                />
              </aside>
            )}

            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={zoomOut}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground hover:bg-muted"
              >
                <Minus size={16} />
              </button>
              <span className="w-14 text-center text-sm font-medium tabular-nums text-foreground">
                {zoom}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={zoomIn}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground hover:bg-muted"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                aria-label="Fit to content"
                onClick={zoomFit}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground hover:bg-muted"
              >
                <Maximize size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The right inspector for the selected Room. Keyed by Room id in the parent so
// its local edit fields reset when the selection changes. Shows the Room's name
// (editable), its ceiling-height override (blank → inherits the Floor default),
// the six cached M1 measurements, and a Delete action.
function RoomInspector({
  room,
  floor,
  objects,
  onSave,
  onEditFootprint,
  onDelete,
}: {
  room: Room;
  floor: Floor;
  /** The known-category objects placed in this Room (#867). */
  objects: SketchObject[];
  onSave: (edits: { name: string; ceilingHeightOverride: number | null }) => void;
  /** Reshape the Room to this footprint, in PLACED floor coordinates. */
  onEditFootprint: (placedFootprint: Point[]) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(room.name);
  // Blank means "inherit the Floor default" — held as a string so the field can
  // be empty; parsed to a number (or null) on Save.
  const [ceiling, setCeiling] = useState(
    room.ceiling_height_override == null ? "" : String(room.ceiling_height_override),
  );

  function save() {
    const trimmed = ceiling.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    onSave({
      name: name.trim() || room.name,
      ceilingHeightOverride: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    });
  }

  // The Room's walls — each the edge from corner i to the next, closing the loop
  // (#862). The footprint is stored normalized, so a reshape lifts the reworked
  // shape back to placed floor coords by its origin before sending (ADR 0026).
  const footprint = room.footprint;
  const walls = footprint.map((from, i) => {
    const to = footprint[(i + 1) % footprint.length];
    return { index: i, length: Math.hypot(to.x - from.x, to.y - from.y) };
  });

  // The Room's object inventory (#867): a count per known category. Objects are
  // a COUNT source only (never billed for footage or area), so this readout is
  // plain counts — the same numbers an `object_count` line-item pull freezes.
  // Only categories the Room actually holds are listed; the rest are omitted.
  const inventory = objectInventory(objects);
  const presentCategories = OBJECT_CATEGORIES.filter((c) => inventory[c] > 0);

  function applyWallLength(wallIndex: number, targetLength: number) {
    onEditFootprint(
      translateFootprint(
        setWallLength(footprint, wallIndex, targetLength),
        room.origin,
      ),
    );
  }

  function removeWall(wallIndex: number) {
    onEditFootprint(
      translateFootprint(deleteWall(footprint, wallIndex), room.origin),
    );
  }

  return (
    <aside
      aria-label="Room inspector"
      className="absolute right-0 top-0 flex h-full w-72 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="room-name" className="text-xs text-muted-foreground">
          Room name
        </label>
        <input
          id="room-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="ceiling-height" className="text-xs text-muted-foreground">
          Ceiling height (ft)
        </label>
        <input
          id="ceiling-height"
          type="number"
          min={0}
          step="any"
          value={ceiling}
          placeholder={`Floor default (${fmt(floor.default_ceiling_height)})`}
          onChange={(e) => setCeiling(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <button
        type="button"
        onClick={save}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Save
      </button>

      <dl className="grid grid-cols-2 gap-2">
        <Measure id="floorArea" label="Floor area" value={room.floor_area} unit="ft²" />
        <Measure id="ceilingArea" label="Ceiling area" value={room.ceiling_area} unit="ft²" />
        <Measure id="perimeter" label="Perimeter" value={room.perimeter} unit="ft" />
        <Measure id="grossWallArea" label="Gross wall" value={room.gross_wall_area} unit="ft²" />
        <Measure id="netWallArea" label="Net wall" value={room.net_wall_area} unit="ft²" />
        <Measure id="volume" label="Volume" value={room.volume} unit="ft³" />
      </dl>

      {/* Per-wall editing (#862): type an exact length (slides the far corner
          along the wall's bearing) or remove a wall (collapses it to its
          midpoint). A reshape re-measures server-side; the tiles above follow.
          Removing is disabled once only a triangle remains — a Room needs three
          walls. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Walls</h3>
        <ul className="flex flex-col gap-2">
          {walls.map((w) => (
            <WallRow
              key={`${w.index}-${fmt(w.length)}`}
              index={w.index}
              length={w.length}
              canRemove={walls.length > 3}
              onSetLength={applyWallLength}
              onRemove={removeWall}
            />
          ))}
        </ul>
      </div>

      {/* The Room's object inventory (#867) — a count per known category it
          holds. Count-only; a line item pulls an object_count for a category
          from exactly these numbers. Categories with none are omitted. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Objects</h3>
        <dl data-testid="room-object-inventory" className="flex flex-col gap-1">
          {presentCategories.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">None yet.</p>
          ) : (
            presentCategories.map((category) => (
              <div
                key={category}
                data-testid={`room-object-${category}`}
                className="flex items-center justify-between rounded-lg border border-border bg-background px-2 py-1"
              >
                <dt className="text-[11px] text-muted-foreground">
                  {OBJECT_CATEGORY_LABELS[category]}
                </dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {inventory[category]}
                </dd>
              </div>
            ))
          )}
        </dl>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
      >
        <Trash2 size={16} />
        Delete room
      </button>
    </aside>
  );
}

// The right inspector for a selected placed object (#867). Objects are
// count-only, so there are no measurements here — just what the object IS (its
// category) and a Delete action. Keyed by object id in the parent so it resets
// when the selection changes.
function ObjectInspector({
  object,
  onChangeCategory,
  onDelete,
}: {
  object: SketchObject;
  onChangeCategory: (category: ObjectCategory) => void;
  onDelete: () => void;
}) {
  return (
    <aside
      aria-label="Object inspector"
      className="absolute right-0 top-0 flex h-full w-72 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="object-category"
          className="text-xs text-muted-foreground"
        >
          Category
        </label>
        {/* Driven straight off the object row — after a PATCH echoes back, the
            updated category flows in as a prop and the field re-reads it. */}
        <select
          id="object-category"
          value={object.category}
          onChange={(e) => onChangeCategory(e.target.value as ObjectCategory)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {OBJECT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {OBJECT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
      >
        <Trash2 size={16} />
        Delete object
      </button>
    </aside>
  );
}

// One wall in the inspector's Walls list: its label, an exact-length field, and
// (when the Room has more than three walls) a Remove control. Keyed in the parent
// by index + current length, so a reshape remounts the row and the field shows
// the freshly recomputed length rather than a stale edit (ADR 0026 / #862).
function WallRow({
  index,
  length,
  canRemove,
  onSetLength,
  onRemove,
}: {
  index: number;
  length: number;
  canRemove: boolean;
  onSetLength: (wallIndex: number, targetLength: number) => void;
  onRemove: (wallIndex: number) => void;
}) {
  const [value, setValue] = useState(fmt(length));
  const label = `Wall ${index + 1}`;

  return (
    <li className="flex items-center gap-2">
      <form
        className="flex flex-1 items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) onSetLength(index, n);
        }}
      >
        <span className="w-12 shrink-0 text-[11px] text-muted-foreground">
          {label}
        </span>
        <input
          type="number"
          min={0}
          step="any"
          value={value}
          aria-label={`${label} length (ft)`}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          aria-label={`Set length of wall ${index + 1}`}
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          Set
        </button>
      </form>
      {canRemove ? (
        <button
          type="button"
          aria-label={`Remove wall ${index + 1}`}
          onClick={() => onRemove(index)}
          className="shrink-0 rounded-lg border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
        >
          <X size={14} />
        </button>
      ) : null}
    </li>
  );
}

function Measure({
  id,
  label,
  value,
  unit,
}: {
  id: string;
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        data-testid={`measure-${id}`}
        className="text-sm font-semibold text-foreground"
      >
        {fmt(value)} {unit}
      </dd>
    </div>
  );
}

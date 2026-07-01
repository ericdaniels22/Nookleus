"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Maximize, Minus, Plus, Trash2 } from "lucide-react";

import type { Floor, Room } from "@/lib/types";
import { type Point } from "@/lib/sketch/footprint";
import PlanCanvas from "./plan-canvas";

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
  /** The active Floor — supplies the ceiling height a Room inherits. */
  floor: Floor;
  /** Rooms already saved on this Floor, so the plan survives a reload. */
  initialRooms: Room[];
}

export default function PlanEditor({ jobId, floor, initialRooms }: PlanEditorProps) {
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "adding">("idle");
  // Zoom as a percentage (100 = 1:1), stepped 25% at a time within a sane range.
  // "Fit" returns to 1:1; true fit-to-content recentring is canvas glue (#890).
  const [zoom, setZoom] = useState(100);
  const clampZoom = (z: number) => Math.min(400, Math.max(25, Math.round(z)));
  const zoomIn = () => setZoom((z) => clampZoom(z + 25));
  const zoomOut = () => setZoom((z) => clampZoom(z - 25));
  const zoomFit = () => setZoom(100);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

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
      body: JSON.stringify({ floorId: floor.id, footprint }),
    });
    if (!res.ok) return;
    const { room } = (await res.json()) as { room: Room };
    setRooms((prev) => [...prev, room]);
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
        <span className="text-sm font-medium text-foreground">{floor.name}</span>

        <button
          type="button"
          onClick={() => setMode("adding")}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={16} />
          Add room
        </button>
      </header>

      <div className="relative flex-1">
        <PlanCanvas
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          mode={mode}
          zoom={zoom}
          onSelectRoom={setSelectedRoomId}
          onMoveRoom={moveRoom}
          onFootprintComplete={completeFootprint}
          onZoomChange={(z) => setZoom(clampZoom(z))}
        />

        {selectedRoom ? (
          <RoomInspector
            key={selectedRoom.id}
            room={selectedRoom}
            floor={floor}
            onSave={(edits) => saveRoom(selectedRoom.id, edits)}
            onDelete={() => deleteRoom(selectedRoom.id)}
          />
        ) : null}

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
  onSave,
  onDelete,
}: {
  room: Room;
  floor: Floor;
  onSave: (edits: { name: string; ceilingHeightOverride: number | null }) => void;
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

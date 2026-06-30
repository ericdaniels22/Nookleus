"use client";

import { useMemo, useState } from "react";

import type { Floor, Room } from "@/lib/types";
import { measureRoom } from "@/lib/sketch/measure-room";

// The in-Job Sketch builder (#860). A builder route in the AppShell sense
// (BUILDER_ROUTE_PATTERNS), so the nav collapses to a rail beside it. The Sketch
// and its first Floor are established server-side before this mounts; here the
// user gives a Room its width × length (and, optionally, a ceiling height that
// overrides the Floor default) and watches the M1-derived measurements update
// live, then persists the Room through the rooms API.

interface SketchBuilderProps {
  jobId: string;
  sketchId: string;
  /** The active Floor — supplies the ceiling height a Room inherits. */
  floor: Floor;
  /** Rooms already saved on this Floor, so the list survives a reload. */
  initialRooms: Room[];
}

/** Parse a dimension field to a finite, non-negative number (blank → 0). */
function toDimension(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Trim trailing zeros so "12.000" reads as "12" but "12.5" survives. */
function fmt(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export default function SketchBuilder({
  jobId,
  floor,
  initialRooms,
}: SketchBuilderProps) {
  const [name, setName] = useState("");
  const [width, setWidth] = useState("");
  const [length, setLength] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The effective ceiling height: the Room's override when given, else the
  // Floor default it inherits.
  const ceilingHeight =
    ceiling.trim() === "" ? floor.default_ceiling_height : toDimension(ceiling);

  // Live M1 preview. measureRoom is pure, so this recomputes on every keystroke.
  const preview = useMemo(
    () =>
      measureRoom({
        width: toDimension(width),
        length: toDimension(length),
        ceilingHeight,
      }),
    [width, length, ceilingHeight],
  );

  const w = toDimension(width);
  const l = toDimension(length);
  const canAdd = w > 0 && l > 0 && !saving;

  // Persist the Room through the rooms API — the server is the single writer of
  // the cached measurements (it recomputes them from M1), so we take the row it
  // returns rather than trusting the client preview. On success the Room joins
  // the list and the footprint fields reset for the next one.
  async function addRoom() {
    if (!canAdd) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/sketch/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          floorId: floor.id,
          name: name.trim() || "Room",
          width: w,
          length: l,
          ceilingHeightOverride: ceiling.trim() === "" ? null : toDimension(ceiling),
        }),
      });
      if (!res.ok) {
        setError("Could not add the room. Please try again.");
        return;
      }
      const { room } = (await res.json()) as { room: Room };
      setRooms((prev) => [...prev, room]);
      setName("");
      setWidth("");
      setLength("");
      setCeiling("");
    } catch {
      setError("Could not add the room. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">Sketch</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {floor.name} · ceiling {fmt(floor.default_ceiling_height)} ft
      </p>

      <div className="mt-6 flex flex-col gap-1">
        <label htmlFor="room-name" className="text-sm text-muted-foreground">
          Room name
        </label>
        <input
          id="room-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Room"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="room-width" className="text-sm text-muted-foreground">
            Width (ft)
          </label>
          <input
            id="room-width"
            type="number"
            min="0"
            step="0.1"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="room-length" className="text-sm text-muted-foreground">
            Length (ft)
          </label>
          <input
            id="room-length"
            type="number"
            min="0"
            step="0.1"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="room-ceiling" className="text-sm text-muted-foreground">
            Ceiling height (ft)
          </label>
          <input
            id="room-ceiling"
            type="number"
            min="0"
            step="0.1"
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
            placeholder={`${fmt(floor.default_ceiling_height)} (inherited)`}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Measure id="floorArea" label="Floor area" value={preview.floorArea} unit="ft²" />
        <Measure id="ceilingArea" label="Ceiling area" value={preview.ceilingArea} unit="ft²" />
        <Measure id="perimeter" label="Perimeter" value={preview.perimeter} unit="ft" />
        <Measure id="grossWallArea" label="Gross wall area" value={preview.grossWallArea} unit="ft²" />
        <Measure id="netWallArea" label="Net wall area" value={preview.netWallArea} unit="ft²" />
        <Measure id="volume" label="Volume" value={preview.volume} unit="ft³" />
      </dl>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={addRoom}
          disabled={!canAdd}
          className="rounded-lg bg-[#2B5EA7] px-4 py-2 text-sm font-medium text-white hover:bg-[#244f8c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add room"}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">
          Rooms ({rooms.length})
        </h2>
        {rooms.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No rooms yet. Add the first one above.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
              >
                <span className="text-sm font-medium text-foreground">
                  {room.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmt(Number(room.width))} × {fmt(Number(room.length))} ft ·{" "}
                  {fmt(Number(room.floor_area))} ft² floor ·{" "}
                  {fmt(Number(room.volume))} ft³
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
    <div className="rounded-lg border border-border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd data-testid={`measure-${id}`} className="text-base font-semibold text-foreground">
        {fmt(value)} {unit}
      </dd>
    </div>
  );
}

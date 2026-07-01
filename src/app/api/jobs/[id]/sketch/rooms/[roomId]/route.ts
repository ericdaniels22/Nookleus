import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { updateSketchRoom } from "@/lib/sketch/update-room";
import { deleteSketchRoom } from "@/lib/sketch/delete-room";
import { apiDbError } from "@/lib/api-errors";
import type { SketchOpening } from "@/lib/types";

interface UpdateRoomPayload {
  origin?: unknown;
  name?: unknown;
  footprint?: unknown;
  ceilingHeightOverride?: unknown;
  openings?: unknown;
}

/** A point with finite x/y — the shape a Room's origin must take (ADR 0026). */
function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isFinite((value as { x: unknown }).x) &&
    Number.isFinite((value as { y: unknown }).y)
  );
}

/** A closed footprint: at least three corners, each a finite point (#862). Fewer
 * than three has no enclosed loop, so the update step would measure it as zero. */
function isFootprint(value: unknown): value is { x: number; y: number }[] {
  return Array.isArray(value) && value.length >= 3 && value.every(isPoint);
}

/** A finite, non-negative number — the only kind a ceiling height can be. */
function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A door/window opening (#866): a known kind with non-negative, finite width,
 * height, wall_index, and offset. The update step deducts width×height from gross
 * wall area and tallies the kind, so a malformed opening would corrupt the cache. */
function isOpening(value: unknown): value is SketchOpening {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    (o.type === "door" || o.type === "window") &&
    isDimension(o.width) &&
    isDimension(o.height) &&
    isDimension(o.wall_index) &&
    isDimension(o.offset)
  );
}

/** An array of well-formed openings (an empty list clears them). */
function isOpenings(value: unknown): value is SketchOpening[] {
  return Array.isArray(value) && value.every(isOpening);
}

// PATCH /api/jobs/[id]/sketch/rooms/[roomId] — mutate a placed Room from the
// full-screen editor (#890): move it (origin), rename it, or override its ceiling
// height. Runs server-side because a ceiling change re-derives the cached
// measurements from M1, keeping the app the single writer of the cache
// (migration-build88). The RLS-scoped read first confirms the Room is visible to
// the caller's org — a cross-org or nonexistent id resolves to no row and 404s,
// leaking no existence oracle.
export const PATCH = withRequestContext(
  { permission: "edit_jobs" },
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; roomId: string }> },
  ) => {
    const { roomId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const { data: room, error: roomError } = await ctx.supabase
      .from("rooms")
      .select("id")
      .eq("id", roomId)
      .maybeSingle<{ id: string }>();
    if (roomError) {
      return apiDbError(
        roomError.message,
        "PATCH /api/jobs/[id]/sketch/rooms/[roomId]",
      );
    }
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as UpdateRoomPayload;

    // Only the fields actually present are changed; each must be well-formed.
    const patch: {
      roomId: string;
      origin?: { x: number; y: number };
      name?: string;
      footprint?: { x: number; y: number }[];
      ceilingHeightOverride?: number | null;
      openings?: SketchOpening[];
    } = { roomId };
    if (body.origin !== undefined) {
      if (!isPoint(body.origin)) {
        return NextResponse.json(
          { error: "origin must be a point with finite x and y" },
          { status: 400 },
        );
      }
      patch.origin = { x: body.origin.x, y: body.origin.y };
    }
    // A reshaped footprint (#862) arrives in placed floor coordinates; the update
    // step re-normalizes it and recomputes the cache.
    if (body.footprint !== undefined) {
      if (!isFootprint(body.footprint)) {
        return NextResponse.json(
          { error: "footprint must be an array of at least three finite points" },
          { status: 400 },
        );
      }
      patch.footprint = body.footprint.map(({ x, y }) => ({ x, y }));
    }
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          { error: "name must be a non-empty string" },
          { status: 400 },
        );
      }
      patch.name = body.name.trim();
    }
    // A ceiling change is present when the key is sent at all: a number pins the
    // height, an explicit null clears the override back to the Floor default.
    if (body.ceilingHeightOverride !== undefined) {
      if (body.ceilingHeightOverride !== null && !isDimension(body.ceilingHeightOverride)) {
        return NextResponse.json(
          { error: "ceilingHeightOverride must be a non-negative number or null" },
          { status: 400 },
        );
      }
      patch.ceilingHeightOverride = body.ceilingHeightOverride;
    }
    // The editor sends the Room's full opening list on every add/edit/remove; the
    // update step recomputes net wall area + door/window counts from it (#866).
    if (body.openings !== undefined) {
      if (!isOpenings(body.openings)) {
        return NextResponse.json(
          {
            error:
              "openings must be an array of {type: door|window, width, height, wall_index, offset} with non-negative dimensions",
          },
          { status: 400 },
        );
      }
      patch.openings = body.openings.map((o) => ({
        type: o.type,
        width: o.width,
        height: o.height,
        wall_index: o.wall_index,
        offset: o.offset,
      }));
    }

    try {
      const updated = await updateSketchRoom(ctx.supabase, patch);
      return NextResponse.json({ room: updated }, { status: 200 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "update failed",
        "PATCH /api/jobs/[id]/sketch/rooms/[roomId]",
      );
    }
  },
);

// DELETE /api/jobs/[id]/sketch/rooms/[roomId] — remove a placed Room from the
// full-screen editor (#890). Same org-scoped visibility guard as PATCH: the
// RLS-bound read 404s a Room the caller can't see before anything is removed.
export const DELETE = withRequestContext(
  { permission: "edit_jobs" },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; roomId: string }> },
  ) => {
    const { roomId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const { data: room, error: roomError } = await ctx.supabase
      .from("rooms")
      .select("id")
      .eq("id", roomId)
      .maybeSingle<{ id: string }>();
    if (roomError) {
      return apiDbError(
        roomError.message,
        "DELETE /api/jobs/[id]/sketch/rooms/[roomId]",
      );
    }
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    try {
      await deleteSketchRoom(ctx.supabase, { roomId });
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "delete failed",
        "DELETE /api/jobs/[id]/sketch/rooms/[roomId]",
      );
    }
  },
);

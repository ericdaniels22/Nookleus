import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { updateSketchObject } from "@/lib/sketch/update-object";
import { deleteSketchObject } from "@/lib/sketch/delete-object";
import { apiDbError } from "@/lib/api-errors";
import {
  OBJECT_CATEGORIES,
  type ObjectCategory,
} from "@/lib/sketch/object-inventory";

interface UpdateObjectPayload {
  category?: unknown;
  position?: unknown;
  rotation?: unknown;
}

/** One of the known object categories (the vocabulary the DB CHECK also pins). */
function isCategory(value: unknown): value is ObjectCategory {
  return (
    typeof value === "string" &&
    (OBJECT_CATEGORIES as readonly string[]).includes(value)
  );
}

/** A point with finite x/y — where an object sits in the Room's own space. */
function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isFinite((value as { x: unknown }).x) &&
    Number.isFinite((value as { y: unknown }).y)
  );
}

/** A finite number — the only kind a rotation (in degrees) can be. */
function isAngle(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// The object-visibility guard shared by PATCH and DELETE: the RLS-scoped read
// resolves an object the caller's org can't see to no row, so a cross-org or
// nonexistent id 404s before anything is touched (mirrors the rooms/[roomId]
// guard). Returns the guard's HTTP response, or null when the object is visible.
async function guardObjectVisible(
  supabase: Parameters<typeof updateSketchObject>[0],
  objectId: string,
  where: string,
): Promise<NextResponse | null> {
  const { data: object, error } = await supabase
    .from("room_objects")
    .select("id")
    .eq("id", objectId)
    .maybeSingle<{ id: string }>();
  if (error) return apiDbError(error.message, where);
  if (!object) {
    return NextResponse.json({ error: "Object not found" }, { status: 404 });
  }
  return null;
}

// PATCH /api/jobs/[id]/sketch/rooms/[roomId]/objects/[objectId] — mutate a placed
// object from the full-screen editor (#867): move it (position), rotate it, or
// swap its category. Only the fields actually present are changed. Objects are
// count-only, so nothing here re-derives a measurement.
export const PATCH = withRequestContext(
  { permission: "edit_jobs" },
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; roomId: string; objectId: string }> },
  ) => {
    const { objectId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const where = "PATCH /api/jobs/[id]/sketch/rooms/[roomId]/objects/[objectId]";
    const blocked = await guardObjectVisible(ctx.supabase, objectId, where);
    if (blocked) return blocked;

    const body = (await request
      .json()
      .catch(() => ({}))) as UpdateObjectPayload;

    // Only the fields actually present are changed; each must be well-formed.
    const patch: {
      objectId: string;
      category?: ObjectCategory;
      position?: { x: number; y: number };
      rotation?: number;
    } = { objectId };
    if (body.category !== undefined) {
      if (!isCategory(body.category)) {
        return NextResponse.json(
          { error: `category must be one of ${OBJECT_CATEGORIES.join(", ")}` },
          { status: 400 },
        );
      }
      patch.category = body.category;
    }
    if (body.position !== undefined) {
      if (!isPoint(body.position)) {
        return NextResponse.json(
          { error: "position must be a point with finite x and y" },
          { status: 400 },
        );
      }
      patch.position = { x: body.position.x, y: body.position.y };
    }
    if (body.rotation !== undefined) {
      if (!isAngle(body.rotation)) {
        return NextResponse.json(
          { error: "rotation must be a finite number" },
          { status: 400 },
        );
      }
      patch.rotation = body.rotation;
    }

    try {
      const object = await updateSketchObject(ctx.supabase, patch);
      return NextResponse.json({ object }, { status: 200 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "update failed",
        where,
      );
    }
  },
);

// DELETE /api/jobs/[id]/sketch/rooms/[roomId]/objects/[objectId] — remove a
// placed object. Same org-scoped visibility guard as PATCH.
export const DELETE = withRequestContext(
  { permission: "edit_jobs" },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; roomId: string; objectId: string }> },
  ) => {
    const { objectId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const where = "DELETE /api/jobs/[id]/sketch/rooms/[roomId]/objects/[objectId]";
    const blocked = await guardObjectVisible(ctx.supabase, objectId, where);
    if (blocked) return blocked;

    try {
      await deleteSketchObject(ctx.supabase, { objectId });
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "delete failed",
        where,
      );
    }
  },
);

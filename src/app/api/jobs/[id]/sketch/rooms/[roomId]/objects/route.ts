import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createSketchObject } from "@/lib/sketch/create-object";
import { apiDbError } from "@/lib/api-errors";
import {
  OBJECT_CATEGORIES,
  type ObjectCategory,
} from "@/lib/sketch/object-inventory";

interface CreateObjectPayload {
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

// POST /api/jobs/[id]/sketch/rooms/[roomId]/objects — drop a known object into a
// Room from the full-screen editor (#867, S7). Objects are a count source only,
// so the payload is WHICH category and (optionally) WHERE it sits — no size ever.
// The RLS-scoped read first confirms the Room is visible to the caller's org: a
// cross-org or nonexistent id resolves to no row and 404s, leaking no existence
// oracle (mirrors the rooms/[roomId] guard).
export const POST = withRequestContext(
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
        "POST /api/jobs/[id]/sketch/rooms/[roomId]/objects",
      );
    }
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const body = (await request
      .json()
      .catch(() => ({}))) as CreateObjectPayload;

    if (!isCategory(body.category)) {
      return NextResponse.json(
        { error: `category must be one of ${OBJECT_CATEGORIES.join(", ")}` },
        { status: 400 },
      );
    }
    // Position and rotation are optional placement; when present they must be
    // well-formed. Absent, the writer defaults them to (0,0) and 0.
    let position: { x: number; y: number } | undefined;
    if (body.position !== undefined) {
      if (!isPoint(body.position)) {
        return NextResponse.json(
          { error: "position must be a point with finite x and y" },
          { status: 400 },
        );
      }
      position = { x: body.position.x, y: body.position.y };
    }
    let rotation: number | undefined;
    if (body.rotation !== undefined) {
      if (!isAngle(body.rotation)) {
        return NextResponse.json(
          { error: "rotation must be a finite number" },
          { status: 400 },
        );
      }
      rotation = body.rotation;
    }

    try {
      const object = await createSketchObject(ctx.supabase, {
        organizationId: ctx.orgId,
        roomId,
        category: body.category,
        position,
        rotation,
      });
      return NextResponse.json({ object }, { status: 201 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "insert failed",
        "POST /api/jobs/[id]/sketch/rooms/[roomId]/objects",
      );
    }
  },
);

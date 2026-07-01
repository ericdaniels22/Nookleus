// Issue #867 — S7: persisting one known object into a Room. A Room carries an
// inventory of placed known objects (cabinets, appliances, fixtures); this is the
// single write path the plan editor uses to drop one in. It pins that the writer
//   - refuses to write against a Room the caller can't see (RLS scope), and
//   - rejects an unknown category before it reaches the DB, and
//   - persists the category + placement, defaulting position/rotation.
// The round-trip against the real table (incl. the CHECK + cascade) is the pg
// test; here a chainable Supabase stub lets us assert the exact insert payload.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSketchObject } from "./create-object";

// Stub covering the two tables createSketchObject touches:
//   - rooms: `.eq("id").maybeSingle()` resolves to `opts.room` — the RLS-scoped
//     visibility read (a room the caller can't see resolves to null).
//   - room_objects: an insert captures the payload and `.single()` echoes it back.
// `inserts.room_objects` exposes the captured payload for assertions.
function fakeSupabase(opts: { room: { id: string } | null }) {
  const inserts: Record<string, Record<string, unknown>> = {};
  function from(table: string) {
    let captured: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      insert: (payload: Record<string, unknown>) => {
        inserts[table] = payload;
        captured = payload;
        return builder;
      },
      maybeSingle: async () => ({
        data: table === "rooms" ? opts.room : null,
        error: null,
      }),
      single: async () => ({ data: { id: "obj-new", ...captured }, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, inserts };
}

describe("createSketchObject", () => {
  it("inserts a room_objects row under a visible Room, defaulting position and rotation", async () => {
    const { client, inserts } = fakeSupabase({ room: { id: "room-1" } });

    const created = await createSketchObject(client, {
      organizationId: "org-1",
      roomId: "room-1",
      category: "refrigerator",
    });

    expect(inserts.room_objects).toMatchObject({
      organization_id: "org-1",
      room_id: "room-1",
      category: "refrigerator",
      position: { x: 0, y: 0 },
      rotation: 0,
    });
    expect(created.id).toBe("obj-new");
  });

  it("persists the given position and rotation when the editor places at an angle", async () => {
    const { client, inserts } = fakeSupabase({ room: { id: "room-1" } });

    await createSketchObject(client, {
      organizationId: "org-1",
      roomId: "room-1",
      category: "stove",
      position: { x: 3.5, y: 2 },
      rotation: 90,
    });

    expect(inserts.room_objects).toMatchObject({
      category: "stove",
      position: { x: 3.5, y: 2 },
      rotation: 90,
    });
  });

  it("rejects an unknown category before it can reach the DB", async () => {
    const { client, inserts } = fakeSupabase({ room: { id: "room-1" } });

    await expect(
      createSketchObject(client, {
        organizationId: "org-1",
        roomId: "room-1",
        // A bad value off the wire — not one of the known categories.
        category: "spaceship" as unknown as "cabinets",
      }),
    ).rejects.toThrow(/unknown category/i);
    // It failed before any insert was attempted.
    expect(inserts.room_objects).toBeUndefined();
  });

  it("refuses to write when the Room is not visible to the caller", async () => {
    const { client } = fakeSupabase({ room: null });

    await expect(
      createSketchObject(client, {
        organizationId: "org-1",
        roomId: "ghost-room",
        category: "sink",
      }),
    ).rejects.toThrow(/room not found/i);
  });
});

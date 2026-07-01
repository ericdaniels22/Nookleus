// Issue #867 — S7: mutating a placed object. The plan editor drags an object to a
// new spot, rotates it, or swaps its category (a fridge becomes a stove).
// updateSketchObject is the single write path for all three, as a partial patch
// that touches ONLY what changed. Objects are count-only, so a move or rotate
// never re-derives a measurement (unlike a Room) — the patch is just the changed
// placement columns. The round-trip against the real table is the pg test; here a
// chainable Supabase stub asserts the exact update payload.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { updateSketchObject } from "./update-object";

// A chainable stub over room_objects (update + echo):
//   - `.update(payload)` captures the payload into `updates.room_objects` and
//     `.single()` echoes it back as the updated row.
function fakeSupabase() {
  const updates: Record<string, Record<string, unknown>> = {};
  function from(table: string) {
    let captured: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      update: (payload: Record<string, unknown>) => {
        updates[table] = payload;
        captured = payload;
        return builder;
      },
      single: async () => ({ data: { id: "obj-1", ...captured }, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, updates };
}

describe("updateSketchObject", () => {
  it("moves an object by writing only its position", async () => {
    const { client, updates } = fakeSupabase();

    await updateSketchObject(client, {
      objectId: "obj-1",
      position: { x: 4, y: 1.5 },
    });

    expect(updates.room_objects).toEqual({ position: { x: 4, y: 1.5 } });
  });

  it("rotates an object by writing only its rotation", async () => {
    const { client, updates } = fakeSupabase();

    await updateSketchObject(client, { objectId: "obj-1", rotation: 45 });

    expect(updates.room_objects).toEqual({ rotation: 45 });
  });

  it("swaps an object's category", async () => {
    const { client, updates } = fakeSupabase();

    await updateSketchObject(client, { objectId: "obj-1", category: "stove" });

    expect(updates.room_objects).toEqual({ category: "stove" });
  });

  it("rejects an unknown category before it can reach the DB", async () => {
    const { client, updates } = fakeSupabase();

    await expect(
      updateSketchObject(client, {
        objectId: "obj-1",
        category: "spaceship" as unknown as "cabinets",
      }),
    ).rejects.toThrow(/unknown category/i);
    expect(updates.room_objects).toBeUndefined();
  });
});

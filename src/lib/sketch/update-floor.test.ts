// Issue #865 — Sketch S5: renaming a Floor. The editor lets a user name each
// Floor (e.g. "Ground Floor" → "Main House", or naming a detached structure).
// This is the single write path for a Floor's name — a partial patch touching
// only `name`, scoped by RLS to a Floor the caller can see. A chainable stub
// captures the update payload so we can assert it writes just the name.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { updateFloor } from "./update-floor";

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
      single: async () => ({ data: { id: "floor-1", ...captured }, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, updates };
}

describe("updateFloor", () => {
  it("renames the Floor, writing only its name", async () => {
    const { client, updates } = fakeSupabase();

    const floor = await updateFloor(client, { floorId: "floor-1", name: "Main House" });

    expect(updates.floors).toEqual({ name: "Main House" });
    expect(floor.name).toBe("Main House");
  });
});

// Issue #869 (S9) — deleting a Job's Sketch. The Sketch surface's "start over"
// action removes the whole plan; this is its single write path. A Sketch owns
// its Floors and Rooms (and, when they land, openings/objects) through
// ON DELETE CASCADE (migration-build88), so removal is a plain row delete on
// `sketches` and the DB cascades the rest. It is scoped to the Sketch's id and —
// because the caller passes an RLS-bound client — to a Sketch the caller may see.
// Here a chainable Supabase stub asserts the delete is filtered to exactly that id.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deleteSketch } from "./delete-sketch";

// A chainable stub over the `sketches` table's delete path. `.delete()` marks the
// operation and `.eq(col, val)` records the filter; awaiting the builder resolves
// to a PostgREST-shaped `{ error }`.
function fakeSupabase(opts: { error?: { message: string } | null } = {}) {
  const calls: { table: string | null; deleted: boolean; filters: Array<[string, unknown]> } = {
    table: null,
    deleted: false,
    filters: [],
  };
  function from(table: string) {
    calls.table = table;
    const builder: Record<string, unknown> = {
      delete: () => {
        calls.deleted = true;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        calls.filters.push([col, val]);
        return builder;
      },
      then: (resolve: (r: { error: unknown }) => unknown) =>
        resolve({ error: opts.error ?? null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("deleteSketch", () => {
  it("deletes the Sketch row scoped to its id (the DB cascades Floors/Rooms)", async () => {
    const { client, calls } = fakeSupabase();

    await deleteSketch(client, { sketchId: "sketch-1" });

    expect(calls.table).toBe("sketches");
    expect(calls.deleted).toBe(true);
    expect(calls.filters).toContainEqual(["id", "sketch-1"]);
  });

  it("throws when the delete fails", async () => {
    const { client } = fakeSupabase({ error: { message: "boom" } });

    await expect(
      deleteSketch(client, { sketchId: "sketch-1" }),
    ).rejects.toThrow(/boom/);
  });
});

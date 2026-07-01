// Issue #890 — removing a placed Room. The full-screen editor's inspector has a
// Delete action; this is its single write path. A Room owns nothing downstream
// yet (no doors/fixtures until #866/#867), so deletion is a plain row removal —
// scoped to the Room's id and, through the caller's RLS-bound client, to a Room
// the caller can see. Here a chainable Supabase stub asserts the delete is
// filtered to exactly that id.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deleteSketchRoom } from "./delete-room";

// A chainable stub over the `rooms` table's delete path. `.delete()` marks the
// operation and `.eq(col, val)` records the filter; awaiting the builder
// resolves to a PostgREST-shaped `{ error }`.
function fakeSupabase(opts: { error?: { message: string } | null } = {}) {
  const calls: { deleted: boolean; filters: Array<[string, unknown]> } = {
    deleted: false,
    filters: [],
  };
  function from(_table: string) {
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

describe("deleteSketchRoom", () => {
  it("deletes the Room row scoped to its id", async () => {
    const { client, calls } = fakeSupabase();

    await deleteSketchRoom(client, { roomId: "room-1" });

    expect(calls.deleted).toBe(true);
    expect(calls.filters).toContainEqual(["id", "room-1"]);
  });

  it("throws when the delete fails", async () => {
    const { client } = fakeSupabase({ error: { message: "boom" } });

    await expect(
      deleteSketchRoom(client, { roomId: "room-1" }),
    ).rejects.toThrow(/boom/);
  });
});

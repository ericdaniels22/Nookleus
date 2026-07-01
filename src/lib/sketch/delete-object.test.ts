// Issue #867 — S7: removing a placed object. The plan editor deletes the selected
// object; this is the single write path. An object owns nothing downstream, so
// removal is a plain row delete scoped to the object's id — and, because the
// caller passes an RLS-bound client, to an object the caller is allowed to see.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deleteSketchObject } from "./delete-object";

// A chainable stub over room_objects: `.delete().eq("id")` records the deleted id
// and resolves. A seeded `error` surfaces as a thrown Error.
function fakeSupabase(opts: { error?: { message: string } } = {}) {
  const calls: { deletedId?: string } = {};
  function from(_table: string) {
    const builder: Record<string, unknown> = {
      delete: () => builder,
      eq: (_col: string, value: string) => {
        calls.deletedId = value;
        return Promise.resolve({ error: opts.error ?? null });
      },
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("deleteSketchObject", () => {
  it("deletes the object row by id", async () => {
    const { client, calls } = fakeSupabase();

    await deleteSketchObject(client, { objectId: "obj-1" });

    expect(calls.deletedId).toBe("obj-1");
  });

  it("throws when the delete errors", async () => {
    const { client } = fakeSupabase({ error: { message: "boom" } });

    await expect(
      deleteSketchObject(client, { objectId: "obj-1" }),
    ).rejects.toThrow(/boom/);
  });
});

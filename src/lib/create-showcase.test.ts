// #613 — Showcase: entity + builder (drafts).
//
// `createShowcaseDraft` is the server-side create step behind the Job's "Create
// showcase" action: it sanitizes the selected photo ids down to the Job's own
// photos (deduped, in order), stamps the author, and inserts the one draft
// Showcase row. A Job may hold at most one LIVE Showcase, so a unique-violation
// here is a genuine conflict (not a race to retry like photo-report numbering) —
// the function surfaces it as a typed error the route maps to 409.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createShowcaseDraft,
  ShowcaseAlreadyExistsError,
} from "./create-showcase";

// A chainable Supabase stub branching on table:
//   - photos: the select chain (.eq("job_id").in("id", ids)) resolves, via
//     `.then`, to the subset of requested ids that "belong" to the Job. By
//     default every requested id is owned; pass `ownedPhotoIds` to simulate
//     cross-Job/unknown ids being filtered out.
//   - showcases: the insert chain captures its payload; `.single()` echoes it
//     back as the new row — unless `conflict` is set, when it rejects with the
//     Postgres unique_violation (23505) the one-live-per-Job index throws.
// `inserted` exposes the captured insert payload so a test can assert exactly
// what was written.
function fakeSupabase(
  opts: {
    ownedPhotoIds?: string[];
    conflict?: boolean;
    insertError?: { code?: string; message: string };
  } = {},
) {
  let inserted: Record<string, unknown> | null = null;
  const client = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      let inIds: string[] = [];
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = (_col: string, ids: string[]) => {
        inIds = ids;
        return builder;
      };
      builder.insert = (payload: Record<string, unknown>) => {
        inserted = payload;
        return builder;
      };
      builder.single = async () => {
        if (opts.insertError) {
          return { data: null, error: opts.insertError };
        }
        if (opts.conflict) {
          return {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "showcases_one_live_per_job"',
            },
          };
        }
        return { data: { id: "showcase-1", ...inserted }, error: null };
      };
      builder.then = (resolve: (r: unknown) => void) => {
        if (table === "photos") {
          const owned = opts.ownedPhotoIds
            ? inIds.filter((id) => opts.ownedPhotoIds!.includes(id))
            : inIds;
          return resolve({ data: owned.map((id) => ({ id })), error: null });
        }
        return resolve({ data: null, error: null });
      };
      return builder;
    },
    get inserted() {
      return inserted;
    },
  };
  return client as unknown as SupabaseClient & {
    inserted: Record<string, unknown> | null;
  };
}

describe("createShowcaseDraft", () => {
  it("inserts one draft Showcase scoped to the Organization and Job", async () => {
    const supabase = fakeSupabase();

    const showcase = await createShowcaseDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      createdBy: "user-1",
      title: "Kitchen remodel",
      writeUp: "A full gut renovation.",
      photoIds: ["p1", "p2"],
    });

    expect(supabase.inserted).toMatchObject({
      organization_id: "org-1",
      job_id: "job-1",
      title: "Kitchen remodel",
      write_up: "A full gut renovation.",
      photo_ids: ["p1", "p2"],
      status: "draft",
      created_by: "user-1",
    });
    expect(showcase.id).toBe("showcase-1");
  });

  it("stores only photos that belong to the Job, dropping foreign ids in order", async () => {
    // The client asked for p1, p2, p3 but only p1 and p3 belong to this Job (p2
    // is another Job's, or bogus). The Showcase must keep just the owned ids,
    // preserving the chosen order.
    const supabase = fakeSupabase({ ownedPhotoIds: ["p1", "p3"] });

    await createShowcaseDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      createdBy: "user-1",
      photoIds: ["p1", "p2", "p3"],
    });

    expect(supabase.inserted?.photo_ids).toEqual(["p1", "p3"]);
  });

  it("throws ShowcaseAlreadyExistsError when the Job already has a live Showcase", async () => {
    // The one-live-per-Job partial unique index rejects a second LIVE Showcase
    // with Postgres unique_violation (23505). Unlike report numbering this is not
    // a race to retry — the Job genuinely has a Showcase — so it surfaces as a
    // typed conflict the route maps to 409.
    const supabase = fakeSupabase({ conflict: true });

    await expect(
      createShowcaseDraft(supabase, {
        organizationId: "org-1",
        jobId: "job-1",
        createdBy: "user-1",
        photoIds: [],
      }),
    ).rejects.toBeInstanceOf(ShowcaseAlreadyExistsError);
  });

  it("rethrows a non-conflict insert error as a plain error", async () => {
    const supabase = fakeSupabase({
      insertError: { code: "23503", message: "insert or update violates fk" },
    });

    await expect(
      createShowcaseDraft(supabase, {
        organizationId: "org-1",
        jobId: "job-1",
        createdBy: "user-1",
        photoIds: [],
      }),
    ).rejects.not.toBeInstanceOf(ShowcaseAlreadyExistsError);
  });
});

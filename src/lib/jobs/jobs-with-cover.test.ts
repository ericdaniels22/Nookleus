import { describe, expect, it } from "vitest";

import type { Photo } from "@/lib/types";
import { loadJobsWithCover, shapeJobWithCover } from "./jobs-with-cover";

// A full photo row. The loader and shaper pass it through untouched, so
// only `id` matters for the identity assertions below; the rest is here
// purely to satisfy the Photo type.
function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "photo-1",
    job_id: "job-1",
    storage_path: "job-1/original.jpg",
    annotated_path: null,
    thumbnail_path: "job-1/thumb.jpg",
    caption: null,
    taken_at: null,
    taken_by: "user-1",
    media_type: "photo",
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: "2026-05-20T00:00:00Z",
    ...overrides,
  };
}

// A raw jobs row as it arrives from the Comfortable-view query. Built via
// a helper so the call site passes a value, not a fresh object literal —
// the latter would trip an excess-property check against the shaper's
// generic constraint.
function jobRow(id: string, cover_photo?: Photo | Photo[] | null) {
  return { id, cover_photo };
}

// A chainable Supabase query stub: every builder method returns the
// builder, awaiting it resolves to the supplied result, and `from` calls
// are counted so a test can prove the load is a single batched query.
function fakeSupabase(result: { data: unknown; error: unknown }) {
  let fromCalls = 0;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "is", "order", "eq"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (r: unknown) => void) => resolve(result);
  const client = {
    from: () => {
      fromCalls += 1;
      return builder;
    },
    get fromCalls() {
      return fromCalls;
    },
  };
  return client as unknown as Parameters<typeof loadJobsWithCover>[0] & {
    fromCalls: number;
  };
}

describe("shapeJobWithCover", () => {
  it("keeps an embedded cover-photo object on its job", () => {
    const cover = photo({ id: "cover-A" });
    const shaped = shapeJobWithCover(jobRow("job-A", cover));
    expect(shaped).toEqual({ id: "job-A", cover_photo: cover });
  });

  it("collapses a single-element array embed to one object", () => {
    const cover = photo({ id: "cover-A" });
    const shaped = shapeJobWithCover(jobRow("job-A", [cover]));
    expect(shaped.cover_photo).toEqual(cover);
  });

  it("shapes a job with no cover set as cover_photo: null", () => {
    expect(shapeJobWithCover(jobRow("j", null)).cover_photo).toBeNull();
    expect(shapeJobWithCover(jobRow("j", [])).cover_photo).toBeNull();
    expect(shapeJobWithCover(jobRow("j")).cover_photo).toBeNull();
  });
});

describe("loadJobsWithCover", () => {
  it("loads jobs in one batched query, each paired with its own cover", async () => {
    const coverA = photo({ id: "cover-A" });
    const coverB = photo({ id: "cover-B" });
    const supabase = fakeSupabase({
      data: [
        jobRow("job-A", coverA),
        jobRow("job-B", [coverB]),
        jobRow("job-C", null),
      ],
      error: null,
    });

    const jobs = await loadJobsWithCover(supabase);

    expect(supabase.fromCalls).toBe(1);
    expect(jobs.map((j) => [j.id, j.cover_photo?.id ?? null])).toEqual([
      ["job-A", "cover-A"],
      ["job-B", "cover-B"],
      ["job-C", null],
    ]);
  });

  it("returns an empty array when the query fails", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await loadJobsWithCover(supabase)).toEqual([]);
  });
});

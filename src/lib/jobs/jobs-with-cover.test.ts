import { describe, expect, it } from "vitest";

import type { Job, Photo } from "@/lib/types";
import {
  attachJobCounts,
  loadJobsWithCover,
  shapeJobWithCover,
} from "./jobs-with-cover";

// A full photo row. The loader and shaper pass it through untouched, so
// only `id` matters for the identity assertions below; the rest is here
// purely to satisfy the Photo type.
function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "photo-1",
    job_id: "job-1",
    storage_path: "job-1/original.jpg",
    annotated_path: null,
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

// A chainable Supabase query stub. Every builder method returns the
// builder; awaiting it resolves to the result registered for that table
// (an unregistered table resolves to an empty list). `fromTables` records
// the table of every `.from(...)` call, so a test can prove the load
// batches its queries rather than running one per job.
function fakeSupabase(
  tables: Record<string, { data: unknown; error: unknown }>,
) {
  const fromTables: string[] = [];
  const client = {
    from: (table: string) => {
      fromTables.push(table);
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "is", "order", "eq", "in"]) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (r: unknown) => void) => resolve(result);
      return builder;
    },
    get fromTables() {
      return fromTables;
    },
  };
  return client as unknown as Parameters<typeof loadJobsWithCover>[0] & {
    fromTables: string[];
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

// A minimal job — attachJobCounts only reads `id` and spreads the rest,
// so the other Job fields are irrelevant to the count-shaping behavior.
function job(id: string): Job {
  return { id } as Job;
}

describe("attachJobCounts", () => {
  it("attaches each job's photo count to the matching job", () => {
    const jobs = [job("job-A"), job("job-B")];
    const photoRows = [
      { job_id: "job-A" },
      { job_id: "job-A" },
      { job_id: "job-B" },
    ];

    const result = attachJobCounts(jobs, photoRows, []);

    expect(result.map((j) => [j.id, j.photo_count])).toEqual([
      ["job-A", 2],
      ["job-B", 1],
    ]);
  });

  it("keeps the file count distinct from the photo count", () => {
    const photoRows = [{ job_id: "job-A" }, { job_id: "job-A" }];
    const fileRows = [{ job_id: "job-A" }];

    const [result] = attachJobCounts([job("job-A")], photoRows, fileRows);

    expect(result.photo_count).toBe(2);
    expect(result.file_count).toBe(1);
  });

  it("gives a job with no photos or files a count of 0, not undefined", () => {
    const [result] = attachJobCounts([job("empty-job")], [], []);

    expect(result.photo_count).toBe(0);
    expect(result.file_count).toBe(0);
    expect(result.photo_count).not.toBeUndefined();
  });
});

describe("loadJobsWithCover", () => {
  it("loads jobs in one batched query, each paired with its own cover", async () => {
    const coverA = photo({ id: "cover-A" });
    const coverB = photo({ id: "cover-B" });
    const supabase = fakeSupabase({
      jobs: {
        data: [
          jobRow("job-A", coverA),
          jobRow("job-B", [coverB]),
          jobRow("job-C", null),
        ],
        error: null,
      },
    });

    const jobs = await loadJobsWithCover(supabase);

    // The cover photo is joined into the jobs query — one `jobs` read,
    // never one per job.
    expect(supabase.fromTables.filter((t) => t === "jobs")).toEqual(["jobs"]);
    expect(jobs.map((j) => [j.id, j.cover_photo?.id ?? null])).toEqual([
      ["job-A", "cover-A"],
      ["job-B", "cover-B"],
      ["job-C", null],
    ]);
  });

  it("returns an empty array when the query fails", async () => {
    const supabase = fakeSupabase({
      jobs: { data: null, error: { message: "boom" } },
    });
    expect(await loadJobsWithCover(supabase)).toEqual([]);
  });

  it("fetches photo and file counts batched, not one query per job", async () => {
    const supabase = fakeSupabase({
      jobs: {
        data: [jobRow("job-A"), jobRow("job-B"), jobRow("job-C")],
        error: null,
      },
      photos: {
        data: [
          { job_id: "job-A" },
          { job_id: "job-A" },
          { job_id: "job-B" },
        ],
        error: null,
      },
      job_files: { data: [{ job_id: "job-C" }], error: null },
    });

    const jobs = await loadJobsWithCover(supabase);

    // One read of each child table covers every job — never per-job.
    expect(supabase.fromTables.filter((t) => t === "photos")).toHaveLength(1);
    expect(supabase.fromTables.filter((t) => t === "job_files")).toHaveLength(
      1,
    );
    expect(jobs.map((j) => [j.id, j.photo_count, j.file_count])).toEqual([
      ["job-A", 2, 0],
      ["job-B", 1, 0],
      ["job-C", 0, 1],
    ]);
  });
});

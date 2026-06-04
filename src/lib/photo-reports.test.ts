// Issue #400 — Photo Report Rework, Slice 2a.
//
// `createPhotoReportDraft` is the server-side create step behind the Job Photos
// tab's "Create report" action: it numbers the report per Job, stamps the real
// preparer's name (not the old literal 'Eric'), seeds the one default Section
// from the selected photos, and inserts the draft row.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createPhotoReportDraft } from "./photo-reports";

// A chainable Supabase stub branching on table:
//   - photo_reports: the select chain (existing report numbers) is awaited and
//     resolves to `existing`; the insert chain captures its payload and
//     `.single()` echoes it back as the new row.
//   - photos: the select chain (.eq("job_id").in("id", ids)) resolves to the
//     subset of requested ids that "belong" to the Job. By default every
//     requested id is owned; pass `ownedPhotoIds` to simulate cross-Job/unknown
//     ids being filtered out.
// `inserted` exposes the captured insert payload so a test can assert exactly
// what was written.
function fakeSupabase(
  existing: Array<{ report_number: number | null }>,
  opts: { ownedPhotoIds?: string[] } = {},
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
      builder.is = () => builder;
      builder.insert = (payload: Record<string, unknown>) => {
        inserted = payload;
        return builder;
      };
      builder.single = async () => ({
        data: { id: "report-1", ...inserted },
        error: null,
      });
      builder.then = (resolve: (r: unknown) => void) => {
        if (table === "photos") {
          const owned = opts.ownedPhotoIds
            ? inIds.filter((id) => opts.ownedPhotoIds!.includes(id))
            : inIds;
          return resolve({ data: owned.map((id) => ({ id })), error: null });
        }
        return resolve({ data: existing, error: null });
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

describe("createPhotoReportDraft", () => {
  it("numbers the report after the Job's existing reports and stamps the preparer", async () => {
    const supabase = fakeSupabase([{ report_number: 1 }, { report_number: 2 }]);

    const report = await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1", "p2"],
    });

    expect(supabase.inserted).toMatchObject({
      organization_id: "org-1",
      job_id: "job-1",
      report_number: 3,
      created_by: "Eric Daniels",
      status: "draft",
    });
    expect(report.report_number).toBe(3);
  });

  it("numbers a Job's first report #1 and titles it accordingly by default", async () => {
    const supabase = fakeSupabase([]);

    const report = await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1"],
    });

    expect(supabase.inserted).toMatchObject({
      report_number: 1,
      title: "Photo Report #1",
    });
    expect(report.report_number).toBe(1);
  });

  it("seeds one default section holding the selected photos", async () => {
    const supabase = fakeSupabase([]);

    await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1", "p2", "p3"],
    });

    expect(supabase.inserted?.sections).toEqual([
      { title: "Photos", description: "", photo_ids: ["p1", "p2", "p3"] },
    ]);
  });

  it("seeds only photos that belong to the Job, dropping foreign ids in order", async () => {
    // The client asked for p1, p2, p3 but only p1 and p3 belong to this Job
    // (p2 is from another Job, or bogus). The report must seed just the owned
    // ids, preserving selection order.
    const supabase = fakeSupabase([], { ownedPhotoIds: ["p1", "p3"] });

    await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1", "p2", "p3"],
    });

    expect(supabase.inserted?.sections).toEqual([
      { title: "Photos", description: "", photo_ids: ["p1", "p3"] },
    ]);
  });

  it("honors an explicit title over the default", async () => {
    const supabase = fakeSupabase([]);

    await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1"],
      title: "Roof damage — initial",
    });

    expect(supabase.inserted).toMatchObject({ title: "Roof damage — initial" });
  });
});

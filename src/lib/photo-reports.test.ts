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
//   - photo_report_templates: the select chain ends in `.maybeSingle()`, which
//     resolves to `opts.template` (or null when the id resolves to nothing —
//     e.g. a deleted template or another Organization's id dropped by RLS).
// `inserted` exposes the captured insert payload so a test can assert exactly
// what was written.
function fakeSupabase(
  existing: Array<{ report_number: number | null }>,
  opts: {
    ownedPhotoIds?: string[];
    template?: Record<string, unknown> | null;
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
      builder.is = () => builder;
      builder.insert = (payload: Record<string, unknown>) => {
        inserted = payload;
        return builder;
      };
      builder.single = async () => ({
        data: { id: "report-1", ...inserted },
        error: null,
      });
      builder.maybeSingle = async () => ({
        data:
          table === "photo_report_templates" ? (opts.template ?? null) : null,
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

// A focused stub for the report-number retry path. The numbers read returns a
// different set on each call (modelling a competing click landing a row between
// our attempts), and the insert's `.single()` rejects `report_number === 3`
// with Postgres unique_violation (23505) — what the partial unique index throws
// when an active (job_id, report_number) already exists — succeeding otherwise.
function fakeSupabaseWithReportNumberConflict() {
  let inserted: Record<string, unknown> | null = null;
  let numbersRead = 0;
  const numbersByRead = [
    [{ report_number: 2 }], // first read → next #3
    [{ report_number: 2 }, { report_number: 3 }], // retry read → next #4
  ];
  const client = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => builder;
      builder.insert = (payload: Record<string, unknown>) => {
        inserted = payload;
        return builder;
      };
      builder.single = async () =>
        inserted?.report_number === 3
          ? {
              data: null,
              error: {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "photo_reports_job_report_number_key"',
              },
            }
          : { data: { id: "report-1", ...inserted }, error: null };
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.then = (resolve: (r: unknown) => void) => {
        if (table === "photos") {
          return resolve({ data: [], error: null });
        }
        const data = numbersByRead[Math.min(numbersRead, numbersByRead.length - 1)];
        numbersRead += 1;
        return resolve({ data, error: null });
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
      expect.objectContaining({
        title: "Photos",
        description: "",
        photo_ids: ["p1", "p2", "p3"],
      }),
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
      expect.objectContaining({
        title: "Photos",
        description: "",
        photo_ids: ["p1", "p3"],
      }),
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

  it("seeds Sections from a template (heading + boilerplate) and appends a Photos section for the selection", async () => {
    const supabase = fakeSupabase([], {
      template: {
        id: "tmpl-1",
        sections: [
          { title: "Findings", description: "<p>Findings boilerplate</p>" },
          { title: "Work Performed", description: "<p>Work boilerplate</p>" },
        ],
      },
    });

    await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1", "p2"],
      templateId: "tmpl-1",
    });

    // template_id is recorded as provenance only; the Sections come from the
    // template's boilerplate (with no photos), and the selected photos land in a
    // separate, appended Photos section the user can redistribute.
    expect(supabase.inserted?.template_id).toBe("tmpl-1");
    expect(supabase.inserted?.sections).toEqual([
      expect.objectContaining({
        title: "Findings",
        description: "<p>Findings boilerplate</p>",
        photo_ids: [],
      }),
      expect.objectContaining({
        title: "Work Performed",
        description: "<p>Work boilerplate</p>",
        photo_ids: [],
      }),
      expect.objectContaining({
        title: "Photos",
        description: "",
        photo_ids: ["p1", "p2"],
      }),
    ]);
  });

  it("still numbers per Job and stamps the preparer when starting from a template", async () => {
    const supabase = fakeSupabase([{ report_number: 4 }], {
      template: {
        id: "tmpl-1",
        sections: [{ title: "Findings", description: "<p>x</p>" }],
      },
    });

    const report = await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1"],
      templateId: "tmpl-1",
    });

    expect(supabase.inserted).toMatchObject({
      report_number: 5,
      created_by: "Eric Daniels",
      template_id: "tmpl-1",
    });
    expect(report.report_number).toBe(5);
  });

  it("omits the appended Photos section when no photos are selected", async () => {
    const supabase = fakeSupabase([], {
      template: {
        id: "tmpl-1",
        sections: [{ title: "Findings", description: "<p>x</p>" }],
      },
    });

    await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: [],
      templateId: "tmpl-1",
    });

    expect(supabase.inserted?.sections).toEqual([
      expect.objectContaining({
        title: "Findings",
        description: "<p>x</p>",
        photo_ids: [],
      }),
    ]);
  });

  it("retries with a fresh number when the report number collides", async () => {
    // Models two near-simultaneous "Create report" clicks on the same Job. Our
    // first attempt reads max #2 and mints #3, but a competing click already
    // committed #3, so the partial unique index rejects the insert with Postgres
    // unique_violation (23505). The retry re-reads the numbers — now including
    // the competitor's #3 — and mints #4, which inserts cleanly.
    const supabase = fakeSupabaseWithReportNumberConflict();

    const report = await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: [],
    });

    expect(report.report_number).toBe(4);
    expect(supabase.inserted).toMatchObject({
      report_number: 4,
      title: "Photo Report #4",
    });
  });

  it("falls back to a blank Photos section when the template id resolves to nothing", async () => {
    // template not found — deleted, or another Organization's id dropped by RLS.
    const supabase = fakeSupabase([], { template: null });

    await createPhotoReportDraft(supabase, {
      organizationId: "org-1",
      jobId: "job-1",
      preparerName: "Eric Daniels",
      photoIds: ["p1"],
      templateId: "ghost",
    });

    expect(supabase.inserted?.template_id).toBeNull();
    expect(supabase.inserted?.sections).toEqual([
      expect.objectContaining({
        title: "Photos",
        description: "",
        photo_ids: ["p1"],
      }),
    ]);
  });

  it("stamps each seeded Section with a stable id from the injected id factory (#467)", async () => {
    // Every Section the create step seeds — template boilerplate Sections and the
    // appended Photos section alike — gets a stable id so the builder can key its
    // list/dnd off it and old reports never need a backfill on first open. The
    // injected factory makes the ids deterministic to assert (default is a UUID).
    const supabase = fakeSupabase([], {
      template: {
        id: "tmpl-1",
        sections: [
          { title: "Findings", description: "<p>x</p>" },
          { title: "Work Performed", description: "<p>y</p>" },
        ],
      },
    });

    let n = 0;
    await createPhotoReportDraft(
      supabase,
      {
        organizationId: "org-1",
        jobId: "job-1",
        preparerName: "Eric Daniels",
        photoIds: ["p1"],
        templateId: "tmpl-1",
      },
      () => `sec-${++n}`,
    );

    const sections = supabase.inserted?.sections as Array<{ id: string }>;
    expect(sections.map((s) => s.id)).toEqual(["sec-1", "sec-2", "sec-3"]);
  });
});

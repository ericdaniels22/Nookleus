import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration-flavored test for the report generator's photos-per-page wiring
 * (issue #361). Supabase is mocked at the client boundary (@/lib/supabase), the
 * react-pdf renderer and the document component are stubbed so no real PDF is
 * produced, and the pure layout engine is spied so we can read the
 * photos-per-page it was handed.
 *
 * The seeded report carries a template_id and the seeded template advertises a
 * DIFFERENT photos_per_page (1) than Company Settings (4) — so any test that
 * expects the settings value proves the template no longer drives layout.
 */
const h = vi.hoisted(() => {
  const REPORT_ID = "report-1";
  const JOB_NUMBER = "JOB-123";
  const TEMPLATE_PHOTOS_PER_PAGE = 1;

  const state = {
    // value of the report_photos_per_page company_settings row; undefined = row absent
    companySettingsValue: "4" as string | undefined,
    fromTables: [] as string[],
    companySettingsKeys: [] as string[],
    uploads: [] as Array<{ bucket: string; path: string }>,
    templateQueried: false,
  };

  const reportRow = {
    id: REPORT_ID,
    title: "Roof Inspection",
    report_date: "2026-05-29",
    template_id: "tmpl-1",
    sections: [{ title: "Exterior", description: "", photo_ids: ["photo-1"] }],
    job: {
      id: "job-1",
      job_number: JOB_NUMBER,
      property_address: "123 Main St",
      claim_number: "CLM-9",
      insurance_company: "Acme Mutual",
      cover_photo_id: null,
      contact: { full_name: "Jane Doe" },
      cover_photo: null,
    },
  };

  const photoRows = [
    {
      id: "photo-1",
      storage_path: "p/photo-1.jpg",
      annotated_path: null,
      caption: null,
      before_after_pair_id: null,
      before_after_role: null,
      taken_at: null,
      taken_by: null,
      width: 100,
      height: 100,
    },
  ];

  function companyRows() {
    const rows: Array<{ key: string; value: string }> = [
      { key: "company_name", value: "Acme Restoration" },
      { key: "phone", value: "555-1212" },
      { key: "email", value: "ops@acme.test" },
      { key: "logo_path", value: "" },
    ];
    if (state.companySettingsValue !== undefined) {
      rows.push({
        key: "report_photos_per_page",
        value: state.companySettingsValue,
      });
    }
    return rows;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeQuery(table: string): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: () => q,
      update: () => q,
      eq: () => q,
      in: (col: string, vals: string[]) => {
        if (table === "company_settings" && col === "key") {
          state.companySettingsKeys = vals;
        }
        return q;
      },
      single: () => {
        if (table === "photo_report_templates") {
          state.templateQueried = true;
          return Promise.resolve({
            data: { photos_per_page: TEMPLATE_PHOTOS_PER_PAGE },
            error: null,
          });
        }
        if (table === "photo_reports") {
          return Promise.resolve({ data: reportRow, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (onFulfilled: any, onRejected: any) => {
        let result: { data: unknown; error: null };
        if (table === "company_settings") {
          result = { data: companyRows(), error: null };
        } else if (table === "photos") {
          result = { data: photoRows, error: null };
        } else {
          result = { data: null, error: null };
        }
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return q;
  }

  function makeClient() {
    return {
      from: (table: string) => {
        state.fromTables.push(table);
        return makeQuery(table);
      },
      storage: {
        from: (bucket: string) => ({
          upload: (path: string) => {
            state.uploads.push({ bucket, path });
            return Promise.resolve({ data: { path }, error: null });
          },
        }),
      },
    };
  }

  return { REPORT_ID, JOB_NUMBER, TEMPLATE_PHOTOS_PER_PAGE, state, makeClient };
});

vi.mock("@/lib/supabase", () => ({ createClient: () => h.makeClient() }));
vi.mock("@react-pdf/renderer", () => ({
  pdf: () => ({
    toBlob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
  }),
}));
vi.mock("@/components/report-pdf-document", () => ({ default: () => null }));
vi.mock("@/lib/build-report-document", () => ({
  buildReportDocument: vi.fn(() => []),
}));

import { generateReportPDF } from "./generate-report-pdf";
import { buildReportDocument } from "@/lib/build-report-document";

describe("generateReportPDF — photos-per-page wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.companySettingsValue = "4";
    h.state.fromTables = [];
    h.state.companySettingsKeys = [];
    h.state.uploads = [];
    h.state.templateQueried = false;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  });

  afterEach(() => {
    // Hermetic: don't leak the env stub into other files sharing this worker.
    vi.unstubAllEnvs();
  });

  it("hands buildReportDocument the photos-per-page from Company Settings, not the template", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(buildReportDocument).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(buildReportDocument).mock.calls[0][0];
    // Settings say 4; the seeded template says 1. The resolved value must be 4.
    expect(arg.photosPerPage).toBe(4);
  });

  it("loads report_photos_per_page among the Company Settings keys", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(h.state.companySettingsKeys).toContain("report_photos_per_page");
  });

  it("never queries photo_report_templates for layout", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(h.state.fromTables).not.toContain("photo_report_templates");
    expect(h.state.templateQueried).toBe(false);
  });

  it("defaults to 2 photos per page when the setting has never been set", async () => {
    h.state.companySettingsValue = undefined; // no report_photos_per_page row

    await generateReportPDF(h.REPORT_ID);

    const arg = vi.mocked(buildReportDocument).mock.calls[0][0];
    expect(arg.photosPerPage).toBe(2);
  });

  it("still generates a report carrying a template_id, using the global value", async () => {
    h.state.companySettingsValue = "1"; // company-wide setting

    const pdfPath = await generateReportPDF(h.REPORT_ID);

    // reportRow.template_id is "tmpl-1" (old template-bound flow), but layout
    // now comes from the global setting (1), not the template (1 here too, so
    // also assert the template was never consulted).
    expect(h.state.templateQueried).toBe(false);
    const arg = vi.mocked(buildReportDocument).mock.calls[0][0];
    expect(arg.photosPerPage).toBe(1);
    expect(pdfPath).toBe(`${h.JOB_NUMBER}/${h.REPORT_ID}.pdf`);
  });

  it("uploads the PDF to {job_number}/{reportId}.pdf in the reports bucket", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(h.state.uploads).toEqual([
      { bucket: "reports", path: `${h.JOB_NUMBER}/${h.REPORT_ID}.pdf` },
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration-flavored test for the report generator's render-model wiring
 * (#553). Supabase is mocked at the client boundary (@/lib/supabase), the
 * react-pdf renderer and the document component are stubbed so no real PDF is
 * produced, and the shared render-model builder is spied so we can read the
 * fully-assembled input the generator hands it: the resolved settings
 * (photos-per-page after the legacy 1→2 remap), the photos with their tags, and
 * the Job's property address.
 *
 * The seeded report carries a template_id and the seeded template advertises a
 * photos_per_page of its own — so any test that proves the layout came from
 * Company Settings also proves the template no longer drives layout.
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
    // Per-report look snapshot absent (pre-0014 / never edited): the resolver
    // must fall through to the Organization default and all-on cover.
    report_settings: null,
    cover_config: null,
    cover_photo_id: null,
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
      // Nested tag embed, as PostgREST returns it for
      // photo_tag_assignments(tag:photo_tags(name, color)).
      photo_tag_assignments: [
        { tag: { name: "Water Damage", color: "#1E90FF" } },
      ],
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
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
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
vi.mock("@/lib/report-render-model", () => ({
  buildReportRenderModel: vi.fn(() => ({
    title: "stub",
    cover: {
      title: "stub",
      logo: null,
      customerName: null,
      propertyAddress: null,
      pointOfContact: null,
      insurance: null,
      coverPhotoUrl: null,
    },
    pages: [],
  })),
}));

import { generateReportPDF, renderReportPdfBlob } from "./generate-report-pdf";
import { buildReportRenderModel } from "@/lib/report-render-model";

function modelArg() {
  return vi.mocked(buildReportRenderModel).mock.calls[0][0];
}

function resetState() {
  vi.clearAllMocks();
  h.state.companySettingsValue = "4";
  h.state.fromTables = [];
  h.state.companySettingsKeys = [];
  h.state.uploads = [];
  h.state.templateQueried = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
}

describe("generateReportPDF — render-model wiring", () => {
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

  it("hands the render model the photos-per-page from Company Settings, not the template", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(buildReportRenderModel).toHaveBeenCalledTimes(1);
    // Settings say 4; the seeded template says 1. The resolved value must be 4.
    expect(modelArg().settings.photosPerPage).toBe(4);
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

    expect(modelArg().settings.photosPerPage).toBe(2);
  });

  it("remaps the retired 1-per-page Company Setting to 2", async () => {
    h.state.companySettingsValue = "1"; // legacy single-photo layout

    const pdfPath = await generateReportPDF(h.REPORT_ID);

    // The retired 1-per-page layout normalizes to the 2-per-page default
    // (ADR 0014); the template (also 1 here) is never consulted.
    expect(h.state.templateQueried).toBe(false);
    expect(modelArg().settings.photosPerPage).toBe(2);
    expect(pdfPath).toBe(`${h.JOB_NUMBER}/${h.REPORT_ID}.pdf`);
  });

  it("threads each photo's tags onto the render-model input", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(modelArg().photos["photo-1"].tags).toEqual([
      { name: "Water Damage", color: "#1E90FF" },
    ]);
  });

  it("threads the Job's property address onto the render model", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(modelArg().propertyAddress).toBe("123 Main St");
  });

  it("uploads the PDF to {job_number}/{reportId}.pdf in the reports bucket", async () => {
    await generateReportPDF(h.REPORT_ID);

    expect(h.state.uploads).toEqual([
      { bucket: "reports", path: `${h.JOB_NUMBER}/${h.REPORT_ID}.pdf` },
    ]);
  });
});

describe("renderReportPdfBlob — shared no-drift producer (#554)", () => {
  beforeEach(resetState);
  afterEach(() => vi.unstubAllEnvs());

  it("returns a PDF blob without uploading or updating the report row", async () => {
    const blob = await renderReportPdfBlob(h.REPORT_ID);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");
    // Pure render: the Preview path must not touch storage or the report row.
    expect(h.state.uploads).toEqual([]);
  });

  it("feeds buildReportRenderModel the exact same args Generate does (no drift)", async () => {
    await renderReportPdfBlob(h.REPORT_ID);
    const previewArgs = modelArg();

    vi.mocked(buildReportRenderModel).mockClear();
    await generateReportPDF(h.REPORT_ID);
    const generateArgs = vi.mocked(buildReportRenderModel).mock.calls[0][0];

    // Identical render-model input => identical PDF. Preview == Generate.
    expect(previewArgs).toEqual(generateArgs);
  });
});

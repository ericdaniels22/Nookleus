// Issue #362 — Photo Report Rework, Slice 2.
//
// Behavior pinned here (from the issue's acceptance criteria):
//   - The report title field is visible without selecting a preset and
//     defaults to "Photo Report"; it remains editable.
//   - The preset picker is optional and labeled a "section preset"; selecting
//     one pre-fills section titles/descriptions and does NOT set photos-per-page.
//   - A user can add, rename, edit the description of, and remove a section.
//   - A report can be created and saved with manually-added sections and no
//     preset selected; save still requires at least one section.
//
// Supabase is mocked at the client boundary. The mock builder is both
// chainable (.select/.order/.eq/.insert) and awaitable (thenable), mirroring
// the real supabase-js query builder, and resolves per-table from `state`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  templates: [] as Array<Record<string, unknown>>,
  photos: [] as Array<Record<string, unknown>>,
  tags: [] as Array<Record<string, unknown>>,
  assignments: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase", () => {
  function createClient() {
    function from(table: string) {
      const resultFor = () => {
        switch (table) {
          case "jobs":
            return { data: state.jobs, error: null };
          case "photo_report_templates":
            return { data: state.templates, error: null };
          case "photo_tags":
            return { data: state.tags, error: null };
          case "photos":
            return { data: state.photos, error: null };
          case "photo_tag_assignments":
            return { data: state.assignments, error: null };
          case "photo_reports":
            return { data: { id: "new-report-id" }, error: null };
          default:
            return { data: [], error: null };
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
        insert: (payload: Record<string, unknown>) => {
          state.inserted.push({ table, payload });
          return chain;
        },
        single: () => Promise.resolve(resultFor()),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (resolve: any, reject: any) =>
          Promise.resolve(resultFor()).then(resolve, reject),
      };
      return chain;
    }
    return { from };
  }
  return { createClient };
});

vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: () => Promise.resolve("org-1"),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import NewReportPage from "./page";

function seedDefaults() {
  state.jobs = [
    {
      id: "job-1",
      job_number: "JOB-001",
      property_address: "123 Main St",
      claim_number: "CLM-1",
      insurance_company: "Acme",
    },
  ];
  state.templates = [];
  state.photos = [];
  state.tags = [];
  state.assignments = [];
  state.inserted = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: any confirm() prompt is accepted. Tests that exercise a decline
  // override this. jsdom's native confirm() returns false and warns, so we
  // replace it outright rather than spy (avoids spy nesting across tests).
  window.confirm = vi.fn(() => true);
  seedDefaults();
});

describe("NewReportPage — report title", () => {
  it("shows the title field without a preset, defaulting to 'Photo Report'", async () => {
    render(<NewReportPage />);

    // No preset is selected and none even exist; the title field must still be
    // present and pre-filled with the default.
    expect(await screen.findByDisplayValue("Photo Report")).toBeDefined();
  });
});

describe("NewReportPage — section preset picker", () => {
  it("labels the picker a 'section preset' and marks it optional", async () => {
    render(<NewReportPage />);

    expect(await screen.findByText(/section preset/i)).toBeDefined();
    expect(screen.getByText(/optional/i)).toBeDefined();
    // The old mandatory "Choose Template" framing is gone.
    expect(screen.queryByText(/choose template/i)).toBeNull();
  });
});

describe("NewReportPage — manual section editor", () => {
  it("lets the user add a manual section", async () => {
    render(<NewReportPage />);

    const addBtn = await screen.findByRole("button", { name: /add section/i });
    // No sections to start (no preset selected).
    expect(screen.queryByPlaceholderText(/section title/i)).toBeNull();

    fireEvent.click(addBtn);

    expect(screen.getByPlaceholderText(/section title/i)).toBeDefined();
  });

  it("supports the full add / rename / edit-description / remove lifecycle", async () => {
    render(<NewReportPage />);

    fireEvent.click(await screen.findByRole("button", { name: /add section/i }));

    // Rename.
    fireEvent.change(screen.getByPlaceholderText(/section title/i), {
      target: { value: "Roof Damage" },
    });
    expect(
      (screen.getByPlaceholderText(/section title/i) as HTMLInputElement).value,
    ).toBe("Roof Damage");

    // Edit description.
    fireEvent.change(screen.getByPlaceholderText(/description/i), {
      target: { value: "Shingles missing after the storm" },
    });
    expect(
      (screen.getByPlaceholderText(/description/i) as HTMLInputElement).value,
    ).toBe("Shingles missing after the storm");

    // Remove.
    fireEvent.click(screen.getByRole("button", { name: /remove section/i }));
    expect(screen.queryByPlaceholderText(/section title/i)).toBeNull();
  });
});

function seedPreset() {
  state.templates = [
    {
      id: "preset-1",
      name: "Adjuster Report",
      audience: "adjuster",
      sections: [
        { title: "Exterior", description: "Roof and siding" },
        { title: "Interior", description: "Water damage" },
      ],
      cover_page: {},
      photos_per_page: 4,
      created_by: "tester",
      created_at: "2026-05-29T00:00:00Z",
      updated_at: "2026-05-29T00:00:00Z",
    },
  ];
}

describe("NewReportPage — choosing a section preset", () => {
  it("pre-fills the section editor with the preset's titles and descriptions", async () => {
    seedPreset();
    render(<NewReportPage />);

    fireEvent.click(await screen.findByRole("button", { name: /adjuster report/i }));

    const titles = screen
      .getAllByPlaceholderText(/section title/i)
      .map((el) => (el as HTMLInputElement).value);
    expect(titles).toEqual(["Exterior", "Interior"]);

    const descriptions = screen
      .getAllByPlaceholderText(/description/i)
      .map((el) => (el as HTMLInputElement).value);
    expect(descriptions).toEqual(["Roof and siding", "Water damage"]);
  });

  it("does not let the preset drive the report title", async () => {
    seedPreset();
    render(<NewReportPage />);

    // Pick a job, then a preset — neither should rewrite the default title.
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "job-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adjuster report/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Photo Report")).toBeDefined();
    });
  });

  it("does not re-seed (wiping edits) when the active preset is clicked again", async () => {
    seedPreset();
    render(<NewReportPage />);

    fireEvent.click(await screen.findByRole("button", { name: /adjuster report/i }));
    // Rename a seeded section, then click the SAME preset again.
    fireEvent.change(screen.getAllByPlaceholderText(/section title/i)[0], {
      target: { value: "Custom Exterior" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adjuster report/i }));

    // The edit survives — re-clicking the active preset is a no-op.
    expect(
      (screen.getAllByPlaceholderText(/section title/i)[0] as HTMLInputElement)
        .value,
    ).toBe("Custom Exterior");
  });

  it("prompts before a different preset overwrites existing sections, and respects a decline", async () => {
    state.templates = [
      {
        id: "preset-1",
        name: "Adjuster Report",
        audience: "adjuster",
        sections: [
          { title: "Exterior", description: "Roof and siding" },
          { title: "Interior", description: "Water damage" },
        ],
        cover_page: {},
        photos_per_page: 4,
        created_by: "tester",
        created_at: "2026-05-29T00:00:00Z",
        updated_at: "2026-05-29T00:00:00Z",
      },
      {
        id: "preset-2",
        name: "Customer Summary",
        audience: "customer",
        sections: [{ title: "Summary", description: "Overview" }],
        cover_page: {},
        photos_per_page: 2,
        created_by: "tester",
        created_at: "2026-05-29T00:00:00Z",
        updated_at: "2026-05-29T00:00:00Z",
      },
    ];
    window.confirm = vi.fn(() => false);
    render(<NewReportPage />);

    // First pick seeds with no prompt (there were no sections to lose).
    fireEvent.click(await screen.findByRole("button", { name: /adjuster report/i }));
    expect(window.confirm).not.toHaveBeenCalled();

    // Switching to a different preset would discard the current sections — prompt.
    fireEvent.click(screen.getByRole("button", { name: /customer summary/i }));
    expect(window.confirm).toHaveBeenCalled();

    // Declined → the original sections are untouched.
    const titles = screen
      .getAllByPlaceholderText(/section title/i)
      .map((el) => (el as HTMLInputElement).value);
    expect(titles).toEqual(["Exterior", "Interior"]);
  });
});

// The step indicator and the bottom call-to-action share a label (e.g. both
// read "Select Photos"). Clicking the last match targets the bottom CTA, which
// is a no-op while disabled — so a failed gate keeps the wizard on its step.
function clickPrimary(name: RegExp) {
  const buttons = screen.getAllByRole("button", { name });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("NewReportPage — step gating", () => {
  it("advances past setup with a job and a manual section, no preset", async () => {
    render(<NewReportPage />);

    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "job-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    fireEvent.change(screen.getByPlaceholderText(/section title/i), {
      target: { value: "Roof" },
    });

    // No preset was ever selected.
    clickPrimary(/select photos/i);

    // Step 2 ("Select Photos") is now showing — its caption filter is present.
    expect(
      await screen.findByPlaceholderText(/filter by caption/i),
    ).toBeDefined();
  });

  it("blocks advancing past setup when no section exists", async () => {
    render(<NewReportPage />);

    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "job-1" },
    });

    // Job selected but zero sections — the gate must hold.
    clickPrimary(/select photos/i);

    expect(screen.queryByPlaceholderText(/filter by caption/i)).toBeNull();
  });
});

describe("NewReportPage — saving", () => {
  it("creates and saves a report with manual sections and no preset", async () => {
    state.photos = [
      {
        id: "photo-1",
        job_id: "job-1",
        media_type: "photo",
        caption: "Front door",
        before_after_role: null,
        storage_path: "p1.jpg",
        annotated_path: null,
      },
    ];
    render(<NewReportPage />);

    // Step 1 — job + a manual section, no preset.
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "job-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    fireEvent.change(screen.getByPlaceholderText(/section title/i), {
      target: { value: "Roof" },
    });
    clickPrimary(/select photos/i);

    // Step 2 — pick the photo so we can reach the assignment step.
    fireEvent.click(await screen.findByRole("button", { name: /front door/i }));
    clickPrimary(/assign to sections/i);

    // Step 3 — save the draft.
    clickPrimary(/save draft report/i);

    await waitFor(() => {
      expect(
        state.inserted.find((i) => i.table === "photo_reports"),
      ).toBeDefined();
    });

    const payload = state.inserted.find(
      (i) => i.table === "photo_reports",
    )!.payload;
    expect(payload.template_id).toBeNull();
    expect(payload.title).toBe("Photo Report");
    expect(payload.status).toBe("draft");
    expect(payload.sections).toEqual([
      { title: "Roof", description: "", photo_ids: [] },
    ]);
    expect(payload).not.toHaveProperty("photos_per_page");
  });

  it("saves a preset-seeded report with the preset id but no photos-per-page", async () => {
    seedPreset();
    state.photos = [
      {
        id: "photo-1",
        job_id: "job-1",
        media_type: "photo",
        caption: "Front door",
        before_after_role: null,
        storage_path: "p1.jpg",
        annotated_path: null,
      },
    ];
    render(<NewReportPage />);

    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "job-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adjuster report/i }));
    clickPrimary(/select photos/i);

    fireEvent.click(await screen.findByRole("button", { name: /front door/i }));
    clickPrimary(/assign to sections/i);
    clickPrimary(/save draft report/i);

    await waitFor(() => {
      expect(
        state.inserted.find((i) => i.table === "photo_reports"),
      ).toBeDefined();
    });

    const payload = state.inserted.find(
      (i) => i.table === "photo_reports",
    )!.payload;
    // Preset provenance is recorded...
    expect(payload.template_id).toBe("preset-1");
    // ...sections came from the preset...
    expect(payload.sections).toEqual([
      { title: "Exterior", description: "Roof and siding", photo_ids: [] },
      { title: "Interior", description: "Water damage", photo_ids: [] },
    ]);
    // ...but the preset set neither a title nor a photos-per-page on the report.
    expect(payload.title).toBe("Photo Report");
    expect(payload).not.toHaveProperty("photos_per_page");
  });

  it("cannot create a report once every section has been removed", async () => {
    // AC5's "save still requires at least one section" — exercised end-to-end.
    // After deleting the only section, the setup gate closes again, the save
    // step is unreachable, and no photo_reports row is ever inserted.
    state.photos = [
      {
        id: "photo-1",
        job_id: "job-1",
        media_type: "photo",
        caption: "Front door",
        before_after_role: null,
        storage_path: "p1.jpg",
        annotated_path: null,
      },
    ];
    render(<NewReportPage />);

    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "job-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    fireEvent.change(screen.getByPlaceholderText(/section title/i), {
      target: { value: "Roof" },
    });
    clickPrimary(/select photos/i);
    fireEvent.click(await screen.findByRole("button", { name: /front door/i }));
    clickPrimary(/assign to sections/i);

    // Back to setup and delete the only section.
    fireEvent.click(screen.getByRole("button", { name: /setup/i }));
    fireEvent.click(await screen.findByRole("button", { name: /remove section/i }));

    // The gate now refuses to advance, so save is unreachable...
    clickPrimary(/select photos/i);
    expect(screen.queryByPlaceholderText(/filter by caption/i)).toBeNull();
    // ...and nothing was ever written.
    expect(
      state.inserted.find((i) => i.table === "photo_reports"),
    ).toBeUndefined();
  });
});

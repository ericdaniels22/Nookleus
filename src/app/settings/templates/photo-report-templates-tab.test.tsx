// Issue #405 — Photo Report Rework: template management moved into Settings.
//
// The "Photo Report Templates" tab lists the Organization's templates, lets the
// owner create / edit / delete them, and seeds the Findings + Work Performed
// defaults. These tests pin the list render and that "Add Defaults" seeds the
// canonical defaults, each scoped to the active Organization.
//
// Issue #440 — the builder is mounted persistently in this tab, so the form must
// reseed from `editingTemplate` every time the dialog opens (its useState
// initializers run once per mount). These tests render the real builder (not a
// stub) and exercise the Edit / New transitions, asserting the visible form.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  insertMock: vi.fn<(payload: unknown) => void>(),
  updateMock: vi.fn<(payload: unknown) => void>(),
  updateTargetId: null as string | null,
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: h.templates, error: null }),
        }),
      }),
      insert: (payload: unknown) => {
        h.insertMock(payload);
        return Promise.resolve({ error: null });
      },
      update: (payload: unknown) => {
        h.updateMock(payload);
        return {
          eq: (col: string, val: string) => {
            if (col === "id") h.updateTargetId = val;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      },
      delete: () => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(async () => "org-1"),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The Section boilerplate uses the shared TipTap editor; stub it with a textarea
// mirroring its contract (seeded from `content`, emits HTML via `onChange`).
vi.mock("@/components/tiptap-editor", () => ({
  default: ({
    content,
    onChange,
    placeholder,
  }: {
    content: string;
    onChange: (html: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="boilerplate-editor"
      placeholder={placeholder}
      defaultValue={content}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import React from "react";
import { PhotoReportTemplatesTab } from "./photo-report-templates-tab";

const INSPECTION = {
  id: "t-insp",
  name: "Inspection Report",
  sections: [
    { title: "Exterior", description: "<p>ext</p>" },
    { title: "Interior", description: "<p>int</p>" },
  ],
  created_at: "2026-06-04T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.templates = [];
  h.updateTargetId = null;
});

describe("PhotoReportTemplatesTab", () => {
  it("lists the Organization's Photo Report templates", async () => {
    h.templates = [
      {
        id: "t1",
        name: "Findings",
        sections: [{ title: "Findings", description: "<p>x</p>" }],
        created_at: "2026-06-04T00:00:00Z",
      },
      {
        id: "t2",
        name: "Work Performed",
        sections: [{ title: "Work Performed", description: "<p>y</p>" }],
        created_at: "2026-06-04T00:00:00Z",
      },
    ];

    render(<PhotoReportTemplatesTab />);

    expect(await screen.findByText("Findings")).toBeDefined();
    expect(screen.getByText("Work Performed")).toBeDefined();
  });

  it("seeds the Findings and Work Performed defaults via Add Defaults", async () => {
    h.templates = [];

    render(<PhotoReportTemplatesTab />);

    const addDefaults = await screen.findByRole("button", {
      name: /add defaults/i,
    });
    fireEvent.click(addDefaults);

    await waitFor(() => expect(h.insertMock).toHaveBeenCalledTimes(1));
    const seeded = h.insertMock.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    const names = seeded.map((t) => t.name);
    expect(names).toContain("Findings");
    expect(names).toContain("Work Performed");
    for (const row of seeded) {
      expect(row.organization_id).toBe("org-1");
    }
  });

  it("opens the builder pre-filled with the template's name and every section on Edit", async () => {
    h.templates = [INSPECTION];

    render(<PhotoReportTemplatesTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /edit inspection report/i }),
    );

    // Name reseeded from the edited template.
    expect(await screen.findByDisplayValue("Inspection Report")).toBeDefined();
    // Every one of the template's sections is shown, not a single blank one.
    expect(screen.getByDisplayValue("Exterior")).toBeDefined();
    expect(screen.getByDisplayValue("Interior")).toBeDefined();
    expect(screen.getAllByPlaceholderText("Section heading")).toHaveLength(2);
  });

  it("opens an empty form with one blank section on New right after editing", async () => {
    h.templates = [INSPECTION];

    render(<PhotoReportTemplatesTab />);

    // Edit first so the builder is seeded with a template.
    fireEvent.click(
      await screen.findByRole("button", { name: /edit inspection report/i }),
    );
    expect(await screen.findByDisplayValue("Inspection Report")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    // New must not inherit the just-edited template's data.
    fireEvent.click(screen.getByRole("button", { name: /new template/i }));

    const nameInput = (await screen.findByPlaceholderText(
      "e.g. Findings",
    )) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    const headings = screen.getAllByPlaceholderText(
      "Section heading",
    ) as HTMLInputElement[];
    expect(headings).toHaveLength(1);
    expect(headings[0].value).toBe("");
  });

  it("reseeds with the template's data on Edit right after opening New", async () => {
    h.templates = [INSPECTION];

    render(<PhotoReportTemplatesTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /new template/i }),
    );
    const nameInput = (await screen.findByPlaceholderText(
      "e.g. Findings",
    )) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /edit inspection report/i }),
    );
    expect(await screen.findByDisplayValue("Inspection Report")).toBeDefined();
    expect(screen.getByDisplayValue("Exterior")).toBeDefined();
  });

  it("does not carry a discarded New draft into the next New", async () => {
    render(<PhotoReportTemplatesTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /new template/i }),
    );
    const draft = (await screen.findByPlaceholderText(
      "e.g. Findings",
    )) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "Discarded draft" } });
    expect(draft.value).toBe("Discarded draft");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    fireEvent.click(screen.getByRole("button", { name: /new template/i }));
    const fresh = (await screen.findByPlaceholderText(
      "e.g. Findings",
    )) as HTMLInputElement;
    expect(fresh.value).toBe("");
  });

  it("saves an edited template via update on the same id, not a new insert", async () => {
    h.templates = [INSPECTION];

    render(<PhotoReportTemplatesTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /edit inspection report/i }),
    );
    const nameInput = await screen.findByDisplayValue("Inspection Report");
    fireEvent.change(nameInput, { target: { value: "Inspection Report v2" } });

    fireEvent.click(screen.getByRole("button", { name: /update template/i }));

    await waitFor(() => expect(h.updateMock).toHaveBeenCalledTimes(1));
    expect(h.insertMock).not.toHaveBeenCalled();
    expect(h.updateTargetId).toBe("t-insp");
    expect(h.updateMock.mock.calls[0][0]).toMatchObject({
      name: "Inspection Report v2",
    });
  });
});

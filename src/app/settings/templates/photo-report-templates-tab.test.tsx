// Issue #405 — Photo Report Rework: template management moved into Settings.
//
// The "Photo Report Templates" tab lists the Organization's templates, lets the
// owner create / edit / delete them, and seeds the Findings + Work Performed
// defaults. These tests pin the list render and that "Add Defaults" seeds the
// canonical defaults, each scoped to the active Organization.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  insertMock: vi.fn<(payload: unknown) => void>(),
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

// The builder is a heavy TipTap/dialog component tested on its own; stub it out.
vi.mock("@/components/report-template-builder", () => ({ default: () => null }));

import React from "react";
import { PhotoReportTemplatesTab } from "./photo-report-templates-tab";

beforeEach(() => {
  vi.clearAllMocks();
  h.templates = [];
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
});

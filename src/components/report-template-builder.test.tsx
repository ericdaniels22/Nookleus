// Issue #405 — Photo Report Rework: Photo Report templates upgraded + moved to
// Settings.
//
// The template builder is now a simple editor: a name plus an ordered list of
// Sections, each a heading + boilerplate write-up authored in the same TipTap
// editor a report Section uses. The post-rework model drops the audience /
// cover-page / photos-per-page knobs (dead at render — ADR 0009), so these tests
// pin that the save payload is just `{ name, sections, organization_id }` with
// the boilerplate HTML on each Section, and that the retired knobs are gone.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  insertMock: vi.fn<(payload: Record<string, unknown>) => void>(),
  updateMock: vi.fn<(payload: Record<string, unknown>) => void>(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        h.insertMock(payload);
        return Promise.resolve({ error: null });
      },
      update: (payload: Record<string, unknown>) => {
        h.updateMock(payload);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
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
import ReportTemplateBuilder from "./report-template-builder";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportTemplateBuilder", () => {
  it("saves a template as name + Sections with rich-text boilerplate, omitting the retired knobs", async () => {
    render(
      <ReportTemplateBuilder
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
        editTemplate={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. Findings"), {
      target: { value: "Findings" },
    });
    fireEvent.change(screen.getByPlaceholderText("Section heading"), {
      target: { value: "Findings" },
    });
    fireEvent.change(screen.getByTestId("boilerplate-editor"), {
      target: { value: "<p>What the inspection found.</p>" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(h.insertMock).toHaveBeenCalledTimes(1));
    const payload = h.insertMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Findings",
      organization_id: "org-1",
      sections: [
        { title: "Findings", description: "<p>What the inspection found.</p>" },
      ],
    });
    // The retired knobs must not be written.
    expect(payload).not.toHaveProperty("audience");
    expect(payload).not.toHaveProperty("cover_page");
    expect(payload).not.toHaveProperty("photos_per_page");
  });

  it("does not render the retired audience / cover page / photos-per-page controls", () => {
    render(
      <ReportTemplateBuilder
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
        editTemplate={null}
      />,
    );

    expect(screen.queryByText(/audience/i)).toBeNull();
    expect(screen.queryByText(/cover page/i)).toBeNull();
    expect(screen.queryByText(/photos per page/i)).toBeNull();
  });
});

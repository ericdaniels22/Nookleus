// Issue #400 — Photo Report Rework, Slice 2a.
//
// Auto-save behavior for the in-Job Photo Report builder: editing persists a
// debounced write with no explicit Save click, and nothing is written until an
// edit actually happens. Mounts the real builder and drives it through the DOM,
// mocking the Supabase client (to capture the write), next/navigation, sonner,
// and the PDF generator. Follows the RTL pattern in estimate-drag-end.test.tsx.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import type { Photo, PhotoReport } from "@/lib/types";

// Shared mock state. `manual` makes each .update().eq() return a promise that
// only resolves when the test pops a resolver off `resolvers` — that lets a test
// hold a save "in flight" while it drives another edit. Default (manual=false)
// resolves immediately, which is all the happy-path tests need.
const h = vi.hoisted(() => ({
  updateMock: vi.fn<(payload: Record<string, unknown>) => void>(),
  manual: false,
  resolvers: [] as Array<() => void>,
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        h.updateMock(payload);
        return {
          eq: () =>
            h.manual
              ? new Promise<{ error: null }>((resolve) =>
                  h.resolvers.push(() => resolve({ error: null })),
                )
              : Promise.resolve({ error: null }),
        };
      },
    }),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/generate-report-pdf", () => ({
  generateReportPDF: vi.fn(async () => "job-1/report-1.pdf"),
}));

// The section write-up uses the shared TipTap editor (issue #403). It is heavy,
// contenteditable-driven, and tested elsewhere; here we stub it with a textarea
// that mirrors its real contract — seeded once from `content`, emitting HTML via
// `onChange` — so we can assert the builder loads and persists the write-up HTML.
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
      data-testid="tiptap-stub"
      aria-label="Section write-up"
      placeholder={placeholder}
      defaultValue={content}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import PhotoReportBuilder from "./photo-report-builder";

function makeReport(overrides: Partial<PhotoReport> = {}): PhotoReport {
  return {
    id: "report-1",
    organization_id: "org-1",
    job_id: "job-1",
    template_id: null,
    title: "Photo Report #1",
    report_number: 1,
    report_date: "2026-06-04",
    sections: [{ title: "Photos", description: "", photo_ids: ["p1"] }],
    pdf_path: null,
    status: "draft",
    created_by: "Eric Daniels",
    created_at: "2026-06-04T00:00:00Z",
    updated_at: "2026-06-04T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

const noPhotos: Photo[] = [];

function renderBuilder(report = makeReport()) {
  return render(
    <PhotoReportBuilder
      jobId="job-1"
      report={report}
      photos={noPhotos}
      supabaseUrl="https://example.supabase.co"
    />,
  );
}

describe("PhotoReportBuilder auto-save", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    vi.useFakeTimers();
  });

  it("persists an edited title automatically, with no Save button", async () => {
    renderBuilder();

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();

    const titleInput = screen.getByLabelText("Report title");
    act(() => {
      fireEvent.change(titleInput, { target: { value: "Roof damage report" } });
    });

    // No write before the debounce elapses.
    expect(h.updateMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Roof damage report" }),
    );
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("writes nothing when the report is left untouched", async () => {
    renderBuilder();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(h.updateMock).not.toHaveBeenCalled();
  });

  it("does not drop an edit made while an earlier save is in flight", async () => {
    h.manual = true;
    renderBuilder();

    const titleInput = screen.getByLabelText("Report title");

    // First edit -> debounce fires -> save of "A" goes in flight (held open).
    act(() => {
      fireEvent.change(titleInput, { target: { value: "A" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "A" }),
    );
    expect(h.resolvers).toHaveLength(1);

    // Second edit lands WHILE the save of "A" is still in flight.
    act(() => {
      fireEvent.change(titleInput, { target: { value: "AB" } });
    });

    // The stale save of "A" now resolves. It must NOT mark the report clean,
    // because "AB" has not been persisted yet.
    await act(async () => {
      h.resolvers[0]();
      await vi.advanceTimersByTimeAsync(0);
    });

    // The newer "AB" edit still gets its own debounced save.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(2);
    expect(h.updateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "AB" }),
    );

    // Once that final save resolves, the builder settles to Saved.
    await act(async () => {
      h.resolvers[1]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("loads the section write-up into the rich-text editor and auto-saves edits as HTML", async () => {
    renderBuilder(
      makeReport({
        sections: [
          {
            title: "Findings",
            description: "<p>Existing finding</p>",
            photo_ids: ["p1"],
          },
        ],
      }),
    );

    // The existing write-up is handed to the TipTap editor for editing.
    const editor = screen.getByTestId("tiptap-stub") as HTMLTextAreaElement;
    expect(editor.value).toBe("<p>Existing finding</p>");

    // Editing emits HTML; the debounced auto-save persists it into the section's
    // `description` with no explicit Save, exactly like the title field.
    act(() => {
      fireEvent.change(editor, {
        target: { value: "<p>Existing finding</p><ul><li>New item</li></ul>" },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: { description: string }[];
    };
    expect(payload.sections[0].description).toBe(
      "<p>Existing finding</p><ul><li>New item</li></ul>",
    );
  });
});

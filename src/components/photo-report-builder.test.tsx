// Issue #401 — Photo Report Rework, Slice 2b (extends #400, Slice 2a).
//
// Behavior of the in-Job Photo Report builder driven through the DOM: auto-save
// (a debounced write with no explicit Save click, nothing written until an edit
// happens) plus the slice-2b Section-management and photo-assignment operations
// (add section, drag a photo into a section, remove a photo, reorder, remove a
// section). Mounts the real builder, mocking the Supabase client (to capture the
// write), @dnd-kit/core's DndContext (to capture onDragEnd), next/navigation,
// sonner, and the PDF generator. Follows the RTL pattern in
// estimate-drag-end.test.tsx.

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

// Mock @dnd-kit/core's DndContext to a passthrough that captures the real
// onDragEnd, so a test can fire a synthetic drag without a pointer (the dnd-kit
// RTL pattern from estimate-drag-end.test.tsx). The sortable hooks tolerate the
// absent provider and render fine.
let capturedOnDragEnd: ((e: unknown) => void) | null = null;
vi.mock("@dnd-kit/core", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd?: (e: unknown) => void;
    }) => {
      capturedOnDragEnd = onDragEnd ?? null;
      return <>{children}</>;
    },
  };
});

import React from "react";
import PhotoReportBuilder from "./photo-report-builder";
import { WRITEUP_CHARACTER_LIMIT } from "@/lib/section-writeup-fit";

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

function makePhoto(id: string): Photo {
  return {
    id,
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption: null,
  } as Photo;
}

function renderBuilder(report = makeReport(), photos: Photo[] = noPhotos) {
  return render(
    <PhotoReportBuilder
      jobId="job-1"
      report={report}
      photos={photos}
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

describe("PhotoReportBuilder section + photo management", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    capturedOnDragEnd = null;
    vi.useFakeTimers();
  });

  function lastSavedSections() {
    const calls = h.updateMock.mock.calls;
    return calls[calls.length - 1][0].sections as Array<{
      title: string;
      description: string;
      photo_ids: string[];
    }>;
  }

  it("adds a section and auto-saves it", async () => {
    renderBuilder();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const sections = lastSavedSections();
    expect(sections).toHaveLength(2);
    expect(sections[1].title).toBe("New section");
  });

  it("assigns a photo dragged from the tray into a section and auto-saves", async () => {
    const report = makeReport({
      sections: [{ title: "Photos", description: "", photo_ids: [] }],
    });
    renderBuilder(report, [makePhoto("p2")]);

    // Synthetic drag of the tray photo p2 onto section 0 (no pointer needed).
    act(() => {
      capturedOnDragEnd?.({
        active: {
          id: "p2",
          data: { current: { type: "photo", photoId: "p2" } },
        },
        over: {
          id: "section-0",
          data: { current: { type: "section", index: 0 } },
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(lastSavedSections()[0].photo_ids).toEqual(["p2"]);
  });

  it("removes a photo from the report and auto-saves", async () => {
    const report = makeReport({
      sections: [{ title: "Photos", description: "", photo_ids: ["p1"] }],
    });
    renderBuilder(report, [makePhoto("p1")]);

    act(() => {
      fireEvent.click(screen.getByLabelText("Remove photo from report"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(lastSavedSections()[0].photo_ids).toEqual([]);
  });

  it("reorders sections via drag and auto-saves the new order", async () => {
    const report = makeReport({
      sections: [
        { title: "A", description: "", photo_ids: [] },
        { title: "B", description: "", photo_ids: [] },
      ],
    });
    renderBuilder(report);

    act(() => {
      capturedOnDragEnd?.({
        active: { id: "section-0", data: { current: { type: "section", index: 0 } } },
        over: { id: "section-1", data: { current: { type: "section", index: 1 } } },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(lastSavedSections().map((s) => s.title)).toEqual(["B", "A"]);
  });

  it("confirms before removing a section with photos, dropping its photos on confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const report = makeReport({
      sections: [{ title: "Photos", description: "", photo_ids: ["p1"] }],
    });
    renderBuilder(report, [makePhoto("p1")]);

    act(() => {
      fireEvent.click(screen.getByLabelText("Remove section"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(lastSavedSections()).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it("keeps a photo-bearing section when the remove is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const report = makeReport({
      sections: [{ title: "Photos", description: "", photo_ids: ["p1"] }],
    });
    renderBuilder(report, [makePhoto("p1")]);

    act(() => {
      fireEvent.click(screen.getByLabelText("Remove section"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(h.updateMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("never persists an empty report date, but still saves a valid one", async () => {
    renderBuilder();
    const dateInput = screen.getByLabelText("Report date");

    // Clearing the native date picker must not trigger a (failing) save.
    act(() => {
      fireEvent.change(dateInput, { target: { value: "" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).not.toHaveBeenCalled();

    // A real date still persists.
    act(() => {
      fireEvent.change(dateInput, { target: { value: "2026-07-01" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ report_date: "2026-07-01" }),
    );
  });

  it("counts only photos that still exist in a section's label", () => {
    const report = makeReport({
      sections: [{ title: "Photos", description: "", photo_ids: ["p1", "ghost"] }],
    });
    renderBuilder(report, [makePhoto("p1")]);

    // "ghost" no longer resolves to a Photo, so the label shows 1, not 2.
    const label = screen.getByText(
      (_, el) =>
        el?.tagName === "P" && (el.textContent ?? "").startsWith("1 photo"),
    );
    expect(label).toBeTruthy();
  });
});

describe("PhotoReportBuilder write-up fit counter", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
  });

  it("shows a live write-up character counter per section", () => {
    renderBuilder(
      makeReport({
        sections: [
          { title: "Findings", description: "<p>Hello</p>", photo_ids: [] },
        ],
      }),
    );

    const counter = screen.getByTestId("writeup-counter-0");
    // "Hello" is 5 visible characters, measured against the one-page limit.
    // Assert against the delimiter so the "5" can't be satisfied by the "5" in
    // "1500" (a tautology if we only checked toContain("5")).
    expect(counter.textContent).toContain(`5 / ${WRITEUP_CHARACTER_LIMIT}`);
  });

  it("updates the counter live as the write-up is edited", () => {
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    expect(screen.getByTestId("writeup-counter-0").textContent).toContain(
      `0 / ${WRITEUP_CHARACTER_LIMIT}`,
    );

    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: { value: "<p>abcd</p>" },
      });
    });

    expect(screen.getByTestId("writeup-counter-0").textContent).toContain(
      `4 / ${WRITEUP_CHARACTER_LIMIT}`,
    );
  });

  it("gives each section its own independent counter", () => {
    renderBuilder(
      makeReport({
        sections: [
          { title: "A", description: "<p>Hello</p>", photo_ids: [] },
          { title: "B", description: "<p>Hi</p>", photo_ids: [] },
        ],
      }),
    );

    expect(screen.getByTestId("writeup-counter-0").textContent).toContain(
      `5 / ${WRITEUP_CHARACTER_LIMIT}`,
    );
    expect(screen.getByTestId("writeup-counter-1").textContent).toContain(
      `2 / ${WRITEUP_CHARACTER_LIMIT}`,
    );
  });

  it("flags a write-up that is over the one-page limit, with the overflow amount", () => {
    const tooLong = `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 50)}</p>`;
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: tooLong, photo_ids: [] }],
      }),
    );

    const counter = screen.getByTestId("writeup-counter-0");
    // Pin the magnitude, not just the presence of the word "over".
    expect(counter.textContent).toContain("50 over");
  });
});

describe("PhotoReportBuilder unmount flush (#443)", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    vi.useFakeTimers();
  });

  it("flushes the pending edit when the builder unmounts within the debounce window", () => {
    const { unmount } = renderBuilder();

    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Roof damage report" },
      });
    });

    // Unmount BEFORE the 2s debounce elapses — the autosave timer has not fired,
    // so nothing has been written yet (this is the lost-edit window in #443).
    expect(h.updateMock).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    // The pending dirty edit is flushed on unmount, persisting the last edit.
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Roof damage report" }),
    );
  });

  it("does not flush when the builder was never edited", () => {
    const { unmount } = renderBuilder();

    // No edit happened, so the report is not dirty — unmounting must not write.
    act(() => {
      unmount();
    });

    expect(h.updateMock).not.toHaveBeenCalled();
  });

  it("does not flush an over-limit write-up on unmount", () => {
    const { unmount } = renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: { value: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>` },
      });
    });

    // The write-up overflows its one-page intro, so the report is dirty but
    // blocked. The flush must honour the same save-time guard (#404) as the
    // debounced save and refuse to persist the over-limit content.
    act(() => {
      unmount();
    });

    expect(h.updateMock).not.toHaveBeenCalled();
  });
});

describe("PhotoReportBuilder save-time guard", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    vi.useFakeTimers();
  });

  it("does not persist a write-up that is over the one-page limit", async () => {
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: {
          value: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`,
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/can't save/i)).toBeTruthy();
  });

  it("resumes saving once an over-limit write-up is trimmed back under", async () => {
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );
    const editor = screen.getByTestId("tiptap-stub");

    // Over the limit → blocked, nothing written.
    act(() => {
      fireEvent.change(editor, {
        target: {
          value: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`,
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).not.toHaveBeenCalled();

    // Trimmed back under → the next debounce persists it.
    act(() => {
      fireEvent.change(editor, { target: { value: "<p>short</p>" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: { description: string }[];
    };
    expect(payload.sections[0].description).toBe("<p>short</p>");
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("blocks the whole save when any one section is over the limit", async () => {
    renderBuilder(
      makeReport({
        sections: [
          { title: "A", description: "<p>fine</p>", photo_ids: [] },
          {
            title: "B",
            description: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`,
            photo_ids: [],
          },
        ],
      }),
    );

    // Edit an unrelated field (the title) to make the report dirty without
    // touching the overflowing section: the save is still held back.
    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Renamed report" },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/can't save/i)).toBeTruthy();
  });

  it("persists a write-up that is exactly at the limit", async () => {
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    const atLimit = `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT)}</p>`;
    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: { value: atLimit },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: { description: string }[];
    };
    expect(payload.sections[0].description).toBe(atLimit);
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("keeps the blocked status when a stale in-flight save resolves after an over-limit edit", async () => {
    h.manual = true;
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    // A valid edit goes in flight and is held open ("Saving…").
    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Valid title" },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.resolvers).toHaveLength(1);
    expect(screen.getByText(/saving/i)).toBeTruthy();

    // Before it resolves, the write-up goes over the limit → next debounce blocks
    // and writes nothing new.
    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: {
          value: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`,
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(/can't save/i)).toBeTruthy();
    expect(h.updateMock).toHaveBeenCalledTimes(1);

    // The stale valid save now resolves. It must NOT flip the badge to "Saved" —
    // the over-limit content was never persisted.
    await act(async () => {
      h.resolvers[0]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.getByText(/can't save/i)).toBeTruthy();
  });
});

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

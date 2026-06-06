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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

import type { Photo, PhotoReport } from "@/lib/types";

// Shared mock state. `manual` makes each .update().eq() return a promise that
// only resolves when the test pops a resolver off `resolvers` — that lets a test
// hold a save "in flight" while it drives another edit. Default (manual=false)
// resolves immediately, which is all the happy-path tests need.
const h = vi.hoisted(() => ({
  updateMock: vi.fn<(payload: Record<string, unknown>) => void>(),
  manual: false,
  resolvers: [] as Array<() => void>,
  // When true, every save resolves with a Supabase error, so a test can drive
  // the failed-save path (issue #441: a failed flush must not yield a PDF).
  errorOnSave: false,
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        h.updateMock(payload);
        return {
          eq: () =>
            h.errorOnSave
              ? Promise.resolve({ error: { message: "save failed" } })
              : h.manual
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

// Record the id each SortableSection registers with dnd-kit, so a test can assert
// sections are keyed off their stable `section.id` (not the array index) — the
// mechanism behind smooth reorder animation (#467, AC2). The wrapper delegates to
// the real hook, so rendering behaves exactly as in production.
let capturedSortableIds: string[] = [];
vi.mock("@dnd-kit/sortable", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/sortable")>(
      "@dnd-kit/sortable",
    );
  return {
    ...actual,
    useSortable: (args: { id: string }) => {
      capturedSortableIds.push(args.id);
      return actual.useSortable(args);
    },
  };
});

import React from "react";
import PhotoReportBuilder from "./photo-report-builder";
import { WRITEUP_CHARACTER_LIMIT } from "@/lib/section-writeup-fit";
import { generateReportPDF } from "@/lib/generate-report-pdf";
import { toast } from "sonner";

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

// The teardown flush (unmount #443 and hard-unload #479) can't ride the Supabase
// JS client — its fetch is cancelled when the page goes away "the hard way" — so
// it fires a plain `keepalive: true` PUT at the #478 route instead. Only those
// PUTs carry keepalive:true, so isolate them: an assertion can't then be fooled
// by an unrelated debounced/in-flight Supabase write.
function keepalivePuts(mock: ReturnType<typeof vi.fn>): unknown[][] {
  return mock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.keepalive === true,
  );
}

// jsdom's document.visibilityState is a read-only getter; override it so a
// visibilitychange event can simulate the page being backgrounded/hidden.
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

// The teardown flush is a keepalive `fetch` PUT, not a Supabase call. Stub fetch
// inert for every test so the flush is harmless where it isn't asserted, and so
// the flush tests can inspect what it sent. A fresh mock per test prevents bleed.
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Unmount now, while `fetch` is still stubbed, so a teardown flush from a
  // component a test left mounted-and-dirty hits the inert mock instead of the
  // real undici fetch (which rejects on the route's relative URL). Runs before
  // RTL's own auto-cleanup either way, so that becomes a no-op.
  cleanup();
  vi.unstubAllGlobals();
  setVisibility("visible"); // reset so a hidden value can't leak to the next test
});

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

// Issue #467 — Sections used to be keyed by array index (React key + dnd-kit
// sortable id). On reorder, React reconciles by key, so the DOM node the user
// was focused in stayed put at its old position and had a *different* section's
// content swapped into it — the caret jumped to the wrong section mid-edit.
// Keying both off each section's stable `id` instead makes React move the
// focused node with its section, so focus/caret follows the section the user
// was editing.
describe("PhotoReportBuilder section reorder focus (#467)", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    capturedOnDragEnd = null;
    vi.useFakeTimers();
  });

  it("keeps focus in the edited section's heading after that section is reordered", () => {
    renderBuilder(
      makeReport({
        sections: [
          { title: "Alpha", description: "", photo_ids: [] },
          { title: "Beta", description: "", photo_ids: [] },
        ],
      }),
    );

    // The user edits the first section's heading and leaves the caret in it.
    const alphaInput = screen
      .getAllByLabelText("Section heading")
      .find(
        (el) => (el as HTMLInputElement).value === "Alpha",
      ) as HTMLInputElement;
    act(() => {
      alphaInput.focus();
      fireEvent.change(alphaInput, { target: { value: "Alpha edited" } });
    });

    // …then drags that same (edited) section from the top to the bottom.
    // resolvePhotoReportDragEnd maps the drop by `data.current.index` (the
    // active/over `id` is immaterial here — see photo-report-drag.ts), so this
    // drives the real reorder path without a pointer.
    act(() => {
      capturedOnDragEnd?.({
        active: {
          id: "section-0",
          data: { current: { type: "section", index: 0 } },
        },
        over: {
          id: "section-1",
          data: { current: { type: "section", index: 1 } },
        },
      });
    });

    // The reorder really happened — Beta is now first. Asserting this guards the
    // focus check below from passing vacuously (i.e. by the section never moving).
    expect(
      screen
        .getAllByLabelText("Section heading")
        .map((el) => (el as HTMLInputElement).value),
    ).toEqual(["Beta", "Alpha edited"]);

    // …and focus stayed in the field the user was editing — not stranded on
    // whatever section slid into its old position. With index keys this is
    // "Beta" (the wrong section); with stable `section.id` keys it follows.
    expect((document.activeElement as HTMLInputElement).value).toBe(
      "Alpha edited",
    );
  });

  it("keys each section's sortable identity off its stable id, never its array position (#467, AC2)", () => {
    // Smooth reorder animation (AC2) depends on dnd-kit seeing a *stable* sortable
    // id per section, so the dragged node keeps its identity as positions shift.
    // The DndContext is stubbed in these tests, so a revert of `useSortable({ id })`
    // back to a positional `section-${index}` would not surface through the focus
    // test above — this asserts it directly. Sections loaded with explicit ids keep
    // them (ensureSectionIds), making the expected ids deterministic.
    capturedSortableIds = [];
    renderBuilder(
      makeReport({
        sections: [
          { id: "sec-a", title: "A", description: "", photo_ids: [] },
          { id: "sec-b", title: "B", description: "", photo_ids: [] },
        ],
      }),
    );

    expect(capturedSortableIds).toEqual(["sec-a", "sec-b"]);
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

  it("flushes the pending edit as a keepalive PUT when the builder unmounts within the debounce window", () => {
    const { unmount } = renderBuilder();

    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Roof damage report" },
      });
    });

    // Unmount BEFORE the 2s debounce elapses — the autosave timer has not fired,
    // so nothing has been written yet (this is the lost-edit window in #443).
    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    act(() => {
      unmount();
    });

    // The pending dirty edit is flushed on unmount via a keepalive PUT to the
    // #478 route (not the Supabase client, whose fetch can't survive teardown).
    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/jobs/job-1/reports/report-1");
    const init = puts[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Roof damage report",
    });
  });

  it("does not flush when the builder was never edited", () => {
    const { unmount } = renderBuilder();

    // No edit happened, so the report is not dirty — unmounting must not write.
    act(() => {
      unmount();
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(0);
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

    expect(keepalivePuts(fetchMock)).toHaveLength(0);
  });
});

// Hard unload (#479): a real tab-close / refresh / app-background does NOT run
// React cleanup, so the unmount flush (#443) above never fires. These tests keep
// the builder MOUNTED and dispatch the browser page-lifecycle events it now
// listens for — proving the flush is driven by the listeners, not by unmount.
// Mirrors the Estimate/Invoice hard-unload trigger (slice A / #477).
describe("PhotoReportBuilder hard-unload flush (#479)", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    vi.useFakeTimers();
  });

  it("flushes a dirty edit as a keepalive PUT on a pagehide event (still mounted)", () => {
    const { unmount } = renderBuilder();

    // Edit the title, staying inside the 2s debounce window (no timer flush).
    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Roof damage report" },
      });
    });

    // The page is torn down the hard way — React cleanup never runs.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/jobs/job-1/reports/report-1");
    const init = puts[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Roof damage report",
    });

    // Tidy up while fetch is still stubbed (the test left the node mounted).
    act(() => {
      unmount();
    });
  });

  it("flushes a dirty edit as a keepalive PUT on visibilitychange when the page becomes hidden", () => {
    const { unmount } = renderBuilder();

    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Roof damage report" },
      });
    });

    // The tab/app is backgrounded — the common iOS exit path.
    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/jobs/job-1/reports/report-1");
    const init = puts[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Roof damage report",
    });

    act(() => {
      unmount();
    });
  });

  it("flushes on visibilitychange only when hidden, not when the page becomes visible", () => {
    const { unmount } = renderBuilder();

    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Roof damage report" },
      });
    });

    // Returning to the foreground is not a teardown — no flush. The report is
    // dirty and savable here (proven below), so a missing hidden-guard would
    // fire a PUT and fail this assertion; it isn't the dirty guard masking it.
    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    // Same dirty edit, now the page genuinely hides → the flush fires. Holding
    // the dirty state constant across both branches isolates the visibility
    // guard: only document.visibilityState gates the difference.
    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(keepalivePuts(fetchMock)).toHaveLength(1);

    act(() => {
      unmount();
    });
  });

  it("does not flush an over-limit write-up on pagehide or visibilitychange (#404)", () => {
    const { unmount } = renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    // Dirty, but the write-up overflows its one-page intro — the same save-time
    // guard (#404) that holds back the debounced save must hold back the flush.
    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: { value: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>` },
      });
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    act(() => {
      unmount();
    });
  });

  it("fires no PUT on pagehide or visibilitychange when the report is clean", () => {
    const { unmount } = renderBuilder();

    // No edit — both events must be no-ops (the report is not dirty).
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(0);

    act(() => {
      unmount();
    });
  });

  it("removes its listeners on unmount — a later pagehide or visibilitychange fires no further PUT", () => {
    const { unmount } = renderBuilder();

    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Roof damage report" },
      });
    });

    // In-app unmount flushes once via the #443 cleanup.
    act(() => {
      unmount();
    });
    const afterUnmount = keepalivePuts(fetchMock).length;
    expect(afterUnmount).toBe(1);

    // The listeners must be gone: were they leaked, this would fire a 2nd PUT.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(afterUnmount);
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

// Issue #441 — Generating the PDF must reflect what is on screen, not the
// last-saved row. The generator (`generateReportPDF`) re-reads the persisted row
// and is mocked here, so these tests assert what the builder does *before* it
// calls the generator: it flushes pending edits, and it refuses to generate a
// stale PDF when the report is over the one-page limit.
describe("PhotoReportBuilder generate", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    h.errorOnSave = false;
    vi.mocked(generateReportPDF).mockClear();
    vi.mocked(generateReportPDF).mockResolvedValue("job-1/report-1.pdf");
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.mocked(window.open).mockRestore();
  });

  function clickGenerate() {
    return act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate pdf/i }));
    });
  }

  it("flushes a pending edit to the database before generating, so the PDF reflects it", async () => {
    renderBuilder();

    // Edit the title but do NOT let the 2s auto-save debounce elapse.
    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Latest title" },
      });
    });
    expect(h.updateMock).not.toHaveBeenCalled();

    // Clicking Generate now must first persist the edit, then generate.
    await clickGenerate();

    // The latest on-screen content was written…
    expect(h.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Latest title" }),
    );
    // …and it was written BEFORE the generator (which reads the persisted row) ran.
    expect(h.updateMock.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(generateReportPDF).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(generateReportPDF)).toHaveBeenCalledWith("report-1");
  });

  it("refuses to generate when a section write-up is over the one-page limit, producing no PDF", async () => {
    renderBuilder(
      makeReport({
        sections: [
          {
            title: "Findings",
            description: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`,
            photo_ids: [],
          },
        ],
      }),
    );

    await clickGenerate();

    // No stale PDF: the generator (which would render the persisted, shorter
    // row) is never invoked.
    expect(vi.mocked(generateReportPDF)).not.toHaveBeenCalled();
    // The user is told why, in plain terms.
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/too long|shorten/i),
    );
  });

  it("does not generate a PDF when flushing the pending edit fails", async () => {
    h.errorOnSave = true;
    renderBuilder();

    // A pending edit makes the report dirty; the debounce has not elapsed.
    act(() => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Latest title" },
      });
    });

    await clickGenerate();

    // The flush failed, so the generator (which would read the older persisted
    // row) must not run — better no PDF than a stale one.
    expect(vi.mocked(generateReportPDF)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });

  it("generates and shows a persistent Open-PDF link instead of a blockable popup", async () => {
    renderBuilder();

    await clickGenerate();

    // A clean, fitting report needs no flush and generates…
    expect(h.updateMock).not.toHaveBeenCalled();
    expect(vi.mocked(generateReportPDF)).toHaveBeenCalledWith("report-1");
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
    // …and the PDF is retrievable via a real anchor the user taps (issue #442),
    // NOT a post-await window.open that iOS / WebView silently blocks.
    const link = screen.getByRole("link", { name: /open pdf/i });
    expect(link.getAttribute("href")).toBe(
      "https://example.supabase.co/storage/v1/object/public/reports/job-1/report-1.pdf",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(vi.mocked(window.open)).not.toHaveBeenCalled();
  });

  it("updates the link to the latest PDF when regenerated (issue #442)", async () => {
    vi.mocked(generateReportPDF)
      .mockResolvedValueOnce("job-1/report-1.pdf")
      .mockResolvedValueOnce("job-1/report-1-v2.pdf");
    renderBuilder();

    await clickGenerate();
    expect(
      screen.getByRole("link", { name: /open pdf/i }).getAttribute("href"),
    ).toBe(
      "https://example.supabase.co/storage/v1/object/public/reports/job-1/report-1.pdf",
    );

    await clickGenerate();
    expect(
      screen.getByRole("link", { name: /open pdf/i }).getAttribute("href"),
    ).toBe(
      "https://example.supabase.co/storage/v1/object/public/reports/job-1/report-1-v2.pdf",
    );
  });

  it("shows no link and reports an error when generation fails (issue #442)", async () => {
    vi.mocked(generateReportPDF).mockRejectedValueOnce(new Error("boom"));
    renderBuilder();

    await clickGenerate();

    // No false success: no retrieval affordance, an error is surfaced, and the
    // success toast never fires.
    expect(screen.queryByRole("link", { name: /open pdf/i })).toBeNull();
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });

  it("shows the Open-PDF link on load for an already-generated report (issue #442)", () => {
    // A report generated in an earlier session persists its pdf_path; the user
    // can retrieve that PDF without regenerating (restores the Download
    // affordance the removed global /reports detail page used to provide).
    renderBuilder(
      makeReport({ pdf_path: "job-1/report-1.pdf", status: "generated" }),
    );

    expect(
      screen.getByRole("link", { name: /open pdf/i }).getAttribute("href"),
    ).toBe(
      "https://example.supabase.co/storage/v1/object/public/reports/job-1/report-1.pdf",
    );
  });
});

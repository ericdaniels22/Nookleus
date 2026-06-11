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
import { writeupLimitFor } from "@/lib/section-writeup-fit";

// The live counter measures the write-up against the report's resolved
// photos-per-page (#550): the budget is layout-dependent (writeupLimitFor), and
// a settings-less report defaults to 2-per-page, so that is the cap these
// default-report tests assert against (the single 1500-char budget was retired
// in ADR 0014 / #549). A report carrying its own density is exercised separately.
const WRITEUP_CHARACTER_LIMIT = writeupLimitFor(2);
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
    report_settings: null,
    cover_config: null,
    cover_photo_id: null,
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
    // them (ensureSectionIds), making the expected ids deterministic. Since #548
    // the desktop rail registers its own `rail-`-prefixed sortable per section
    // (ids must be unique within the one DndContext) alongside the center
    // editor's — membership is asserted, not order, because rail-vs-center
    // registration order is incidental JSX layout, not part of this contract.
    capturedSortableIds = [];
    renderBuilder(
      makeReport({
        sections: [
          { id: "sec-a", title: "A", description: "", photo_ids: [] },
          { id: "sec-b", title: "B", description: "", photo_ids: [] },
        ],
      }),
    );

    expect(capturedSortableIds).toHaveLength(4);
    expect(capturedSortableIds).toEqual(
      expect.arrayContaining(["rail-sec-a", "rail-sec-b", "sec-a", "sec-b"]),
    );
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

  it("flushes an over-limit write-up on unmount (#550: the cap is a soft warning, not a block)", () => {
    const tooLong = `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`;
    const { unmount } = renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: { value: tooLong },
      });
    });

    // The write-up overflows its Section Title Page, but that no longer holds
    // back the save (#550 / ADR 0014): it renders on its own page and mild
    // overflow is tolerable. The flush persists it like any other dirty edit.
    act(() => {
      unmount();
    });

    const puts = keepalivePuts(fetchMock);
    expect(puts).toHaveLength(1);
    expect(
      (JSON.parse((puts[0][1] as RequestInit).body as string) as {
        sections: { description: string }[];
      }).sections[0].description,
    ).toBe(tooLong);
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

  it("flushes an over-limit write-up on pagehide / visibilitychange (#550: soft cap, no block)", () => {
    const { unmount } = renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    // Dirty and over the per-layout budget — but the cap is a soft warning
    // since #550, so the hard-unload flush persists it like any other edit
    // rather than holding it back.
    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: { value: `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>` },
      });
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(keepalivePuts(fetchMock)).toHaveLength(1);

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

describe("PhotoReportBuilder over-limit write-up (soft cap, #550)", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    vi.useFakeTimers();
  });

  it("persists an over-limit write-up — the cap only turns the counter red, it does not block the save", async () => {
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    const tooLong = `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`;
    act(() => {
      fireEvent.change(screen.getByTestId("tiptap-stub"), {
        target: { value: tooLong },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // The over-limit write-up saves like any other edit (#550 / ADR 0014): it
    // renders on its own full Section Title Page, so mild overflow is tolerable.
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: { description: string }[];
    };
    expect(payload.sections[0].description).toBe(tooLong);
    expect(screen.getByText("Saved")).toBeTruthy();
    // The only warning is the counter going red and reporting the overflow —
    // assert both: the magnitude AND the destructive styling that is the entire
    // user-facing signal once the hard block was removed (#550 / ADR 0014).
    const counter = screen.getByTestId("writeup-counter-0");
    expect(counter.textContent).toContain("1 over");
    expect(counter.className).toMatch(/text-destructive/);
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
    // Exactly at the cap still fits — the counter must NOT be red, fixing the
    // off-by-one boundary of the soft warning.
    expect(screen.getByTestId("writeup-counter-0").className).not.toMatch(
      /text-destructive/,
    );
  });

  it("does not mark the report Saved when a stale in-flight save resolves after a newer over-limit edit", async () => {
    // The revision guard (revisionRef) must hold under the soft-cap regime: a
    // slow save that resolves after a newer (over-limit, but valid) edit landed
    // must not flip the badge to "Saved" while that newer edit is unpersisted.
    h.manual = true;
    renderBuilder(
      makeReport({
        sections: [{ title: "Findings", description: "", photo_ids: [] }],
      }),
    );

    const editor = screen.getByTestId("tiptap-stub");

    // A fitting edit goes in flight (held open by manual mode).
    act(() => {
      fireEvent.change(editor, { target: { value: "<p>fits</p>" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.resolvers).toHaveLength(1);

    // A newer, over-limit edit lands WHILE that save is still in flight. The cap
    // is soft (#550), so it is a valid edit that must still be persisted.
    const tooLong = `<p>${"a".repeat(WRITEUP_CHARACTER_LIMIT + 1)}</p>`;
    act(() => {
      fireEvent.change(editor, { target: { value: tooLong } });
    });

    // The stale save (of the fitting edit) resolves now. It must NOT claim
    // "Saved", because the newer over-limit edit has not been persisted yet.
    await act(async () => {
      h.resolvers[0]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("Saved")).toBeNull();

    // The newer edit gets its own debounced save; once that resolves, settle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      h.resolvers[1]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Saved")).toBeTruthy();
  });
});

// Issue #441 — Generating the PDF must reflect what is on screen, not the
// last-saved row. The generator (`generateReportPDF`) re-reads the persisted row
// and is mocked here, so these tests assert what the builder does *before* it
// calls the generator: it flushes pending edits first. Since #550 an over-limit
// write-up no longer blocks generation — it flushes and renders like any other.
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

  it("generates even when a section write-up is over the limit (#550: soft cap, no block)", async () => {
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

    // The over-limit write-up renders on its own Section Title Page (ADR 0014),
    // so generation proceeds normally — no refusal, no error toast.
    expect(vi.mocked(generateReportPDF)).toHaveBeenCalledWith("report-1");
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
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
    // The underlying cause must reach the toast, not be swallowed by an empty
    // catch — that blanket "Failed to generate PDF" once masked a Storage
    // size-limit rejection and made the failure undiagnosable (#625).
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain("boom");
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

// Issue #550 — the in-builder Report Settings panel behind the top-bar gear, and
// the per-layout write-up cap wired to the report's resolved photos-per-page.
// These assert the builder ↔ panel wiring through the DOM: the live counter
// reads the report's density, the gear opens the panel, and a setting changed in
// the panel auto-saves through the same path as every other edit.
describe("PhotoReportBuilder Report Settings (#550)", () => {
  beforeEach(() => {
    h.updateMock.mockClear();
    h.manual = false;
    h.resolvers = [];
    vi.useFakeTimers();
  });

  it("measures the write-up against the report's resolved photos-per-page, not the 2-per-page default", () => {
    // A 3-per-page report's intro shares its Section Title Page with one more
    // photo row, so its budget is tighter: writeupLimitFor(3) = 400, not 750.
    renderBuilder(
      makeReport({
        report_settings: { photosPerPage: 3 },
        sections: [
          { title: "Findings", description: "<p>Hello</p>", photo_ids: [] },
        ],
      }),
    );

    expect(screen.getByTestId("writeup-counter-0").textContent).toContain(
      `5 / ${writeupLimitFor(3)}`,
    );
  });

  it("relives the live write-up budget when photos-per-page is changed in the panel", () => {
    // A 500-char intro fits at 2-per-page (cap 750) but overflows at 4-per-page
    // (cap 260). Changing the density in the panel must move the budget live —
    // proving the counter is bound to the current setting, not the value the
    // report loaded with.
    renderBuilder(
      makeReport({
        sections: [
          {
            title: "Findings",
            description: `<p>${"a".repeat(500)}</p>`,
            photo_ids: [],
          },
        ],
      }),
    );

    const counter = () => screen.getByTestId("writeup-counter-0");
    // Under the 2-per-page budget: fits, not red.
    expect(counter().textContent).toContain(`500 / ${writeupLimitFor(2)}`);
    expect(counter().textContent).not.toContain("over");
    expect(counter().className).not.toMatch(/text-destructive/);

    // Tighten the layout to 4-per-page in the panel.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /report settings/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /4 per page/i }));
    });

    // The same unchanged write-up now overflows the tighter budget and goes red.
    expect(counter().textContent).toContain(`500 / ${writeupLimitFor(4)}`);
    expect(counter().textContent).toContain(`${500 - writeupLimitFor(4)} over`);
    expect(counter().className).toMatch(/text-destructive/);
  });

  it("opens the Report Settings panel when the gear is clicked", () => {
    renderBuilder();

    // Closed on load — the gear is the only thing named "Report settings".
    expect(
      screen.queryByRole("dialog", { name: /report settings/i }),
    ).toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /report settings/i }));
    });

    expect(
      screen.getByRole("dialog", { name: /report settings/i }),
    ).toBeTruthy();
  });

  it("auto-saves the report_settings snapshot when photos-per-page is changed in the panel", async () => {
    renderBuilder();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /report settings/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /4 per page/i }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // The layout change rides the same debounced write as a title/section edit,
    // carrying the report's settings snapshot in the persisted row.
    expect(h.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        report_settings: expect.objectContaining({ photosPerPage: 4 }),
      }),
    );
  });

  it("auto-saves the report_settings snapshot when a detail toggle is flipped in the panel", async () => {
    renderBuilder();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /report settings/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("checkbox", { name: /photo tags/i }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // The six detail toggles default on, so flipping one persists it as false.
    expect(h.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        report_settings: expect.objectContaining({ photoTags: false }),
      }),
    );
  });
});

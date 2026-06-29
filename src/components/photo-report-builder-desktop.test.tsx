// Issue #548 — Photo Report builder: desktop multi-pane shell.
//
// On desktop (lg+) the builder renders a left rail (Cover Page pinned, then the
// report's Sections, drag-to-reorder, "+ New Section") beside a center editor
// showing the ONE selected Section; below lg the existing phone builder is
// unchanged. Both surfaces are present in the DOM and gated purely by Tailwind
// breakpoint classes (no JS viewport hook), so jsdom — which has no layout
// engine — asserts the gating via class strings, the same approach as
// builder-layout.test.tsx. Section selection is component-local UI state and
// only pre-existing reducer actions are used.
//
// Mock scaffolding mirrors photo-report-builder.test.tsx: the Supabase client
// captures the auto-save write, TipTap is stubbed, DndContext is a passthrough
// that captures onDragEnd, and fetch is stubbed inert so the teardown flush
// (#443) is harmless.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  within,
} from "@testing-library/react";

import type { Photo, PhotoReport, PhotoTag } from "@/lib/types";

const h = vi.hoisted(() => ({
  updateMock: vi.fn<(payload: Record<string, unknown>) => void>(),
  // When set, the auto-save write resolves with an error so a test can exercise
  // the failed-flush path (#441: a failed flush must not yield a render).
  errorOnSave: false,
}));

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        h.updateMock(payload);
        return {
          eq: () =>
            Promise.resolve({
              error: h.errorOnSave ? { message: "save failed" } : null,
            }),
        };
      },
    }),
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/generate-report-pdf", () => ({
  generateReportPDF: vi.fn(async () => "job-1/report-1.pdf"),
  renderReportPdfBlob: vi.fn(
    async () => new Blob(["%PDF"], { type: "application/pdf" }),
  ),
}));

// The on-demand Preview pane (#554) feeds the shared producer's blob into the
// in-app react-pdf viewer (PdfPreviewFrame). That island can't run in jsdom
// (react-pdf evaluates pdfjs-dist at import), so stand in a stub echoing the
// src/title the builder hands it — the frame's own pass-through is unit-tested
// in pdf-preview-frame.test.tsx.
vi.mock("@/components/documents/pdf-preview-frame", () => ({
  PdfPreviewFrame: ({ src, title }: { src: string; title: string }) => (
    <div data-testid="report-preview-frame" data-src={src} data-title={title} />
  ),
}));

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

// Passthrough DndContext capturing onDragEnd, so a test can fire a synthetic
// drag without a pointer (same pattern as photo-report-builder.test.tsx).
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

// Record every id registered with useSortable, so a test can prove the rail's
// Section items are sortable under stable, rail-scoped ids.
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

let capturedViewerProps: any = null;
vi.mock("@/components/photo-viewer", () => ({
  default: (props: any) => {
    capturedViewerProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="photo-viewer-stub">
        <button
          data-testid="viewer-annotate"
          onClick={() =>
            props.onAnnotate(props.photos[props.initialPhotoIndex], "annot-url")
          }
        />
        <button data-testid="viewer-updated" onClick={() => props.onUpdated()} />
      </div>
    );
  },
}));

let capturedAnnotatorProps: any = null;
vi.mock("@/components/photo-annotator", () => ({
  default: (props: any) => {
    capturedAnnotatorProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="photo-annotator-stub">
        <button data-testid="annotator-save" onClick={() => props.onSaved()} />
      </div>
    );
  },
}));

import React from "react";
import { toast } from "sonner";
import PhotoReportBuilder from "./photo-report-builder";
import { renderReportPdfBlob } from "@/lib/generate-report-pdf";

function makeReport(overrides: Partial<PhotoReport> = {}): PhotoReport {
  return {
    id: "report-1",
    organization_id: "org-1",
    job_id: "job-1",
    template_id: null,
    title: "Photo Report #1",
    report_number: 1,
    report_date: "2026-06-04",
    sections: [
      { id: "sec-a", title: "Roof", description: "", photo_ids: [] },
      { id: "sec-b", title: "Gutters", description: "", photo_ids: [] },
    ],
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

function makePhoto(id: string, createdAt = "2026-06-04T12:00:00"): Photo {
  return {
    id,
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption: null,
    created_at: createdAt,
  } as Photo;
}

function renderBuilder(
  report = makeReport(),
  photos: Photo[] = [],
  tags: PhotoTag[] = [],
) {
  return render(
    <PhotoReportBuilder
      jobId="job-1"
      report={report}
      photos={photos}
      supabaseUrl="https://example.supabase.co"
      tags={tags}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

// jsdom ships no Blob URL machinery, but the Preview pane (#554) turns the
// rendered PDF blob into an object URL. Stand in deterministic blob: URLs so a
// test can assert the viewer was fed one (and, later, that stale ones are
// revoked). Restored after each test to keep the worker hermetic.
const realCreateObjectURL = globalThis.URL.createObjectURL;
const realRevokeObjectURL = globalThis.URL.revokeObjectURL;
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
let objectUrlSeq = 0;

beforeEach(() => {
  h.updateMock.mockClear();
  h.errorOnSave = false;
  vi.mocked(renderReportPdfBlob).mockClear();
  vi.mocked(toast.error).mockClear();
  capturedOnDragEnd = null;
  capturedSortableIds = [];
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);

  objectUrlSeq = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:mock/${++objectUrlSeq}`);
  revokeObjectURL.mockReset();
  globalThis.URL.createObjectURL = createObjectURL;
  globalThis.URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  // Unmount while fetch is still stubbed so a dirty builder's teardown flush
  // (#443) hits the inert mock (see photo-report-builder.test.tsx).
  cleanup();
  vi.unstubAllGlobals();
  globalThis.URL.createObjectURL = realCreateObjectURL;
  globalThis.URL.revokeObjectURL = realRevokeObjectURL;
});

function getRail() {
  return screen.getByTestId("report-rail");
}

// The rail's navigable entries by visible label. Each Section row also holds
// an icon-only grip handle (empty textContent) — drag must live on a control
// separate from the select button (see the keyboard-selection describe), so
// enumerations of the rail's entries skip the grips.
function railEntryNames() {
  return within(getRail())
    .getAllByRole("button")
    .map((el) => el.textContent?.trim())
    .filter(Boolean);
}

describe("PhotoReportBuilder — desktop left rail (#548)", () => {
  it("renders a desktop-only rail listing the Cover Page pinned first, then the Sections in order, with + New Section", () => {
    renderBuilder();

    // Desktop-only: present in the DOM, hidden below lg purely by CSS classes.
    const rail = getRail();
    expect(rail.className).toContain("hidden");
    expect(rail.className).toContain("lg:block");

    // Cover Page pinned at the top, then the report's Sections in their order.
    const names = railEntryNames();
    expect(names[0]).toBe("Cover Page");
    expect(names.slice(1, 3)).toEqual(["Roof", "Gutters"]);

    // The rail offers the add affordance.
    expect(
      within(rail).getByRole("button", { name: /new section/i }),
    ).toBeTruthy();
  });

  it("highlights the Cover Page by default and moves the highlight to a clicked Section", () => {
    renderBuilder();
    const rail = getRail();

    // Fresh open: nothing is being edited yet — the pinned Cover Page holds
    // the highlight.
    const cover = within(rail).getByRole("button", { name: "Cover Page" });
    const roof = within(rail).getByRole("button", { name: "Roof" });
    expect(cover.getAttribute("aria-current")).toBe("true");
    expect(roof.getAttribute("aria-current")).toBeNull();

    // Selecting a Section moves the highlight off the Cover Page onto it.
    fireEvent.click(roof);
    expect(roof.getAttribute("aria-current")).toBe("true");
    expect(cover.getAttribute("aria-current")).toBeNull();
  });
});

describe("PhotoReportBuilder — rail + New Section (#548)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a Section from the rail, selects it as the center pane, and autosaves", async () => {
    renderBuilder();
    const rail = getRail();

    // Grab the affordance before clicking: afterwards the rail also holds the
    // new item "New section" (reducer default title), which a /new section/i
    // name match would catch too.
    const addButton = within(rail).getByRole("button", {
      name: /new section/i,
    });
    fireEvent.click(addButton);

    // The new Section appears in the rail after the existing Sections, and the
    // highlight (the pane being edited) moves straight onto it. (getByRole
    // string names are exact-match, so "New section" — the reducer's default
    // title — does not collide with the "New Section" add affordance.)
    expect(railEntryNames().slice(0, 4)).toEqual([
      "Cover Page",
      "Roof",
      "Gutters",
      "New section",
    ]);
    const newItem = within(rail).getByRole("button", { name: "New section" });
    expect(newItem.getAttribute("aria-current")).toBe("true");

    // The new Section is the one visible desktop pane; the others stay
    // desktop-hidden (phone surface untouched).
    const cards = screen
      .getAllByLabelText("Section heading")
      .map((el) => el.closest("section") as HTMLElement);
    expect(cards).toHaveLength(3);
    expect(cards[2].className.split(/\s+/)).not.toContain("lg:hidden");
    expect(cards[0].className.split(/\s+/)).toContain("lg:hidden");
    expect(cards[1].className.split(/\s+/)).toContain("lg:hidden");

    // The addition autosaves like any other edit: the debounced write persists
    // all three Sections.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: Array<{ title: string }>;
    };
    expect(payload.sections).toHaveLength(3);
    expect(payload.sections[2].title).toBe("New section");
  });
});

describe("PhotoReportBuilder — rail drag-to-reorder (#548)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers the rail's Sections as sortable under stable rail-scoped ids", () => {
    renderBuilder();

    // Rail ids are namespaced (`rail-` prefix) so they can coexist with the
    // center cards' bare section ids inside the one shared DndContext —
    // dnd-kit forbids duplicate ids. The rail renders before the center
    // editor, so its registrations come first.
    expect(capturedSortableIds.slice(0, 2)).toEqual([
      "rail-sec-a",
      "rail-sec-b",
    ]);
    expect(capturedSortableIds).toContain("sec-a");
    expect(capturedSortableIds).toContain("sec-b");
  });

  it("reorders Sections dragged in the rail and autosaves the new order", async () => {
    // Pins the full path a real rail drag takes once the items are sortable:
    // resolvePhotoReportDragEnd reads only data.current (photo-report-drag
    // pins that ids are immaterial), so the rail-scoped ids resolve to the
    // same reorderSection a center-card drag produces.
    renderBuilder();
    expect(capturedOnDragEnd).toBeTruthy();

    act(() => {
      capturedOnDragEnd?.({
        active: {
          id: "rail-sec-a",
          data: { current: { type: "section", index: 0 } },
        },
        over: {
          id: "rail-sec-b",
          data: { current: { type: "section", index: 1 } },
        },
      });
    });

    // The rail reflects the new order…
    expect(railEntryNames().slice(1, 3)).toEqual(["Gutters", "Roof"]);

    // …and the reorder autosaves like any other edit.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: Array<{ title: string }>;
    };
    expect(payload.sections.map((s) => s.title)).toEqual(["Gutters", "Roof"]);
  });
});

describe("PhotoReportBuilder — rail selection stays keyboard-reachable (#548)", () => {
  it("keeps each Section's select control free of the sortable's listeners — drag lives on a dedicated grip handle", () => {
    // dnd-kit's KeyboardSensor activates on Enter/Space through the sortable
    // listeners and preventDefault()s the keydown, which swallows a button's
    // native keyboard activation. Fusing select + drag onto one button would
    // therefore leave keyboard users unable to ever select a Section (the
    // keypress picks the row up for a drag instead). So the select button
    // must carry NO sortable wiring; the sortable attributes/listeners live
    // on a dedicated grip handle beside it, the same split the center
    // editor's cards use.
    renderBuilder();
    const rail = getRail();

    // The select control is a plain button: no sortable role description.
    const roof = within(rail).getByRole("button", { name: "Roof" });
    expect(roof.getAttribute("aria-roledescription")).toBeNull();

    // Each Section row has its own grip, and the sortable attributes landed
    // there instead.
    const grips = within(rail).getAllByRole("button", {
      name: "Drag to reorder section",
    });
    expect(grips).toHaveLength(2);
    for (const grip of grips) {
      expect(grip.getAttribute("aria-roledescription")).toBe("sortable");
    }

    // And the select control still selects.
    fireEvent.click(roof);
    expect(roof.getAttribute("aria-current")).toBe("true");
  });
});

describe("PhotoReportBuilder — desktop top-bar controls (#548, #554)", () => {
  it("offers desktop-only gear, Preview, and the single Generate action", () => {
    renderBuilder();

    // Both are desktop-only (hidden on phone, shown at lg). #550 wired the gear
    // up to open Report Settings; #554 wired Preview up to render the on-demand
    // pane — neither is a disabled placeholder any longer.
    const gear = screen.getByRole("button", { name: "Report settings" });
    const preview = screen.getByRole("button", { name: "Preview" });
    for (const el of [gear, preview]) {
      const t = el.className.split(/\s+/);
      expect(t).toContain("hidden");
      expect(t).toContain("lg:inline-flex");
    }
    expect((gear as HTMLButtonElement).disabled).toBe(false);
    expect((preview as HTMLButtonElement).disabled).toBe(false);

    // Generate keeps today's behavior — one button, both surfaces share it.
    expect(
      screen.getAllByRole("button", { name: /generate pdf/i }),
    ).toHaveLength(1);
  });
});

describe("PhotoReportBuilder — desktop center editor shows one pane (#548)", () => {
  // jsdom has no layout engine, so desktop visibility is asserted the way it is
  // implemented: exact Tailwind class tokens (`lg:hidden` hides on desktop
  // only; a bare `hidden` would break the phone surface).
  const tokens = (el: Element) => (el as HTMLElement).className.split(/\s+/);

  it("shows the report meta for the Cover Page by default, with every Section card desktop-hidden but intact for the phone surface", () => {
    renderBuilder();

    const cards = screen
      .getAllByLabelText("Section heading")
      .map((el) => el.closest("section") as HTMLElement);
    expect(cards).toHaveLength(2);
    const meta = screen.getByTestId("report-meta");

    expect(tokens(meta)).not.toContain("lg:hidden");
    for (const card of cards) {
      expect(tokens(card)).toContain("lg:hidden");
      // The phone surface still renders every Section below lg.
      expect(tokens(card)).not.toContain("hidden");
    }
  });

  it("shows just the selected Section in the center editor", () => {
    renderBuilder();

    fireEvent.click(within(getRail()).getByRole("button", { name: "Roof" }));

    const cards = screen
      .getAllByLabelText("Section heading")
      .map((el) => el.closest("section") as HTMLElement);
    const meta = screen.getByTestId("report-meta");

    // Roof (sec-a) is the one visible desktop pane; Gutters and the cover's
    // meta editor are desktop-hidden.
    expect(tokens(cards[0])).not.toContain("lg:hidden");
    expect(tokens(cards[1])).toContain("lg:hidden");
    expect(tokens(meta)).toContain("lg:hidden");
  });
});

// ─── #552: the "+ Add Photos" picker replaces the desktop drag tray ─────────

const tokens = (el: Element) => (el as HTMLElement).className.split(/\s+/);

function sectionCards() {
  return screen
    .getAllByLabelText("Section heading")
    .map((el) => el.closest("section") as HTMLElement);
}

describe("PhotoReportBuilder — desktop picker replaces the drag tray (#552)", () => {
  it("offers a desktop-only + Add Photos button on each Section card", () => {
    renderBuilder(makeReport(), [makePhoto("p1")]);

    for (const card of sectionCards()) {
      const add = within(card).getByRole("button", { name: "Add Photos" });
      expect(tokens(add)).toContain("hidden");
      expect(tokens(add)).toContain("lg:inline-flex");
    }
  });

  it("hides the drag tray on desktop only, keeping it for the phone surface", () => {
    renderBuilder(makeReport(), [makePhoto("p1")]);

    // The tray is still in the DOM (the phone surface needs it) and hidden at
    // lg+ purely by class — a bare `hidden` would break the phone builder.
    const tray = screen
      .getByText("Photos not in the report")
      .closest("div") as HTMLElement;
    expect(tokens(tray)).toContain("lg:hidden");
    expect(tokens(tray)).not.toContain("hidden");

    // The "drag photos here" hint only makes sense where the tray exists.
    const hints = screen.getAllByText(/drag photos here to add them/, {
      selector: "span",
    });
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints) {
      expect(tokens(hint)).toContain("lg:hidden");
    }
  });
});

describe("PhotoReportBuilder — + Add Photos picker (#552)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // p1 already lives in the target (Roof), p2 in another Section (Gutters),
  // p3/p4 are not in the report at all.
  function pickerReport() {
    return makeReport({
      sections: [
        { id: "sec-a", title: "Roof", description: "", photo_ids: ["p1"] },
        { id: "sec-b", title: "Gutters", description: "", photo_ids: ["p2"] },
      ],
    });
  }
  const jobPhotos = () => ["p1", "p2", "p3", "p4"].map((id) => makePhoto(id));

  const orgTags: PhotoTag[] = [
    {
      id: "tag-red",
      organization_id: "org-1",
      name: "Damage",
      color: "#ef4444",
      created_by: "u-1",
      created_at: "2026-06-01T00:00:00Z",
    },
    {
      id: "tag-blue",
      organization_id: "org-1",
      name: "Repaired",
      color: "#3b82f6",
      created_by: "u-1",
      created_at: "2026-06-01T00:00:00Z",
    },
  ];

  // The page's join shape: the photo carries its tag assignment ids.
  function withTags(photo: Photo, ...tagIds: string[]): Photo {
    return {
      ...photo,
      photo_tag_assignments: tagIds.map((tag_id) => ({ tag_id })),
    } as Photo;
  }

  function openPickerFor(cardIndex: number) {
    fireEvent.click(
      within(sectionCards()[cardIndex]).getByRole("button", {
        name: "Add Photos",
      }),
    );
  }

  it("lists the Job's photos, marking in-this-section (dimmed, no checkbox) and used-elsewhere", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0); // Roof

    // The dialog portal renders into document.body, so screen finds it.
    expect(screen.getByText("Add photos")).toBeTruthy();

    // Already in the target Section: dimmed, no selection checkbox — it is
    // already exactly where the picker would put it. Still viewable.
    const p1 = screen.getByTestId("picker-photo-p1");
    expect(p1.className).toContain("opacity-50");
    expect(within(p1).queryByTestId("picker-select-p1")).toBeNull();
    expect(within(p1).getByText("In this section")).toBeTruthy();
    expect(within(p1).getByRole("button", { name: "View photo" })).toBeTruthy();

    // Used in another Section: selectable, marked with that Section's name.
    const p2 = screen.getByTestId("picker-photo-p2");
    expect(within(p2).getByTestId("picker-select-p2")).toBeTruthy();
    expect(within(p2).getByText("In Gutters")).toBeTruthy();

    // Not in the report: no marking.
    const p3 = screen.getByTestId("picker-photo-p3");
    expect(within(p3).queryByText(/^In /)).toBeNull();
  });

  it("multi-adds the selection in pick order — moving a used-elsewhere photo, no duplicates — and autosaves once", async () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0); // Roof

    // The footer button counts the selection and is disabled at zero.
    const addSelection = () =>
      screen.getByRole("button", {
        name: /add \d+ photos?/i,
      }) as HTMLButtonElement;
    expect(addSelection().disabled).toBe(true);

    // Pick p3, then p2 (currently in Gutters), then p4 via the corner
    // checkboxes — order matters: it is the append order, hence the PDF
    // numbering order.
    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(screen.getByTestId("picker-select-p2"));
    fireEvent.click(screen.getByTestId("picker-select-p4"));
    expect(
      screen.getByTestId("picker-select-p2").getAttribute("aria-pressed"),
    ).toBe("true");
    // The checkbox carries the pick number.
    expect(screen.getByTestId("picker-select-p3").textContent).toBe("1");
    expect(screen.getByTestId("picker-select-p2").textContent).toBe("2");
    expect(addSelection().textContent).toContain("Add 3 photos");

    fireEvent.click(addSelection());

    // The dialog closes (it only mounts while open)…
    expect(screen.queryByText("Add photos")).toBeNull();

    // …and the single dispatch autosaves once: Roof appends in pick order and
    // Gutters lost p2 — the one-Section invariant, no duplicates.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: Array<{ title: string; photo_ids: string[] }>;
    };
    expect(payload.sections[0].photo_ids).toEqual(["p1", "p3", "p2", "p4"]);
    expect(payload.sections[1].photo_ids).toEqual([]);
  });

  it("Cancel closes without dispatching, and a reopened picker starts with a fresh selection", async () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Add photos")).toBeNull();

    // No edit was made, so nothing autosaves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).not.toHaveBeenCalled();

    // The dialog mounts per open, so the abandoned selection is gone.
    openPickerFor(0);
    expect(
      screen.getByTestId("picker-select-p3").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("clicking the photo body opens the fullscreen viewer at that photo", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(
      within(screen.getByTestId("picker-photo-p3")).getByRole("button", {
        name: "View photo",
      }),
    );

    const viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    const img = within(viewer).getByRole("img") as HTMLImageElement;
    expect(img.src).toContain(
      "/storage/v1/object/public/photos/job-1/p3.jpg",
    );
  });

  it("the in-viewer checkbox drives the same selection the grid shows", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(
      within(screen.getByTestId("picker-photo-p3")).getByRole("button", {
        name: "View photo",
      }),
    );
    fireEvent.click(screen.getByTestId("viewer-select"));
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));

    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();
    expect(
      screen.getByTestId("picker-select-p3").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /add \d+ photos?/i }).textContent,
    ).toContain("Add 1 photo");
  });

  it("un-checking an earlier pick renumbers the later ones (ordered-selection regression guard)", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(screen.getByTestId("picker-select-p4"));
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("1");
  });

  it("Escape closes the viewer first, the dialog second", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);
    fireEvent.click(
      within(screen.getByTestId("picker-photo-p4")).getByRole("button", {
        name: "View photo",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Photo viewer" })).toBeTruthy();

    // Base UI listens for Escape on the document. The viewer (topmost dialog)
    // takes the first one; the picker's onOpenChange guard converts any close
    // request that falls through into "close the viewer" instead.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();
    expect(screen.getByText("Add photos")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Add photos")).toBeNull();
  });

  it("groups photos under day headers", () => {
    const photos = [
      makePhoto("p1", "2026-06-09T10:00:00"),
      makePhoto("p2", "2026-06-09T09:00:00"),
      makePhoto("p3", "2026-06-08T15:00:00"),
      makePhoto("p4", "2026-06-08T14:00:00"),
    ];
    renderBuilder(pickerReport(), photos);
    openPickerFor(0);

    const tuesday = screen.getByTestId("picker-group-2026-06-09");
    expect(within(tuesday).getByText("Tuesday, June 9th, 2026")).toBeTruthy();
    expect(within(tuesday).getByTestId("picker-photo-p1")).toBeTruthy();
    expect(within(tuesday).getByTestId("picker-photo-p2")).toBeTruthy();

    const monday = screen.getByTestId("picker-group-2026-06-08");
    expect(within(monday).getByText("Monday, June 8th, 2026")).toBeTruthy();
    expect(within(monday).getByTestId("picker-photo-p3")).toBeTruthy();
    expect(within(monday).getByTestId("picker-photo-p4")).toBeTruthy();
  });

  it("the group checkbox bulk-selects the day's selectable photos in grid order and unselects on second click", () => {
    // All four photos share the default day; p1 is in Roof (the target),
    // p2 in Gutters.
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    const groupCheckbox = () =>
      screen.getByRole("checkbox", {
        name: /select all photos from/i,
      }) as HTMLInputElement;
    expect(groupCheckbox().checked).toBe(false);

    fireEvent.click(groupCheckbox());

    // p1 is "in this section" — excluded; the rest append in grid order.
    expect(screen.getByTestId("picker-select-p2").textContent).toBe("1");
    expect(screen.getByTestId("picker-select-p3").textContent).toBe("2");
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("3");
    expect(groupCheckbox().checked).toBe(true);

    fireEvent.click(groupCheckbox());
    expect(
      screen.getByTestId("picker-select-p2").getAttribute("aria-pressed"),
    ).toBe("false");
    const footer = screen.getByRole("button", {
      name: /add \d+ photos?/i,
    }) as HTMLButtonElement;
    expect(footer.disabled).toBe(true);
  });

  it("a day-check appends only the day's unselected photos, keeping earlier picks' numbers", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);

    fireEvent.click(screen.getByTestId("picker-select-p3"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /select all photos from/i }),
    );

    // A day-check acts like clicking each unselected photo left to right:
    // p3 keeps its number, p2 and p4 append after it.
    expect(screen.getByTestId("picker-select-p3").textContent).toBe("1");
    expect(screen.getByTestId("picker-select-p2").textContent).toBe("2");
    expect(screen.getByTestId("picker-select-p4").textContent).toBe("3");
  });

  it("a day whose photos are all in this section gets a disabled group checkbox", () => {
    const report = makeReport({
      sections: [
        { id: "sec-a", title: "Roof", description: "", photo_ids: ["p1", "p2"] },
        { id: "sec-b", title: "Gutters", description: "", photo_ids: [] },
      ],
    });
    renderBuilder(report, ["p1", "p2"].map((id) => makePhoto(id)));
    openPickerFor(0);

    const box = screen.getByRole("checkbox", {
      name: /select all photos from/i,
    }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });

  it("renders no Tags dropdown when the Organization has no tags", () => {
    renderBuilder(pickerReport(), jobPhotos());
    openPickerFor(0);
    expect(screen.queryByRole("button", { name: /^Tags/ })).toBeNull();
  });

  it("tag filter hides non-matching photos but keeps the hidden selection for Add", async () => {
    const photos = [
      makePhoto("p1"),
      makePhoto("p2"),
      withTags(makePhoto("p3"), "tag-red"),
      makePhoto("p4"),
    ];
    renderBuilder(pickerReport(), photos, orgTags);
    openPickerFor(0);

    // Select p4 BEFORE filtering.
    fireEvent.click(screen.getByTestId("picker-select-p4"));

    // Filter to "Damage": only p3 carries it. (The dropdown is CSS-gated —
    // hidden until hover/focus-within — but jsdom ignores CSS, so the
    // checkbox is reachable directly.)
    fireEvent.click(screen.getByRole("checkbox", { name: "Damage" }));
    expect(screen.queryByTestId("picker-photo-p4")).toBeNull();
    expect(screen.getByTestId("picker-photo-p3")).toBeTruthy();

    // The hidden selection survives the filter (selection is a cart, not a
    // transient bulk-action target — unlike the Photos tab, on purpose)…
    fireEvent.click(screen.getByTestId("picker-select-p3"));
    const addSelection = screen.getByRole("button", {
      name: /add \d+ photos?/i,
    });
    expect(addSelection.textContent).toContain("Add 2 photos");

    // …and Add hands back both, in pick order.
    fireEvent.click(addSelection);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: Array<{ photo_ids: string[] }>;
    };
    expect(payload.sections[0].photo_ids).toEqual(["p1", "p4", "p3"]);
  });

  it("the sort toggle reverses group order", () => {
    const photos = [
      makePhoto("p1", "2026-06-09T10:00:00"),
      makePhoto("p2", "2026-06-08T10:00:00"),
    ];
    renderBuilder(makeReport(), photos);
    openPickerFor(0);

    const groupIds = () =>
      screen
        .getAllByTestId(/^picker-group-/)
        .map((el) => el.getAttribute("data-testid"));
    expect(groupIds()).toEqual([
      "picker-group-2026-06-09",
      "picker-group-2026-06-08",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Newest first" }));
    expect(screen.getByRole("button", { name: "Oldest first" })).toBeTruthy();
    expect(groupIds()).toEqual([
      "picker-group-2026-06-08",
      "picker-group-2026-06-09",
    ]);
  });

  it("the viewer pages through the filtered list only", () => {
    const photos = [
      withTags(makePhoto("p1"), "tag-red"),
      makePhoto("p2"),
      withTags(makePhoto("p3"), "tag-red"),
    ];
    renderBuilder(makeReport(), photos, orgTags);
    openPickerFor(0);

    fireEvent.click(screen.getByRole("checkbox", { name: "Damage" }));
    fireEvent.click(
      within(screen.getByTestId("picker-photo-p1")).getByRole("button", {
        name: "View photo",
      }),
    );

    // ArrowRight lands on p3 — p2 is filtered out of the flip-through list.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const viewer = screen.getByRole("dialog", { name: "Photo viewer" });
    const img = within(viewer).getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("job-1/p3.jpg");
  });

  it("focuses the grid on open, not the Tags button (whose focus opens the dropdown)", async () => {
    renderBuilder(pickerReport(), jobPhotos(), orgTags);
    await act(async () => {
      openPickerFor(0);
      await vi.runAllTimersAsync();
    });
    expect(document.activeElement).toBe(screen.getByTestId("picker-grid"));
  });
});

describe("PhotoReportBuilder — within-Section photo reorder (#552)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function reorderReport() {
    return makeReport({
      sections: [
        {
          id: "sec-a",
          title: "Roof",
          description: "",
          photo_ids: ["p1", "p2", "p3"],
        },
        { id: "sec-b", title: "Gutters", description: "", photo_ids: [] },
      ],
    });
  }
  const jobPhotos = () => ["p1", "p2", "p3"].map((id) => makePhoto(id));

  it("registers a Section's photos as sortable, so they are reorder drop targets", () => {
    renderBuilder(reorderReport(), jobPhotos());

    for (const id of ["p1", "p2", "p3"]) {
      expect(capturedSortableIds).toContain(id);
    }
  });

  it("reorders a photo dragged onto another in its Section and autosaves the new photo_ids order", async () => {
    renderBuilder(reorderReport(), jobPhotos());
    expect(capturedOnDragEnd).toBeTruthy();

    // Drag p1 (position 0) onto p3 (position 2) — the descriptors the builder
    // attaches to in-Section photos carry sectionIndex + photoIndex.
    act(() => {
      capturedOnDragEnd?.({
        active: {
          id: "p1",
          data: {
            current: {
              type: "photo",
              photoId: "p1",
              sectionIndex: 0,
              photoIndex: 0,
            },
          },
        },
        over: {
          id: "p3",
          data: {
            current: {
              type: "photo",
              photoId: "p3",
              sectionIndex: 0,
              photoIndex: 2,
            },
          },
        },
      });
    });

    // The grid re-renders in the new order immediately…
    const order = within(sectionCards()[0])
      .getAllByAltText("Photo")
      .map((img) => (img as HTMLImageElement).src.match(/p\d/)?.[0]);
    expect(order).toEqual(["p2", "p3", "p1"]);

    // …and the persisted photo_ids order — what the PDF's continuous photo
    // numbering walks — autosaves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0] as {
      sections: Array<{ photo_ids: string[] }>;
    };
    expect(payload.sections[0].photo_ids).toEqual(["p2", "p3", "p1"]);
  });
});

describe("PhotoReportBuilder — on-demand Preview pane (#554)", () => {
  it("renders the real report PDF in a pane when Preview is clicked", async () => {
    renderBuilder();

    // On demand, not live: nothing renders until the author asks for it.
    expect(screen.queryByTestId("report-preview-frame")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    // The shared no-drift producer rendered THIS report; its blob is handed to
    // the in-app viewer as a blob: URL — byte-identical to what Generate uploads.
    const frame = await screen.findByTestId("report-preview-frame");
    expect(vi.mocked(renderReportPdfBlob)).toHaveBeenCalledWith("report-1");
    expect(frame.getAttribute("data-src")).toMatch(/^blob:/);
  });

  it("refreshes only on click — an edit never re-renders, the Refresh control does", async () => {
    renderBuilder();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    const frame = await screen.findByTestId("report-preview-frame");
    expect(vi.mocked(renderReportPdfBlob)).toHaveBeenCalledTimes(1);
    const firstSrc = frame.getAttribute("data-src");

    // Editing the report leaves the open pane untouched — preview is on demand,
    // not a live re-render on every keystroke (criterion b).
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Edited title" },
      });
    });
    expect(vi.mocked(renderReportPdfBlob)).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("report-preview-frame").getAttribute("data-src"),
    ).toBe(firstSrc);

    // The pane's Refresh control re-renders with the latest report, on demand.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    });
    expect(vi.mocked(renderReportPdfBlob)).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId("report-preview-frame").getAttribute("data-src"),
    ).not.toBe(firstSrc);
  });

  it("flushes a pending edit before rendering, so the preview reflects it (#441)", async () => {
    renderBuilder();

    // Edit the title but don't let the 2s auto-save debounce elapse.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Latest title" },
      });
    });
    expect(h.updateMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    await screen.findByTestId("report-preview-frame");

    // The producer re-reads the persisted row, so the edit was written first…
    expect(h.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Latest title" }),
    );
    // …BEFORE the producer ran — Preview == Generate, never a stale render (#441).
    expect(h.updateMock.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(renderReportPdfBlob).mock.invocationCallOrder[0],
    );
  });

  it("does not render a preview when flushing the pending edit fails (#441)", async () => {
    h.errorOnSave = true;
    renderBuilder();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Report title"), {
        target: { value: "Latest title" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    // The flush failed; the producer (which would render the older persisted row)
    // must not run — better no preview than a stale one. The pane stays closed.
    expect(vi.mocked(renderReportPdfBlob)).not.toHaveBeenCalled();
    expect(screen.queryByTestId("report-preview-frame")).toBeNull();
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });

  it("refreshing revokes the stale object URL before showing the new render", async () => {
    renderBuilder();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    const firstSrc = (
      await screen.findByTestId("report-preview-frame")
    ).getAttribute("data-src");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    });

    // The new render mints a fresh blob URL and the one it replaced is revoked,
    // so stale renders don't pile up in memory while the pane stays open.
    const nextSrc = screen
      .getByTestId("report-preview-frame")
      .getAttribute("data-src");
    expect(nextSrc).not.toBe(firstSrc);
    expect(revokeObjectURL).toHaveBeenCalledWith(firstSrc);
  });

  it("closing the pane clears it and revokes its object URL (no leak)", async () => {
    renderBuilder();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    const frame = await screen.findByTestId("report-preview-frame");
    const openSrc = frame.getAttribute("data-src");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    });

    // The pane is gone and the blob URL it held is revoked — the browser frees
    // the rendered PDF rather than leaking it for the tab's lifetime.
    expect(screen.queryByTestId("report-preview-frame")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith(openSrc);
  });

  it("opens as a slide-over: a fixed right-anchored panel over a dimmed backdrop", async () => {
    renderBuilder();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    // Option B: the pane overlays the editor (criterion d) instead of reflowing
    // the page — a fixed panel pinned to the right, identical at every width.
    const dialog = await screen.findByRole("dialog", {
      name: "Report preview",
    });
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("right-0");

    // A dimmed backdrop sits behind it, separating the slide-over from the editor.
    expect(screen.getByTestId("preview-backdrop")).toBeTruthy();
  });

  it("dismisses the slide-over when the dimmed backdrop is clicked", async () => {
    renderBuilder();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    const openSrc = (
      await screen.findByTestId("report-preview-frame")
    ).getAttribute("data-src");

    await act(async () => {
      fireEvent.click(screen.getByTestId("preview-backdrop"));
    });

    // Tapping outside the panel dismisses it, just like the ✕ — and frees the blob.
    expect(screen.queryByTestId("report-preview-frame")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith(openSrc);
  });
});

describe("PhotoReportBuilder — Section thumbnail size (#2)", () => {
  it("renders the Section photo grid at the larger 120px min column", () => {
    const report = makeReport({
      sections: [
        { id: "sec-a", title: "Roof", description: "", photo_ids: ["p1"] },
      ],
    });
    const { container } = renderBuilder(report, [makePhoto("p1")]);
    expect(container.querySelector('[class*="minmax(120px"]')).not.toBeNull();
    expect(container.querySelector('[class*="minmax(96px"]')).toBeNull();
  });
});

describe("PhotoReportBuilder — enlarge & annotate a Section photo (#1, #3)", () => {
  beforeEach(() => {
    capturedViewerProps = null;
    capturedAnnotatorProps = null;
    nav.refresh.mockClear();
  });

  function reportWith(ids: string[]): PhotoReport {
    return makeReport({
      sections: [
        { id: "sec-a", title: "Roof", description: "", photo_ids: ids },
      ],
    });
  }

  function sectionEl() {
    return screen.getByLabelText("Section heading").closest("section")!;
  }

  it("opens the viewer scoped to the Section at the clicked photo", () => {
    renderBuilder(reportWith(["p1", "p2"]), [makePhoto("p1"), makePhoto("p2")]);
    const imgs = within(sectionEl()).getAllByAltText("Photo");
    fireEvent.click(imgs[1]);
    expect(capturedViewerProps.open).toBe(true);
    expect(capturedViewerProps.photos.map((p: Photo) => p.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(capturedViewerProps.initialPhotoIndex).toBe(1);
  });

  it("removes a photo via the X overlay without opening the viewer", () => {
    renderBuilder(reportWith(["p1"]), [makePhoto("p1")]);
    const section = sectionEl();
    fireEvent.click(
      within(section).getByLabelText("Remove photo from report"),
    );
    expect(within(section).queryByAltText("Photo")).toBeNull();
    expect(capturedViewerProps?.open ?? false).toBe(false);
  });

  it("opens the annotator from the viewer's Edit and refreshes after a save", () => {
    renderBuilder(reportWith(["p1"]), [makePhoto("p1")]);
    fireEvent.click(within(sectionEl()).getByAltText("Photo"));
    fireEvent.click(screen.getByTestId("viewer-annotate"));
    expect(capturedAnnotatorProps.open).toBe(true);
    expect(capturedAnnotatorProps.photos.map((p: Photo) => p.id)).toEqual([
      "p1",
    ]);
    expect(capturedAnnotatorProps.initialPhotoIndex).toBe(0);
    fireEvent.click(screen.getByTestId("annotator-save"));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the builder after a viewer edit/delete", () => {
    renderBuilder(reportWith(["p1"]), [makePhoto("p1")]);
    fireEvent.click(within(sectionEl()).getByAltText("Photo"));
    fireEvent.click(screen.getByTestId("viewer-updated"));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});

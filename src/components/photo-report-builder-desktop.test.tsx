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

import type { Photo, PhotoReport } from "@/lib/types";

const h = vi.hoisted(() => ({
  updateMock: vi.fn<(payload: Record<string, unknown>) => void>(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        h.updateMock(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/generate-report-pdf", () => ({
  generateReportPDF: vi.fn(async () => "job-1/report-1.pdf"),
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

function renderBuilder(report = makeReport(), photos: Photo[] = []) {
  return render(
    <PhotoReportBuilder
      jobId="job-1"
      report={report}
      photos={photos}
      supabaseUrl="https://example.supabase.co"
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.updateMock.mockClear();
  capturedOnDragEnd = null;
  capturedSortableIds = [];
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Unmount while fetch is still stubbed so a dirty builder's teardown flush
  // (#443) hits the inert mock (see photo-report-builder.test.tsx).
  cleanup();
  vi.unstubAllGlobals();
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

describe("PhotoReportBuilder — desktop top-bar placeholders (#548)", () => {
  it("offers desktop-only gear and Preview placeholders while Generate stays the one real action", () => {
    renderBuilder();

    // Gear (Report Settings, per the glossary) and Preview ship as disabled
    // desktop-only placeholders this slice; later slices wire them up.
    const gear = screen.getByRole("button", { name: "Report settings" });
    const preview = screen.getByRole("button", { name: "Preview" });
    for (const el of [gear, preview]) {
      const t = el.className.split(/\s+/);
      expect(t).toContain("hidden");
      expect(t).toContain("lg:inline-flex");
      expect((el as HTMLButtonElement).disabled).toBe(true);
    }

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

// Integration test for the template branch of handleDragEnd. Mounts the
// EstimateBuilder with a minimal seeded template, simulates a programmatic
// cross-container DragEndEvent via a mocked @dnd-kit/core DndContext, and
// asserts on the on-screen tree + auto-expand behaviour. Establishes the
// dnd-kit RTL test pattern for this repo.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, act } from "@testing-library/react";

import type {
  BuilderEntity,
  TemplateWithContents,
} from "@/lib/types";

// ── Mock @dnd-kit/core to capture the onDragEnd callback ─────────────────────
// Real SortableContext / useSortable from @dnd-kit/sortable are left intact so
// the cards still render; we only need a way to dispatch synthetic drag-end
// events at the test layer.

type Listener = {
  onDragEnd?: (e: unknown) => void;
};

let capturedRootOnDragEnd: ((e: unknown) => void) | null = null;
let listeners: Listener[] = [];

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>(
    "@dnd-kit/core",
  );
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd?: (e: unknown) => void;
    }) => {
      capturedRootOnDragEnd = onDragEnd ?? null;
      return <>{children}</>;
    },
    useDndMonitor: (l: Listener) => {
      listeners.push(l);
    },
  };
});

// Stub the auto-save hook so no fetch is fired during the test.
vi.mock("./use-auto-save", () => ({
  useAutoSave: () => ({
    saveStatus: "idle",
    lastSavedAt: null,
    saveSectionsReorder: vi.fn(async () => true),
    saveLineItemsReorder: vi.fn(async () => true),
  }),
}));

// next/navigation router stub.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// ── Helpers to dispatch synthetic drag-end events ────────────────────────────

import { EstimateBuilder } from "./estimate-builder";
import React from "react";

function dispatchDragEnd(event: unknown) {
  act(() => {
    capturedRootOnDragEnd?.(event);
    for (const l of listeners) l.onDragEnd?.(event);
  });
}

function makeDragEndEvent(opts: {
  activeId: string;
  overId: string;
  activeParentSectionId: string;
  overType: "line-item" | "section" | "subsection";
  overParentSectionId?: string;
}): unknown {
  return {
    active: {
      id: opts.activeId,
      data: {
        current: {
          type: "line-item",
          parentSectionId: opts.activeParentSectionId,
        },
      },
    },
    over: {
      id: opts.overId,
      data: {
        current:
          opts.overType === "line-item"
            ? {
                type: "line-item",
                parentSectionId: opts.overParentSectionId ?? "",
              }
            : opts.overType === "subsection"
            ? {
                type: "subsection",
                parentSectionId: opts.overParentSectionId ?? "",
              }
            : { type: "section" },
      },
    },
  };
}

// ── Minimal seeded template entity ───────────────────────────────────────────

function makeTemplateEntity(): BuilderEntity {
  const template: TemplateWithContents = {
    id: "tmpl-1",
    organization_id: "org-1",
    name: "Drag-end test template",
    description: null,
    damage_type_tags: [],
    opening_statement: null,
    closing_statement: null,
    structure: { sections: [] },
    is_active: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    sections: [
      {
        id: "S1",
        title: "Roof",
        sort_order: 0,
        parent_section_id: null,
        items: [
          {
            id: "A",
            library_item_id: null,
            name: "Tear-off",
            description: "Remove existing shingles",
            note: null,
            code: null,
            quantity: 1,
            unit: null,
            unit_price: 100,
            sort_order: 0,
          },
        ],
        subsections: [
          {
            id: "Sub1",
            title: "Flashing",
            sort_order: 0,
            items: [
              {
                id: "X",
                library_item_id: null,
                name: "Step flashing",
                description: "Install step flashing",
                note: null,
                code: null,
                quantity: 10,
                unit: null,
                unit_price: 5,
                sort_order: 0,
              },
            ],
          },
        ],
      },
      {
        id: "S2",
        title: "Gutters",
        sort_order: 1,
        parent_section_id: null,
        items: [],
        subsections: [],
      },
    ],
  };
  return { kind: "template", data: template };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedRootOnDragEnd = null;
  listeners = [];
});

describe("EstimateBuilder template drag-end", () => {
  it("moves a Line item from a Subsection into its parent Section's direct items", () => {
    render(<EstimateBuilder entity={makeTemplateEntity()} />);

    // Sanity: X is rendered initially (Subsection is expanded by default).
    expect(screen.getByDisplayValue("Step flashing")).toBeDefined();

    dispatchDragEnd(
      makeDragEndEvent({
        activeId: "X",
        activeParentSectionId: "Sub1",
        overId: "S1",
        overType: "section",
      }),
    );

    // After the drop, X still exists on screen — semantics are that the same
    // row moved containers. Source Subsection should now be empty.
    expect(screen.getByDisplayValue("Step flashing")).toBeDefined();
    // Empty subsection placeholder appears.
    expect(screen.getByText("No items yet.")).toBeDefined();
  });

  it("auto-expands a collapsed destination Section on drop", () => {
    render(<EstimateBuilder entity={makeTemplateEntity()} />);

    // Collapse S2 by clicking its collapse button.
    const s2Heading = screen.getByText("Gutters");
    const s2Card = s2Heading.closest("li");
    expect(s2Card).not.toBeNull();
    const collapseBtn = within(s2Card as HTMLElement).getByRole("button", {
      name: /collapse section/i,
    });
    act(() => {
      collapseBtn.click();
    });
    // Verify the body is hidden — the "No subsections or items yet." copy is
    // inside the body, which is now removed.
    expect(within(s2Card as HTMLElement).queryByText(/No subsections or items yet\./i)).toBeNull();
    // The toggle should now read "Expand section".
    expect(
      within(s2Card as HTMLElement).getByRole("button", { name: /expand section/i }),
    ).toBeDefined();

    // Drop A from S1 onto S2's chrome.
    dispatchDragEnd(
      makeDragEndEvent({
        activeId: "A",
        activeParentSectionId: "S1",
        overId: "S2",
        overType: "section",
      }),
    );

    // S2 should re-expand — the collapse-toggle's accessible name flips back
    // to "Collapse section".
    expect(
      within(s2Card as HTMLElement).getByRole("button", { name: /collapse section/i }),
    ).toBeDefined();
  });

  it("reorders a Line item within its own container (regression for existing reorder)", () => {
    // Use an entity with two items in the same container so we can swap them.
    const entity = makeTemplateEntity();
    const s1 = entity.data.kind === undefined ? null : null;
    void s1;
    const template = (entity as { data: TemplateWithContents }).data;
    template.sections[0].items.push({
      id: "B",
      library_item_id: null,
      name: "Underlayment",
      description: "Install underlayment",
      note: null,
      code: null,
      quantity: 30,
      unit: null,
      unit_price: 2,
      sort_order: 1,
    });

    render(<EstimateBuilder entity={entity} />);

    // Drop A onto B — within-container reorder.
    dispatchDragEnd(
      makeDragEndEvent({
        activeId: "A",
        activeParentSectionId: "S1",
        overId: "B",
        overType: "line-item",
        overParentSectionId: "S1",
      }),
    );

    // Both items still rendered.
    expect(screen.getByDisplayValue("Tear-off")).toBeDefined();
    expect(screen.getByDisplayValue("Underlayment")).toBeDefined();
  });
});

// Integration test for the invoice branch of handleDragEnd (#267). Mounts
// the EstimateBuilder with a minimal seeded InvoiceWithContents, dispatches
// synthetic cross-container DragEndEvents via a mocked @dnd-kit/core
// DndContext, and asserts on (a) the on-screen tree, (b) the
// saveLineItemsReorder payload, and (c) the rollback-on-failure flow.
//
// Mirrors estimate-drag-end.test.tsx; the invoice-only twist is the
// defensive section_id !== null filter on the payload — InvoiceLineItem.
// section_id is `string | null` in the type system even though the builder
// UI never produces orphan items.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, act } from "@testing-library/react";

import type {
  BuilderEntity,
  InvoiceWithContents,
} from "@/lib/types";

// ── Mock @dnd-kit/core to capture the onDragEnd callback ─────────────────────

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

const { saveLineItemsReorderMock, toastErrorMock } = vi.hoisted(() => ({
  saveLineItemsReorderMock: vi.fn<
    (items: Array<{ id: string; section_id: string; sort_order: number }>) => Promise<boolean>
  >(async () => true),
  toastErrorMock: vi.fn(),
}));

vi.mock("./use-auto-save", () => ({
  useAutoSave: () => ({
    saveStatus: "idle",
    lastSavedAt: null,
    saveSectionsReorder: vi.fn(async () => true),
    saveLineItemsReorder: saveLineItemsReorderMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

// ── Minimal seeded invoice entity ────────────────────────────────────────────

function makeInvoiceEntity(): BuilderEntity {
  const invoice: InvoiceWithContents = {
    id: "inv-1",
    organization_id: "org-1",
    job_id: "job-1",
    invoice_number: "INV-1",
    sequence_number: 1,
    title: "Drag-end test invoice",
    status: "draft",
    issued_date: "2026-01-01",
    due_date: null,
    opening_statement: null,
    closing_statement: null,
    subtotal: 150,
    markup_type: "none",
    markup_value: 0,
    markup_amount: 0,
    discount_type: "none",
    discount_value: 0,
    discount_amount: 0,
    adjusted_subtotal: 150,
    tax_rate: 0,
    tax_amount: 0,
    total_amount: 150,
    po_number: null,
    memo: null,
    notes: null,
    converted_from_estimate_id: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    qb_invoice_id: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_sent_at: null,
    last_sent_to_email: null,
    deleted_at: null,
    delete_reason: null,
    pdf_layout: null,
    sections: [
      {
        id: "S1",
        organization_id: "org-1",
        invoice_id: "inv-1",
        parent_section_id: null,
        title: "Roof",
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [
          {
            id: "A",
            organization_id: "org-1",
            invoice_id: "inv-1",
            section_id: "S1",
            library_item_id: null,
            name: "Tear-off",
            description: "Remove existing shingles",
            note: null,
            code: null,
            quantity: 1,
            unit: null,
            unit_price: 100,
            amount: 100,
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        subsections: [
          {
            id: "Sub1",
            organization_id: "org-1",
            invoice_id: "inv-1",
            parent_section_id: "S1",
            title: "Flashing",
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            items: [
              {
                id: "X",
                organization_id: "org-1",
                invoice_id: "inv-1",
                section_id: "Sub1",
                library_item_id: null,
                name: "Step flashing",
                description: "Install step flashing",
                note: null,
                code: null,
                quantity: 10,
                unit: null,
                unit_price: 5,
                amount: 50,
                sort_order: 0,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        ],
      },
      {
        id: "S2",
        organization_id: "org-1",
        invoice_id: "inv-1",
        parent_section_id: null,
        title: "Gutters",
        sort_order: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [],
        subsections: [],
      },
    ],
  };
  return { kind: "invoice", data: invoice };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedRootOnDragEnd = null;
  listeners = [];
  saveLineItemsReorderMock.mockClear();
  saveLineItemsReorderMock.mockImplementation(async () => true);
  toastErrorMock.mockClear();
});

describe("EstimateBuilder invoice drag-end", () => {
  it("moves a Line item from a Subsection into its parent Section's direct items and persists every item in both containers", async () => {
    render(<EstimateBuilder entity={makeInvoiceEntity()} />);

    expect(screen.getByText("Step flashing")).toBeDefined();

    dispatchDragEnd(
      makeDragEndEvent({
        activeId: "X",
        activeParentSectionId: "Sub1",
        overId: "S1",
        overType: "section",
      }),
    );

    expect(screen.getByText("Step flashing")).toBeDefined();
    expect(screen.getByText("No items yet.")).toBeDefined();

    expect(saveLineItemsReorderMock).toHaveBeenCalledTimes(1);
    const payload = saveLineItemsReorderMock.mock.calls[0][0];
    const byId = [...payload].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId).toEqual([
      { id: "A", section_id: "S1", sort_order: 0 },
      { id: "X", section_id: "S1", sort_order: 1 },
    ]);
  });

  it("auto-expands a collapsed destination Section on drop", () => {
    render(<EstimateBuilder entity={makeInvoiceEntity()} />);

    const s2Heading = screen.getByText("Gutters");
    const s2Card = s2Heading.closest("li");
    expect(s2Card).not.toBeNull();
    const collapseBtn = within(s2Card as HTMLElement).getByRole("button", {
      name: /collapse section/i,
    });
    act(() => {
      collapseBtn.click();
    });
    expect(
      within(s2Card as HTMLElement).getByRole("button", { name: /expand section/i }),
    ).toBeDefined();

    dispatchDragEnd(
      makeDragEndEvent({
        activeId: "A",
        activeParentSectionId: "S1",
        overId: "S2",
        overType: "section",
      }),
    );

    expect(
      within(s2Card as HTMLElement).getByRole("button", { name: /collapse section/i }),
    ).toBeDefined();
  });

  it("rolls back the visible tree and toasts on a failed save", async () => {
    saveLineItemsReorderMock.mockImplementationOnce(async () => false);

    render(<EstimateBuilder entity={makeInvoiceEntity()} />);

    const sub1Heading = screen.getByText("Flashing");
    const sub1Card = sub1Heading.closest("li");
    expect(sub1Card).not.toBeNull();
    expect(
      within(sub1Card as HTMLElement).getByText("Step flashing"),
    ).toBeDefined();

    await act(async () => {
      capturedRootOnDragEnd?.(
        makeDragEndEvent({
          activeId: "X",
          activeParentSectionId: "Sub1",
          overId: "S1",
          overType: "section",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      within(sub1Card as HTMLElement).getByText("Step flashing"),
    ).toBeDefined();
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to save line item order");
  });

  it("reorders a Line item within its own container (regression for existing same-container reorder)", () => {
    const entity = makeInvoiceEntity() as Extract<
      BuilderEntity,
      { kind: "invoice" }
    >;
    entity.data.sections[0].items.push({
      id: "B",
      organization_id: "org-1",
      invoice_id: "inv-1",
      section_id: "S1",
      library_item_id: null,
      name: "Underlayment",
      description: "Install underlayment",
      note: null,
      code: null,
      quantity: 30,
      unit: null,
      unit_price: 2,
      amount: 60,
      sort_order: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });

    render(<EstimateBuilder entity={entity} />);

    dispatchDragEnd(
      makeDragEndEvent({
        activeId: "A",
        activeParentSectionId: "S1",
        overId: "B",
        overType: "line-item",
        overParentSectionId: "S1",
      }),
    );

    expect(screen.getByText("Tear-off")).toBeDefined();
    expect(screen.getByText("Underlayment")).toBeDefined();

    expect(saveLineItemsReorderMock).toHaveBeenCalledTimes(1);
    const payload = saveLineItemsReorderMock.mock.calls[0][0];
    const byId = [...payload].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId).toEqual([
      { id: "A", section_id: "S1", sort_order: 1 },
      { id: "B", section_id: "S1", sort_order: 0 },
    ]);
  });
});

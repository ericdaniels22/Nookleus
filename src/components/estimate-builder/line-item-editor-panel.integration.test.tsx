// Integration tests for #544 — the LineItemEditorPanel wired into the real
// EstimateBuilder. We mount the actual builder (with auto-save / toast / router
// mocked, exactly as estimate-drag-end.test.tsx does) and drive selection by
// clicking real line-item rows.
//
// The load-bearing assertion technique: BuilderLayout renders the document
// (<main data-testid="builder-document">) and the editor panel
// (<aside data-testid="builder-editor-panel">) as SIBLINGS. So
// `within(builder-document)` queries the inline row in isolation from the
// panel, letting us prove both surfaces share ONE source of truth — an edit in
// the panel must show up on the inline row, and vice-versa.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

import type {
  BuilderEntity,
  EstimateLineItem,
  EstimateWithContents,
  InvoiceWithContents,
  TemplateWithContents,
} from "@/lib/types";

// Auto-save is a no-op here — we assert on local state + the onChange pathway,
// not on persistence (that's covered by use-auto-save's own tests).
vi.mock("./use-auto-save", () => ({
  useAutoSave: () => ({
    saveStatus: "idle",
    lastSavedAt: null,
    saveSectionsReorder: vi.fn(async () => true),
    saveLineItemsReorder: vi.fn(async () => true),
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Stub AddItemDialog: when open, render a single confirm button that emits a
// blank new line into the target section (mirrors the real dialog's onAdded
// contract). Closed → renders nothing, so it's inert for every other test.
vi.mock("./add-item-dialog", () => ({
  AddItemDialog: ({
    open,
    sectionId,
    onAdded,
  }: {
    open: boolean;
    sectionId: string;
    onAdded: (item: EstimateLineItem) => void;
  }) =>
    open ? (
      <button
        data-testid="mock-add-confirm"
        onClick={() =>
          onAdded({
            id: "NEW",
            organization_id: "org-1",
            estimate_id: "est-1",
            section_id: sectionId,
            library_item_id: null,
            name: "",
            description: "New line",
            note: null,
            code: null,
            quantity: 1,
            unit: null,
            unit_price: 0,
            total: 0,
            sort_order: 99,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          })
        }
      >
        add
      </button>
    ) : null,
}));

import { EstimateBuilder } from "./estimate-builder";

// ── matchMedia mock — drives the panel's desktop-dock vs phone-sheet variant ──
function setMatchMedia(isDesktop: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
}

// ── Minimal seeded estimate entity (mirrors estimate-drag-end.test.tsx) ───────
// S1 "Roof" → direct item A "Tear-off" (qty 1 × $100) + subsection Sub1
// "Flashing" → item X "Step flashing" (qty 10 × $5). S2 "Gutters" is empty.
function makeEstimateEntity(): BuilderEntity {
  const estimate: EstimateWithContents = {
    id: "est-1",
    organization_id: "org-1",
    job_id: "job-1",
    estimate_number: "EST-1",
    sequence_number: 1,
    title: "Editor-panel test estimate",
    status: "draft",
    opening_statement: null,
    closing_statement: null,
    subtotal: 150,
    markup_type: "none",
    markup_value: 0,
    markup_amount: 0,
    overhead_type: "none",
    overhead_value: 0,
    overhead_amount: 0,
    profit_type: "none",
    profit_value: 0,
    profit_amount: 0,
    discount_type: "none",
    discount_value: 0,
    discount_amount: 0,
    adjusted_subtotal: 150,
    tax_rate: 0,
    tax_amount: 0,
    total: 150,
    issued_date: null,
    valid_until: null,
    converted_to_invoice_id: null,
    converted_at: null,
    sent_at: null,
    approved_at: null,
    rejected_at: null,
    voided_at: null,
    void_reason: null,
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
        estimate_id: "est-1",
        parent_section_id: null,
        title: "Roof",
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [
          {
            id: "A",
            organization_id: "org-1",
            estimate_id: "est-1",
            section_id: "S1",
            library_item_id: null,
            name: "Tear-off",
            description: "Remove existing shingles",
            note: null,
            code: "RF-100",
            quantity: 1,
            unit: "sq",
            unit_price: 100,
            total: 100,
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        subsections: [
          {
            id: "Sub1",
            organization_id: "org-1",
            estimate_id: "est-1",
            parent_section_id: "S1",
            title: "Flashing",
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            items: [
              {
                id: "X",
                organization_id: "org-1",
                estimate_id: "est-1",
                section_id: "Sub1",
                library_item_id: null,
                name: "Step flashing",
                description: "Install step flashing",
                note: null,
                code: null,
                quantity: 10,
                unit: null,
                unit_price: 5,
                total: 50,
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
        estimate_id: "est-1",
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
  return { kind: "estimate", data: estimate };
}

// ── Minimal seeded invoice entity ─────────────────────────────────────────────
// One section "Exterior" → item B "Soffit repair" (qty 2 × $75, amount 150).
function makeInvoiceEntity(): BuilderEntity {
  const invoice: InvoiceWithContents = {
    id: "inv-1",
    organization_id: "org-1",
    job_id: "job-1",
    invoice_number: "INV-1",
    sequence_number: 1,
    title: "Editor-panel test invoice",
    status: "draft",
    issued_date: "2026-01-01",
    due_date: null,
    opening_statement: null,
    closing_statement: null,
    subtotal: 150,
    markup_type: "none",
    markup_value: 0,
    markup_amount: 0,
    overhead_type: "none",
    overhead_value: 0,
    overhead_amount: 0,
    profit_type: "none",
    profit_value: 0,
    profit_amount: 0,
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
        id: "IS1",
        organization_id: "org-1",
        invoice_id: "inv-1",
        parent_section_id: null,
        title: "Exterior",
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [
          {
            id: "B",
            organization_id: "org-1",
            invoice_id: "inv-1",
            section_id: "IS1",
            library_item_id: null,
            name: "Soffit repair",
            description: "Replace damaged soffit",
            note: null,
            code: "EX-200",
            quantity: 2,
            unit: "lf",
            unit_price: 75,
            amount: 150,
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        subsections: [],
      },
    ],
  };
  return { kind: "invoice", data: invoice };
}

// ── Minimal seeded template entity ────────────────────────────────────────────
// One section "Labor" → item T "Install shingles" (qty 20 × $40).
function makeTemplateEntity(): BuilderEntity {
  const template: TemplateWithContents = {
    id: "tpl-1",
    organization_id: "org-1",
    name: "Roof replacement template",
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
        id: "TS1",
        title: "Labor",
        sort_order: 0,
        parent_section_id: null,
        items: [
          {
            id: "T",
            library_item_id: null,
            name: "Install shingles",
            description: "Install architectural shingles",
            note: null,
            code: "LB-300",
            quantity: 20,
            unit: "sq",
            unit_price: 40,
            sort_order: 0,
          },
        ],
        subsections: [],
      },
    ],
  };
  return { kind: "template", data: template };
}

// A voided estimate — fields render disabled, but a line can still be selected
// to view it in the (read-only) panel.
function makeVoidedEstimateEntity(): BuilderEntity {
  const e = makeEstimateEntity();
  if (e.kind === "estimate") {
    e.data.status = "voided";
    e.data.voided_at = "2026-02-01T00:00:00Z";
    e.data.void_reason = "Customer cancelled";
  }
  return e;
}

// Click the inline row whose static name text reads `name`. Scoped to the
// document surface so it never accidentally matches the editor panel's own
// name field (the panel is a sibling of builder-document, not inside it).
function selectRowByName(name: string) {
  const doc = screen.getByTestId("builder-document");
  fireEvent.click(within(doc).getByText(name));
}

// Click the row CONTAINER explicitly (vs. its text). Rows are display-only
// since #546, so a text click already bubbles to select — but read-only modes
// keep this for clarity about what is being clicked.
function clickRowContainer(name: string) {
  const doc = screen.getByTestId("builder-document");
  const row = within(doc)
    .getByText(name)
    .closest('[data-testid="line-item-row"]') as HTMLElement;
  fireEvent.click(row);
}

beforeEach(() => {
  setMatchMedia(true);
});

describe("EstimateBuilder × LineItemEditorPanel (#544)", () => {
  it("opens the editor panel seeded with the clicked line", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    // No editor panel until a line is selected.
    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();

    selectRowByName("Tear-off");

    // The panel mounts, seeded from the clicked line.
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Tear-off");
  });

  it("visibly highlights the selected row (data-selected)", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    const doc = screen.getByTestId("builder-document");
    const rowName = within(doc).getByText("Tear-off");
    const row = rowName.closest('[data-testid="line-item-row"]');
    expect(row).not.toBeNull();

    // Not highlighted until selected.
    expect((row as HTMLElement).getAttribute("data-selected")).toBeNull();

    fireEvent.click(rowName);

    expect((row as HTMLElement).getAttribute("data-selected")).toBe("true");
  });

  it("seeds the panel with the selected line's fields", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");

    const panel = screen.getByTestId("builder-editor-panel");
    const field = (id: string) =>
      within(panel).getByTestId(id) as HTMLInputElement;

    expect(field("editor-field-name").value).toBe("Tear-off");
    expect(field("editor-field-code").value).toBe("RF-100");
    expect(field("editor-field-quantity").value).toBe("1");
    expect(field("editor-field-unit").value).toBe("sq");
    expect(field("editor-field-description").value).toBe(
      "Remove existing shingles",
    );
    // Unit cost is rendered through MoneyInput inside the unit-cost cell.
    expect(
      within(within(panel).getByTestId("editor-field-unit-cost")).getByDisplayValue(
        "100",
      ),
    ).toBeDefined();
    // Live line total = qty 1 × $100.
    expect(within(panel).getByTestId("editor-line-total").textContent).toBe(
      "$100.00",
    );
  });

  it("commits a panel unit-cost edit through to the inline row (one source of truth)", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");

    // Edit unit cost in the PANEL (the aside), commit on blur.
    const panel = screen.getByTestId("builder-editor-panel");
    const panelCost = within(
      within(panel).getByTestId("editor-field-unit-cost"),
    ).getByDisplayValue("100");
    fireEvent.change(panelCost, { target: { value: "250" } });
    fireEvent.blur(panelCost);

    // The INLINE row (inside the document, not the panel) now shows the new
    // unit cost and recomputed total as static currency — both surfaces share
    // one model. With qty 1, the unit-price cell and the total cell both read
    // $250.00, and the old $100.00 is gone from the row.
    const doc = screen.getByTestId("builder-document");
    expect(within(doc).getAllByText("$250.00").length).toBe(2);
    expect(within(doc).queryByText("$100.00")).toBeNull();
  });

  it("renders the editor docked on desktop (no scrim)", () => {
    setMatchMedia(true);
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");

    expect(
      screen.getByTestId("line-item-editor-panel").getAttribute("data-variant"),
    ).toBe("desktop");
    expect(screen.queryByTestId("editor-scrim")).toBeNull();
  });

  it("renders the editor as a slide-up sheet on phone (with tap-dismiss scrim)", () => {
    setMatchMedia(false);
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");

    expect(
      screen.getByTestId("line-item-editor-panel").getAttribute("data-variant"),
    ).toBe("phone");
    expect(screen.getByTestId("editor-scrim")).toBeDefined();
  });

  it("works in invoice mode — selecting opens the panel seeded from the line", () => {
    render(<EstimateBuilder entity={makeInvoiceEntity()} />);

    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();

    selectRowByName("Soffit repair");

    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Soffit repair");
  });

  it("works in template mode — shows the panel but never a totals bar", () => {
    render(<EstimateBuilder entity={makeTemplateEntity()} />);

    // Templates have no totals bar, before or after selection.
    expect(screen.queryByTestId("builder-totals-bar")).toBeNull();
    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();

    selectRowByName("Install shingles");

    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Install shingles");
    expect(screen.queryByTestId("builder-totals-bar")).toBeNull();
  });

  it("swaps the panel contents when a different line is selected", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    selectRowByName("Tear-off");
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Tear-off");

    // Select the subsection line X — the panel re-seeds onto it.
    selectRowByName("Step flashing");
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Step flashing");
  });

  it("auto-selects a newly added line, opening the panel with the name focused", async () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    // Open the add-item flow via the "+ Add" toolbar menu (#573). New entries
    // land in the LAST section — the empty "Gutters" section in this fixture.
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /new item/i }));

    // Confirm via the mocked dialog → a blank line is inserted.
    fireEvent.click(screen.getByTestId("mock-add-confirm"));

    // The new line is auto-selected: panel open, blank name, cursor in the name.
    const panel = screen.getByTestId("builder-editor-panel");
    const nameField = within(panel).getByTestId(
      "editor-field-name",
    ) as HTMLInputElement;
    expect(nameField.value).toBe("");
    expect(document.activeElement).toBe(nameField);
  });

  it("clears the selection and closes the panel when the selected line is deleted", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    selectRowByName("Tear-off");
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();

    const doc = screen.getByTestId("builder-document");
    const rowA = within(doc)
      .getByText("Tear-off")
      .closest('[data-testid="line-item-row"]') as HTMLElement;
    fireEvent.click(
      within(rowA).getByRole("button", { name: /delete line item/i }),
    );

    // Optimistic removal drops A from the model → selection auto-clears → panel
    // unmounts.
    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("keeps the selection when a different (non-selected) line is deleted", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    selectRowByName("Tear-off");
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Tear-off");

    // Delete the OTHER line (X, in the subsection) via its delete button.
    const doc = screen.getByTestId("builder-document");
    const rowX = within(doc)
      .getByText("Step flashing")
      .closest('[data-testid="line-item-row"]') as HTMLElement;
    fireEvent.click(
      within(rowX).getByRole("button", { name: /delete line item/i }),
    );

    // A stays selected — clicking delete must not also select X's row.
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Tear-off");

    vi.unstubAllGlobals();
  });

  it("makes the row display-only — selecting it is the sole path to edit (#546)", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    const doc = screen.getByTestId("builder-document");

    // The row carries no inline inputs anymore — every field is static text.
    const rowA = within(doc)
      .getByText("Tear-off")
      .closest('[data-testid="line-item-row"]') as HTMLElement;
    expect(within(rowA).queryByRole("textbox")).toBeNull();
    expect(within(rowA).queryByRole("spinbutton")).toBeNull();

    // Editing is reached only by selecting the row, which opens the panel.
    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();
    fireEvent.click(within(doc).getByText("Tear-off"));
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();
  });

  it("opens the panel with disabled fields on a voided (read-only) estimate", () => {
    render(<EstimateBuilder entity={makeVoidedEstimateEntity()} />);

    // Disabled inputs don't dispatch clicks — select via the row container.
    clickRowContainer("Tear-off");

    const panel = screen.getByTestId("builder-editor-panel");
    expect(
      (within(panel).getByTestId("editor-field-name") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(panel).getByTestId("editor-field-quantity") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        within(panel).getByTestId(
          "editor-field-description",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
  });

  it("closes the panel via the close control", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");

    const panel = screen.getByTestId("builder-editor-panel");
    fireEvent.click(
      within(panel).getByRole("button", { name: /close editor/i }),
    );

    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();
  });

  it("closes the panel on Escape", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");

    fireEvent.keyDown(screen.getByTestId("line-item-editor-panel"), {
      key: "Escape",
    });

    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();
  });

  it("closes the panel when the phone scrim is tapped", () => {
    setMatchMedia(false);
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");

    fireEvent.click(screen.getByTestId("editor-scrim"));

    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();
  });

  it("closes the panel when empty document space is clicked", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);
    selectRowByName("Tear-off");
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();

    // Click the document surface itself (empty space, not a row).
    fireEvent.click(screen.getByTestId("builder-document"));

    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();
  });
});

// Issue #630 — the editor panel's touch-accessible "Delete line item" button,
// wired to the builder's delete handler at all three call sites. These prove the
// button reaches the same optimistic-remove pathway the row's hover trash uses,
// so a line can be deleted by tapping the panel — the only delete path on touch.
//
// The row ALSO carries a "Delete line item" button (the hover one), so the
// panel button is queried scoped to the editor aside, never globally.
describe("EstimateBuilder × editor delete button (#630)", () => {
  function panelDeleteButton() {
    return within(screen.getByTestId("builder-editor-panel")).getByRole(
      "button",
      { name: /delete line item/i },
    );
  }

  it("deletes the selected estimate line via the panel button and closes the editor", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    selectRowByName("Tear-off");
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();

    fireEvent.click(panelDeleteButton());

    // The line is optimistically removed from the document, and the selection
    // clears as it leaves the live id set, so the panel unmounts.
    const doc = screen.getByTestId("builder-document");
    expect(within(doc).queryByText("Tear-off")).toBeNull();
    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("deletes the selected invoice line via the panel button and closes the editor", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    render(<EstimateBuilder entity={makeInvoiceEntity()} />);

    selectRowByName("Soffit repair");
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();

    fireEvent.click(panelDeleteButton());

    const doc = screen.getByTestId("builder-document");
    expect(within(doc).queryByText("Soffit repair")).toBeNull();
    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("deletes the selected template line via the panel button and closes the editor", () => {
    // Template delete is local-only (no HTTP) — rootPut auto-save persists.
    render(<EstimateBuilder entity={makeTemplateEntity()} />);

    selectRowByName("Install shingles");
    expect(screen.getByTestId("builder-editor-panel")).toBeDefined();

    fireEvent.click(panelDeleteButton());

    const doc = screen.getByTestId("builder-document");
    expect(within(doc).queryByText("Install shingles")).toBeNull();
    expect(screen.queryByTestId("builder-editor-panel")).toBeNull();
  });

  it("hides the panel delete button on a voided (read-only) estimate", () => {
    render(<EstimateBuilder entity={makeVoidedEstimateEntity()} />);

    // Disabled inputs swallow clicks — select via the row container.
    clickRowContainer("Tear-off");

    const panel = screen.getByTestId("builder-editor-panel");
    expect(
      within(panel).queryByRole("button", { name: /delete line item/i }),
    ).toBeNull();
  });
});

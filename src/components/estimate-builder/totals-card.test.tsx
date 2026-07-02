// TotalsCard (#545, #569) — the totals component carrying the computed values
// and inline Markup / Discount / Tax controls. Same totals math as the retired
// TotalsPanel/TotalsBar (this lineage has been a series of presentation/
// placement refactors): compact + tap-to-expand on phones and hidden in
// Template mode.
//
// Query strategy mirrors the retired totals-panel.test.tsx: MoneyInput is a
// text box (role "textbox"); the plain number Input is a number box; the %/$/—
// toggle renders literal "$"/"%" button glyphs, so `$`/`%` checks are scoped to
// a specific field's wrapper rather than asserted via a loose getByText.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { TotalsCard } from "./totals-card";
import type {
  AdjustmentType,
  BuilderEntity,
  BuilderMode,
  EstimateWithContents,
  InvoiceWithContents,
} from "@/lib/types";

interface Overrides {
  markup_type?: AdjustmentType;
  markup_value?: number;
  markup_amount?: number;
  overhead_type?: AdjustmentType;
  overhead_value?: number;
  overhead_amount?: number;
  profit_type?: AdjustmentType;
  profit_value?: number;
  profit_amount?: number;
  discount_type?: AdjustmentType;
  discount_value?: number;
  discount_amount?: number;
  tax_rate?: number;
  tax_amount?: number;
  subtotal?: number;
  adjusted_subtotal?: number;
  total?: number;
}

function makeEstimate(o: Overrides = {}): BuilderEntity {
  const data: EstimateWithContents = {
    id: "est-1",
    organization_id: "org-1",
    job_id: "job-1",
    estimate_number: "EST-1",
    sequence_number: 1,
    title: "Totals test estimate",
    status: "draft",
    opening_statement: null,
    closing_statement: null,
    subtotal: o.subtotal ?? 100,
    markup_type: o.markup_type ?? "none",
    markup_value: o.markup_value ?? 0,
    markup_amount: o.markup_amount ?? 0,
    overhead_type: o.overhead_type ?? "none",
    overhead_value: o.overhead_value ?? 0,
    overhead_amount: o.overhead_amount ?? 0,
    profit_type: o.profit_type ?? "none",
    profit_value: o.profit_value ?? 0,
    profit_amount: o.profit_amount ?? 0,
    discount_type: o.discount_type ?? "none",
    discount_value: o.discount_value ?? 0,
    discount_amount: o.discount_amount ?? 0,
    adjusted_subtotal: o.adjusted_subtotal ?? 100,
    tax_rate: o.tax_rate ?? 0,
    tax_amount: o.tax_amount ?? 0,
    total: o.total ?? 100,
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
    sections: [],
  };
  return { kind: "estimate", data };
}

// Invoice counterpart — same monetary field names as an estimate EXCEPT the
// grand total, which an invoice reads from `total_amount` (not `total`).
function makeInvoice(o: Overrides & { total_amount?: number } = {}): BuilderEntity {
  const data: InvoiceWithContents = {
    id: "inv-1",
    organization_id: "org-1",
    job_id: "job-1",
    invoice_number: "INV-1",
    sequence_number: 1,
    title: "Totals test invoice",
    status: "draft",
    issued_date: "2026-01-01",
    due_date: null,
    opening_statement: null,
    closing_statement: null,
    subtotal: o.subtotal ?? 100,
    markup_type: o.markup_type ?? "none",
    markup_value: o.markup_value ?? 0,
    markup_amount: o.markup_amount ?? 0,
    overhead_type: o.overhead_type ?? "none",
    overhead_value: o.overhead_value ?? 0,
    overhead_amount: o.overhead_amount ?? 0,
    profit_type: o.profit_type ?? "none",
    profit_value: o.profit_value ?? 0,
    profit_amount: o.profit_amount ?? 0,
    discount_type: o.discount_type ?? "none",
    discount_value: o.discount_value ?? 0,
    discount_amount: o.discount_amount ?? 0,
    adjusted_subtotal: o.adjusted_subtotal ?? 100,
    tax_rate: o.tax_rate ?? 0,
    tax_amount: o.tax_amount ?? 0,
    total_amount: o.total_amount ?? 100,
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
    sections: [],
  };
  return { kind: "invoice", data };
}

function renderBar(
  entity: BuilderEntity,
  handlers: Partial<{
    onOverheadChange: (t: AdjustmentType, n: number) => void;
    onProfitChange: (t: AdjustmentType, n: number) => void;
    onDiscountChange: (t: AdjustmentType, n: number) => void;
    onTaxRateChange: (n: number) => void;
    readOnly: boolean;
    mode: BuilderEntity["kind"] | "template";
    editorOpen: boolean;
  }> = {},
) {
  return render(
    <TotalsCard
      entity={entity}
      onOverheadChange={handlers.onOverheadChange ?? vi.fn()}
      onProfitChange={handlers.onProfitChange ?? vi.fn()}
      onDiscountChange={handlers.onDiscountChange ?? vi.fn()}
      onTaxRateChange={handlers.onTaxRateChange ?? vi.fn()}
      readOnly={handlers.readOnly}
      mode={handlers.mode as BuilderMode | undefined}
      editorOpen={handlers.editorOpen}
    />,
  );
}

describe("TotalsCard (#545)", () => {
  it("renders the Subtotal and the grand Total", () => {
    renderBar(makeEstimate({ subtotal: 100, total: 125 }));

    expect(screen.getByText("Subtotal")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("$125.00")).toBeTruthy();
  });

  it("renders Overhead and Profit (not a single Markup) for an estimate", () => {
    // #572 splits the estimate's single Markup into two independent uplifts —
    // Overhead and Profit — each with its own line/toggle. The combined "Markup"
    // label no longer appears on an estimate.
    renderBar(makeEstimate());

    expect(screen.getByText("Overhead")).toBeTruthy();
    expect(screen.getByText("Profit")).toBeTruthy();
    expect(screen.queryByText("Markup")).toBeNull();
    expect(screen.getByText("Discount")).toBeTruthy();
    expect(screen.getByText("Adjusted subtotal")).toBeTruthy();
    expect(screen.getByText("Tax")).toBeTruthy();
  });

  it("renders Overhead and Profit (not a single Markup) for an invoice too", () => {
    // #575 carries the #572 split onto invoices: a converted invoice shows the
    // same Overhead and Profit lines as its estimate. The combined "Markup"
    // label no longer appears on an invoice either.
    renderBar(makeInvoice(), { mode: "invoice" });

    expect(screen.getByText("Overhead")).toBeTruthy();
    expect(screen.getByText("Profit")).toBeTruthy();
    expect(screen.queryByText("Markup")).toBeNull();
  });

  it("edits an invoice's Overhead through its own row, like an estimate", () => {
    // The invoice rows wire to the same onOverheadChange/onProfitChange
    // handlers — there is no invoice-only markup handler anymore.
    const onOverheadChange = vi.fn();
    renderBar(makeInvoice({ overhead_type: "percent", overhead_value: 10 }), {
      mode: "invoice",
      onOverheadChange,
    });

    const box = screen.getByDisplayValue("10") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "15" } });

    expect(onOverheadChange).toHaveBeenCalledWith("percent", 15);
  });

  it("reflects a fixed-amount Overhead change via onOverheadChange", () => {
    const onOverheadChange = vi.fn();
    renderBar(makeEstimate({ overhead_type: "amount", overhead_value: 50 }), {
      onOverheadChange,
    });

    // Overhead is the only amount-typed field here, so the lone MoneyInput
    // textbox is Overhead's.
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("50");

    fireEvent.change(box, { target: { value: "75" } });
    fireEvent.blur(box);

    expect(onOverheadChange).toHaveBeenCalledWith("amount", 75);
  });

  it("reflects a fixed-amount Profit change via onProfitChange", () => {
    const onProfitChange = vi.fn();
    renderBar(makeEstimate({ profit_type: "amount", profit_value: 40 }), {
      onProfitChange,
    });

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("40");

    fireEvent.change(box, { target: { value: "60" } });
    fireEvent.blur(box);

    expect(onProfitChange).toHaveBeenCalledWith("amount", 60);
  });

  it("reflects a fixed-amount Discount change via onDiscountChange", () => {
    const onDiscountChange = vi.fn();
    renderBar(makeEstimate({ discount_type: "amount", discount_value: 25 }), {
      onDiscountChange,
    });

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("25");

    fireEvent.change(box, { target: { value: "30" } });
    fireEvent.blur(box);

    expect(onDiscountChange).toHaveBeenCalledWith("amount", 30);
  });

  it("reflects a Tax rate change via onTaxRateChange", () => {
    const onTaxRateChange = vi.fn();
    renderBar(makeEstimate({ tax_rate: 8.25 }), { onTaxRateChange });

    const tax = screen.getByDisplayValue("8.25") as HTMLInputElement;
    fireEvent.change(tax, { target: { value: "10" } });

    expect(onTaxRateChange).toHaveBeenCalledWith(10);
  });

  it("reflects a percent Overhead change via onOverheadChange", () => {
    const onOverheadChange = vi.fn();
    renderBar(makeEstimate({ overhead_type: "percent", overhead_value: 10 }), {
      onOverheadChange,
    });

    const box = screen.getByDisplayValue("10") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "15" } });

    expect(onOverheadChange).toHaveBeenCalledWith("percent", 15);
  });

  it("reflects a percent Profit change via onProfitChange", () => {
    const onProfitChange = vi.fn();
    renderBar(makeEstimate({ profit_type: "percent", profit_value: 20 }), {
      onProfitChange,
    });

    const box = screen.getByDisplayValue("20") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "25" } });

    expect(onProfitChange).toHaveBeenCalledWith("percent", 25);
  });

  it("toggles Overhead from percent to fixed amount via its own toggle", () => {
    // The %/$/— toggle glyphs repeat across rows, so scope the click to the
    // Overhead row's wrapper. Switching to "$" must fire onOverheadChange with
    // the amount type (carrying the current value through).
    const onOverheadChange = vi.fn();
    renderBar(makeEstimate({ overhead_type: "percent", overhead_value: 10 }), {
      onOverheadChange,
    });

    const overheadRow = screen
      .getByText("Overhead")
      .closest(".space-y-1") as HTMLElement;
    fireEvent.click(within(overheadRow).getByTitle("Fixed amount"));

    expect(onOverheadChange).toHaveBeenCalledWith("amount", 10);
  });

  it("toggles Profit from fixed amount to percent via its own toggle", () => {
    const onProfitChange = vi.fn();
    renderBar(makeEstimate({ profit_type: "amount", profit_value: 50 }), {
      onProfitChange,
    });

    const profitRow = screen
      .getByText("Profit")
      .closest(".space-y-1") as HTMLElement;
    fireEvent.click(within(profitRow).getByTitle("Percent"));

    expect(onProfitChange).toHaveBeenCalledWith("percent", 50);
  });

  it("warns when the grand total is negative", () => {
    renderBar(
      makeEstimate({
        subtotal: 100,
        discount_type: "amount",
        discount_value: 150,
        discount_amount: 150,
        adjusted_subtotal: -50,
        total: -50,
      }),
    );

    expect(screen.getByText("Negative total")).toBeTruthy();
  });

  it("does not warn when the grand total is non-negative", () => {
    renderBar(makeEstimate({ total: 125 }));

    expect(screen.queryByText("Negative total")).toBeNull();
  });

  it("renders nothing in Template mode", () => {
    const { container } = renderBar(makeEstimate({ total: 125 }), {
      mode: "template",
    });

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
  });

  it("reads the grand total from total_amount in invoice mode", () => {
    renderBar(makeInvoice({ subtotal: 200, total_amount: 240 }), {
      mode: "invoice",
    });

    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("$240.00")).toBeTruthy();
  });

  it("disables inline editing when readOnly (e.g. a voided document)", () => {
    renderBar(
      makeEstimate({
        tax_rate: 8.25,
        overhead_type: "percent",
        overhead_value: 10,
      }),
      { readOnly: true },
    );

    // Both the Tax % box and the Overhead adjustment box are disabled, so a
    // voided document's totals can't be edited from the bar.
    expect((screen.getByDisplayValue("8.25") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByDisplayValue("10") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// #569 — floating totals card. The pinned bottom bar becomes a floating card
// that tracks the viewport on scroll, defaults to the full breakdown, and
// collapses to a total-only PILL (breakdown removed from the DOM, not merely
// CSS-hidden). It also auto-collapses to a pill while the side line-item editor
// is open (driven by the `editorOpen` signal) and restores the prior state when
// the editor closes.
// ─────────────────────────────────────────────────────────────────────────────

describe("TotalsCard floating card (#569)", () => {
  it("renders as a floating card pinned to the viewport (fixed), not an inline bar", () => {
    renderBar(makeEstimate({ total: 125 }));

    const card = screen.getByTestId("totals-card");
    expect(card.className).toContain("fixed");
    // It must keep the grand Total in view.
    expect(screen.getByText("$125.00")).toBeTruthy();
  });

  it("defaults to the full breakdown expanded (not the pill)", () => {
    renderBar(makeEstimate({ subtotal: 100, total: 125 }));

    const toggle = screen.getByRole("button", { name: /totals/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Subtotal")).toBeTruthy();
  });

  it("collapses to a total-only pill: breakdown removed from the DOM, Total stays", () => {
    renderBar(makeEstimate({ subtotal: 100, total: 125 }));

    const toggle = screen.getByRole("button", { name: /totals/i });
    fireEvent.click(toggle);

    // Pill: the whole breakdown is gone from the DOM (not merely CSS-hidden).
    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(screen.queryByText("Overhead")).toBeNull();
    expect(screen.queryByText("Tax")).toBeNull();

    // ...but the grand Total — the reason the pill exists — stays in view.
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("$125.00")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("auto-collapses to a pill while the line-item editor is open", () => {
    // Even though the card defaults to expanded, an open editor forces the pill
    // so the floating card never overlaps the side editor panel.
    renderBar(makeEstimate({ subtotal: 100, total: 125 }), { editorOpen: true });

    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("$125.00")).toBeTruthy();
  });

  it("hides the expand toggle while the editor is open (can't re-expand over it)", () => {
    renderBar(makeEstimate({ total: 125 }), { editorOpen: true });

    expect(screen.queryByRole("button", { name: /totals/i })).toBeNull();
  });

  // The editor toggling open/closed must not clobber the user's expand/collapse
  // choice — `editorOpen` only suppresses the breakdown, never rewrites it.
  const card = (entity: BuilderEntity, editorOpen: boolean) => (
    <TotalsCard
      entity={entity}
      onOverheadChange={vi.fn()}
      onProfitChange={vi.fn()}
      onDiscountChange={vi.fn()}
      onTaxRateChange={vi.fn()}
      editorOpen={editorOpen}
    />
  );

  it("restores the expanded breakdown after the editor closes", () => {
    const entity = makeEstimate({ subtotal: 100, total: 125 });
    const { rerender } = render(card(entity, false));

    expect(screen.getByText("Subtotal")).toBeTruthy(); // expanded by default

    rerender(card(entity, true));
    expect(screen.queryByText("Subtotal")).toBeNull(); // pill while editor open

    rerender(card(entity, false));
    expect(screen.getByText("Subtotal")).toBeTruthy(); // restored to expanded
  });

  it("keeps the card a pill after the editor closes if the user had collapsed it", () => {
    const entity = makeEstimate({ subtotal: 100, total: 125 });
    const { rerender } = render(card(entity, false));

    // User collapses to a pill before the editor ever opens.
    fireEvent.click(screen.getByRole("button", { name: /totals/i }));
    expect(screen.queryByText("Subtotal")).toBeNull();

    // Editor opens, then closes.
    rerender(card(entity, true));
    rerender(card(entity, false));

    // Still a pill — the editor must not silently re-expand the card.
    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /totals/i })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("keeps a negative Total visibly flagged even when collapsed to a pill", () => {
    renderBar(
      makeEstimate({
        subtotal: 100,
        discount_type: "amount",
        discount_value: 150,
        discount_amount: 150,
        adjusted_subtotal: -50,
        total: -50,
      }),
      { editorOpen: true },
    );

    // Pill: the breakdown is gone...
    expect(screen.queryByText("Subtotal")).toBeNull();

    // ...but the negative warning and the destructive-styled Total persist.
    expect(screen.getByText("Negative total")).toBeTruthy();
    const total = screen.getByText("-$50.00");
    expect(total.className).toContain("text-destructive");
  });
});

// #929 — §3 typography: every money figure in the totals card is a table
// number, so digits keep their columns as values tick over. `font-mono` alone
// doesn't force equal-width digits in every face; the tabular-nums variant
// does, and the design system requires it on all currency.
describe("TotalsCard money typography (#929)", () => {
  it("renders every money figure with tabular numerals", () => {
    renderBar(
      makeEstimate({
        subtotal: 100,
        overhead_type: "percent",
        overhead_value: 10,
        overhead_amount: 10,
        profit_type: "percent",
        profit_value: 5,
        profit_amount: 5,
        discount_type: "amount",
        discount_value: 20,
        discount_amount: 20,
        adjusted_subtotal: 95,
        tax_rate: 7.5,
        tax_amount: 7.13,
        total: 102.13,
      }),
    );

    const figures = [
      screen.getByText("$100.00"), // Subtotal
      screen.getByText("$10.00"), // Overhead
      screen.getByText("$5.00"), // Profit
      screen.getByText("−$20.00"), // Discount (minus-signed)
      screen.getByText("$95.00"), // Adjusted subtotal
      screen.getByText("$7.13"), // Tax
      screen.getByText("$102.13"), // grand Total
    ];
    for (const el of figures) {
      expect(el.className).toContain("tabular-nums");
    }
  });
});

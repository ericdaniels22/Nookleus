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
import { render, screen, fireEvent } from "@testing-library/react";

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
    onMarkupChange: (t: AdjustmentType, n: number) => void;
    onDiscountChange: (t: AdjustmentType, n: number) => void;
    onTaxRateChange: (n: number) => void;
    readOnly: boolean;
    mode: BuilderEntity["kind"] | "template";
  }> = {},
) {
  return render(
    <TotalsCard
      entity={entity}
      onMarkupChange={handlers.onMarkupChange ?? vi.fn()}
      onDiscountChange={handlers.onDiscountChange ?? vi.fn()}
      onTaxRateChange={handlers.onTaxRateChange ?? vi.fn()}
      readOnly={handlers.readOnly}
      mode={handlers.mode as BuilderMode | undefined}
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

  it("renders the Markup, Discount, Adjusted subtotal, and Tax rows", () => {
    renderBar(makeEstimate());

    expect(screen.getByText("Markup")).toBeTruthy();
    expect(screen.getByText("Discount")).toBeTruthy();
    expect(screen.getByText("Adjusted subtotal")).toBeTruthy();
    expect(screen.getByText("Tax")).toBeTruthy();
  });

  it("reflects a fixed-amount Markup change via onMarkupChange", () => {
    const onMarkupChange = vi.fn();
    renderBar(makeEstimate({ markup_type: "amount", markup_value: 50 }), {
      onMarkupChange,
    });

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("50");

    fireEvent.change(box, { target: { value: "75" } });
    fireEvent.blur(box);

    expect(onMarkupChange).toHaveBeenCalledWith("amount", 75);
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

  it("reflects a percent Markup change via onMarkupChange", () => {
    const onMarkupChange = vi.fn();
    renderBar(makeEstimate({ markup_type: "percent", markup_value: 10 }), {
      onMarkupChange,
    });

    const box = screen.getByDisplayValue("10") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "15" } });

    expect(onMarkupChange).toHaveBeenCalledWith("percent", 15);
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
      makeEstimate({ tax_rate: 8.25, markup_type: "percent", markup_value: 10 }),
      { readOnly: true },
    );

    // Both the Tax % box and the Markup adjustment box are disabled, so a
    // voided document's totals can't be edited from the bar.
    expect((screen.getByDisplayValue("8.25") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByDisplayValue("10") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("is a compact tap-to-expand bar: collapsed by default, toggles on tap", () => {
    renderBar(makeEstimate({ total: 125 }));

    const toggle = screen.getByRole("button", { name: /totals/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // The grand total always stays visible in the compact summary.
    expect(screen.getByText("$125.00")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

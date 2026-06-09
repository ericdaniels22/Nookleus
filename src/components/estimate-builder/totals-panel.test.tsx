// Coverage for the TotalsPanel money fields (#542). The fixed-amount Markup and
// Discount boxes use the $-prefixed MoneyInput; the percent variants and the Tax
// field keep their plain number boxes (Tax stays a `%`, never a `$`).
//
// Query strategy: MoneyInput is a text box (role "textbox"); the plain number
// Input is a number box (role "spinbutton"). The %/$/— toggle renders literal
// "$"/"%" button glyphs, so we never assert on loose getByText for those — we use
// roles and scope `$`/`%` checks to a specific field's wrapper.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TotalsPanel } from "./totals-panel";
import type {
  AdjustmentType,
  BuilderEntity,
  EstimateWithContents,
} from "@/lib/types";

interface Overrides {
  markup_type?: AdjustmentType;
  markup_value?: number;
  discount_type?: AdjustmentType;
  discount_value?: number;
  tax_rate?: number;
}

function makeEntity(o: Overrides = {}): BuilderEntity {
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
    subtotal: 100,
    markup_type: o.markup_type ?? "none",
    markup_value: o.markup_value ?? 0,
    markup_amount: 0,
    discount_type: o.discount_type ?? "none",
    discount_value: o.discount_value ?? 0,
    discount_amount: 0,
    adjusted_subtotal: 100,
    tax_rate: o.tax_rate ?? 0,
    tax_amount: 0,
    total: 100,
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

function renderPanel(
  entity: BuilderEntity,
  handlers: Partial<{
    onMarkupChange: (t: AdjustmentType, n: number) => void;
    onDiscountChange: (t: AdjustmentType, n: number) => void;
    onTaxRateChange: (n: number) => void;
  }> = {},
) {
  return render(
    <TotalsPanel
      entity={entity}
      onMarkupChange={handlers.onMarkupChange ?? vi.fn()}
      onDiscountChange={handlers.onDiscountChange ?? vi.fn()}
      onTaxRateChange={handlers.onTaxRateChange ?? vi.fn()}
    />,
  );
}

describe("TotalsPanel — money fields (#542)", () => {
  it("uses a $ MoneyInput for a fixed-amount markup", () => {
    renderPanel(makeEntity({ markup_type: "amount", markup_value: 50 }));

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("50");
    expect(box.parentElement?.textContent).toContain("$");
  });

  it("commits a fixed-amount markup on blur via onMarkupChange", () => {
    const onMarkupChange = vi.fn();
    renderPanel(makeEntity({ markup_type: "amount", markup_value: 50 }), {
      onMarkupChange,
    });

    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "75" } });
    fireEvent.blur(box);

    expect(onMarkupChange).toHaveBeenCalledWith("amount", 75);
  });

  it("uses a $ MoneyInput for a fixed-amount discount", () => {
    const onDiscountChange = vi.fn();
    renderPanel(makeEntity({ discount_type: "amount", discount_value: 25 }), {
      onDiscountChange,
    });

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("25");
    expect(box.parentElement?.textContent).toContain("$");

    fireEvent.change(box, { target: { value: "30" } });
    fireEvent.blur(box);

    expect(onDiscountChange).toHaveBeenCalledWith("amount", 30);
  });

  it("keeps a plain number box (no MoneyInput) for a percent markup", () => {
    renderPanel(makeEntity({ markup_type: "percent", markup_value: 10 }));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect((screen.getByDisplayValue("10") as HTMLInputElement).type).toBe(
      "number",
    );
  });

  it("keeps the Tax field as a % box, never a $ MoneyInput", () => {
    const onTaxRateChange = vi.fn();
    renderPanel(makeEntity({ tax_rate: 8.25 }), { onTaxRateChange });

    // No money box anywhere when markup/discount are off.
    expect(screen.queryByRole("textbox")).toBeNull();

    const tax = screen.getByDisplayValue("8.25") as HTMLInputElement;
    expect(tax.parentElement?.textContent).toContain("%");
    expect(tax.parentElement?.textContent).not.toContain("$");

    fireEvent.change(tax, { target: { value: "10" } });
    expect(onTaxRateChange).toHaveBeenCalledWith(10);
  });
});

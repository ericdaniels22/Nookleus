import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { FinancialsInvoiceList, type FinancialsInvoice } from "./financials-invoice-list";

function inv(overrides: Partial<FinancialsInvoice> = {}): FinancialsInvoice {
  return {
    id: "inv-1",
    invoice_number: "INV-1001",
    title: "Roof repair",
    total_amount: 100,
    status: "sent",
    ...overrides,
  };
}

// #383 — the Financials tab lists official invoices (sent/partial/paid) and each
// entry clicks through to that invoice's View; drafts stay out. Click-through
// keeps legacy/orphan invoices (no source estimate) reachable.
describe("FinancialsInvoiceList", () => {
  it("lists an official invoice as a link to its View and excludes drafts", () => {
    render(
      <FinancialsInvoiceList
        invoices={[
          inv({ id: "inv-sent", invoice_number: "INV-1001", status: "sent" }),
          inv({ id: "inv-draft", invoice_number: "INV-1002", status: "draft" }),
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /INV-1001/ });
    expect(link.getAttribute("href")).toBe("/invoices/inv-sent");

    // The draft never appears in Financials.
    expect(screen.queryByText("INV-1002")).toBeNull();
  });

  it("renders nothing when no invoice is official", () => {
    const { container } = render(
      <FinancialsInvoiceList
        invoices={[inv({ status: "draft" }), inv({ status: "voided" })]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

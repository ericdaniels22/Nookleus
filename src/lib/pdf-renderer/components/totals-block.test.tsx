// Render-shape coverage for Overhead & Profit on the customer PDF (#576). The
// #572 split gets its own totals rows, gated like markup/discount: the layout
// toggle must be on AND the amount non-zero, so a hidden toggle or a $0 uplift
// never produces an empty line.

import { describe, expect, it } from "vitest";

import { TotalsBlock } from "./totals-block";
import { expandTree, collectText } from "@/components/report-pdf/test-helpers";
import { buildSampleEstimate, buildSampleInvoice } from "@/lib/sample-pdf-data";
import type { DocumentPdfLayout, Estimate } from "@/lib/types";

// Mirrors LAYOUT_FIELD_DEFAULTS: every toggle on except category subtotals and
// the #576 overhead/profit pair, which default hidden.
function makeLayout(overrides: Partial<DocumentPdfLayout> = {}): DocumentPdfLayout {
  return {
    document_title: "Estimate",
    show_document_title: true,
    show_markup: true,
    show_overhead: false,
    show_profit: false,
    show_discount: true,
    show_tax: true,
    show_opening_statement: true,
    show_closing_statement: true,
    show_category_subtotals: false,
    show_code_column: true,
    show_item_notes: true,
    ...overrides,
  };
}

// The synthetic preview estimate is a complete, internally consistent Estimate;
// tests override just the money fields they exercise.
function makeEstimate(overrides: Partial<Estimate> = {}): Estimate {
  return { ...buildSampleEstimate("org-1").document, ...overrides };
}

describe("TotalsBlock — Overhead & Profit rows (#576)", () => {
  it("renders Overhead and Profit as their own lines when toggled on and non-zero", () => {
    const tree = expandTree(
      <TotalsBlock
        document={makeEstimate({ overhead_amount: 180, profit_amount: 95 })}
        layout={makeLayout({ show_overhead: true, show_profit: true })}
      />,
    );
    const text = collectText(tree);
    expect(text).toContain("Overhead");
    expect(text).toContain("$180.00");
    expect(text).toContain("Profit");
    expect(text).toContain("$95.00");
  });

  it("renders neither line under the default layout, even with non-zero amounts", () => {
    const tree = expandTree(
      <TotalsBlock
        document={makeEstimate({ overhead_amount: 180, profit_amount: 95 })}
        layout={makeLayout()} // defaults: both toggles hidden
      />,
    );
    const text = collectText(tree);
    expect(text).not.toContain("Overhead");
    expect(text).not.toContain("Profit");
  });

  it("renders no empty line for a zero-amount uplift, even when toggled on", () => {
    const tree = expandTree(
      <TotalsBlock
        document={makeEstimate({ overhead_amount: 180, profit_amount: 0 })}
        layout={makeLayout({ show_overhead: true, show_profit: true })}
      />,
    );
    const text = collectText(tree);
    expect(text).toContain("Overhead");
    expect(text).not.toContain("Profit");
  });

  // An org showing the split typically hides the combined Markup row. The
  // Adjusted Subtotal line must still appear so the visible math adds up.
  it("shows Adjusted Subtotal when an Overhead/Profit row is the only visible adjustment", () => {
    const tree = expandTree(
      <TotalsBlock
        document={makeEstimate({
          overhead_amount: 180,
          profit_amount: 95,
          discount_amount: 0,
        })}
        layout={makeLayout({
          show_markup: false,
          show_overhead: true,
          show_profit: true,
        })}
      />,
    );
    expect(collectText(tree)).toContain("Adjusted Subtotal");
  });

  // #575 carried the Overhead/Profit split onto invoices so a converted
  // invoice prices exactly as its estimate did — the rows render there under
  // the same toggle + non-zero gates.
  it("renders Overhead and Profit on an invoice when toggled on and non-zero", () => {
    const tree = expandTree(
      <TotalsBlock
        document={{
          ...buildSampleInvoice("org-1").document,
          overhead_amount: 120,
          profit_amount: 60,
        }}
        layout={makeLayout({ show_overhead: true, show_profit: true })}
      />,
    );
    const text = collectText(tree);
    expect(text).toContain("Overhead");
    expect(text).toContain("$120.00");
    expect(text).toContain("Profit");
    expect(text).toContain("$60.00");
  });
});

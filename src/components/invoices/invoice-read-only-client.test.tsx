// Wiring test for the Invoice View (#485): InvoiceReadOnlyClient must mount the
// shared LiveLayoutPanel and hand it the invoice's identity, server-resolved
// layout, edit grant, and frozen/locked flag. This is the one new seam in #485 —
// the panel, the PATCH route, and the precedence resolver are each tested on
// their own; here we only assert the read-only client forwards its props into
// the panel intact (documentType "invoice", the right id, layout, canEdit, locked).
//
// Every heavy child (payment modals, send/export buttons, trashed banner) and the
// panel itself are stubbed: this test is about prop forwarding, not their internals.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DocumentPdfLayout, InvoiceWithContents } from "@/lib/types";

// Stub the panel to a probe that surfaces every prop the client forwards, so the
// wiring contract is observable through the DOM rather than through internals.
vi.mock("@/components/documents/live-layout-panel", () => ({
  LiveLayoutPanel: (props: {
    documentType: string;
    documentId: string;
    previewSrc: string;
    previewTitle: string;
    layout: DocumentPdfLayout;
    canEdit: boolean;
    locked: boolean;
  }) => (
    <div
      data-testid="layout-panel"
      data-document-type={props.documentType}
      data-document-id={props.documentId}
      data-preview-src={props.previewSrc}
      data-preview-title={props.previewTitle}
      data-can-edit={String(props.canEdit)}
      data-locked={String(props.locked)}
      data-layout={JSON.stringify(props.layout)}
    />
  ),
}));

// The rest of the read-only chrome is irrelevant to the wiring under test — stub
// each to nothing so jsdom never has to render a modal or a react-pdf island.
vi.mock("@/components/payments/record-payment-modal", () => ({ default: () => null }));
vi.mock("@/components/payments/payment-request-modal", () => ({
  PaymentRequestModal: () => null,
}));
vi.mock("@/components/documents/export-pdf-button", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/send-modal/button", () => ({ SendButton: () => null }));
vi.mock("@/components/trash/trashed-banner", () => ({ TrashedBanner: () => null }));

import InvoiceReadOnlyClient from "./invoice-read-only-client";

const LAYOUT: DocumentPdfLayout = {
  document_title: "Invoice",
  show_document_title: true,
  show_markup: false,
  show_overhead: false, // #576 — field default; inert on invoices
  show_profit: false,
  show_discount: true,
  show_tax: true,
  show_opening_statement: true,
  show_closing_statement: true,
  show_category_subtotals: false,
  show_code_column: true,
  show_item_notes: true,
};

// A minimal invoice — only the fields the read-only client actually reads. Cast
// through the prop shape; the stubbed children never touch the rest.
type ClientProps = Parameters<typeof InvoiceReadOnlyClient>[0];
function fakeInvoice(over: Partial<InvoiceWithContents> = {}): ClientProps["invoice"] {
  return {
    id: "inv-1",
    invoice_number: "INV-001",
    title: "Kitchen remodel",
    status: "draft",
    job_id: "job-1",
    ...over,
    job: { id: "job-1", job_number: "J-1", property_address: null, contacts: null },
  } as unknown as ClientProps["invoice"];
}

function renderClient(over: Partial<ClientProps> = {}) {
  return render(
    <InvoiceReadOnlyClient
      invoice={fakeInvoice()}
      stripeConnected={false}
      layout={LAYOUT}
      canEdit
      locked={false}
      {...over}
    />,
  );
}

describe("InvoiceReadOnlyClient layout panel wiring (#485)", () => {
  it("mounts the shared panel pointed at the invoice layout route + preview", () => {
    renderClient();
    const panel = screen.getByTestId("layout-panel");
    expect(panel.getAttribute("data-document-type")).toBe("invoice");
    expect(panel.getAttribute("data-document-id")).toBe("inv-1");
    expect(panel.getAttribute("data-preview-src")).toBe("/api/invoices/inv-1/preview");
    expect(panel.getAttribute("data-preview-title")).toBe("Invoice INV-001");
  });

  it("forwards the server-resolved effective layout snapshot verbatim", () => {
    renderClient();
    const panel = screen.getByTestId("layout-panel");
    expect(JSON.parse(panel.getAttribute("data-layout")!)).toEqual(LAYOUT);
  });

  it("forwards canEdit so an editor gets interactive toggles", () => {
    renderClient({ canEdit: true, locked: false });
    const panel = screen.getByTestId("layout-panel");
    expect(panel.getAttribute("data-can-edit")).toBe("true");
    expect(panel.getAttribute("data-locked")).toBe("false");
  });

  it("forwards locked so a frozen (paid/voided) invoice is read-only", () => {
    renderClient({ canEdit: true, locked: true });
    const panel = screen.getByTestId("layout-panel");
    expect(panel.getAttribute("data-locked")).toBe("true");
  });

  it("still mounts the panel for a trashed invoice (read-only, banner above)", () => {
    renderClient({
      isTrashed: true,
      deletedAt: "2026-01-01T00:00:00Z",
      canEdit: true,
      locked: true,
    });
    expect(screen.getByTestId("layout-panel").getAttribute("data-locked")).toBe("true");
  });
});

// #929 — the header actions are real token-styled buttons. `.btn` has no
// definition anywhere in the CSS bundle (dead class), so Edit / Send Payment
// Request / Record Payment rendered as bare text; they carry the shared
// secondary/outline treatment now.
describe("InvoiceReadOnlyClient header actions (#929)", () => {
  it("styles Edit / Send Payment Request / Record Payment as outline buttons, not the dead .btn", () => {
    // status "sent" + Stripe connected + not trashed → all three actions render.
    renderClient({ invoice: fakeInvoice({ status: "sent" }), stripeConnected: true });

    const actions = [
      screen.getByRole("link", { name: "Edit" }),
      screen.getByRole("button", { name: "Send Payment Request" }),
      screen.getByRole("button", { name: "Record Payment" }),
    ];
    for (const el of actions) {
      expect(el.className).toContain("border-input");
      expect(el.className.split(/\s+/)).not.toContain("btn");
    }
  });

  it("sizes the page title per §3 (text-xl, not text-2xl)", () => {
    renderClient();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("text-xl");
    expect(h1.className).not.toContain("text-2xl");
  });
});

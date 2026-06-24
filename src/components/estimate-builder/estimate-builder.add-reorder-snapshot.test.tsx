// Slice 4 of the #681 add-then-reorder fix — end-to-end through the REAL hook.
//
// The granular add flow (estimate/invoice) POSTs a new line item, which bumps
// the parent's updated_at server-side, then fires a reorder PUT to float the row
// to the top. If that PUT still carries the mount-time updated_at it's STALE →
// 409 → the hook latches its stale-conflict guard and the row is stranded at the
// bottom. The fix: the dialog hands the POST's fresh updated_at to onLineItemAdded,
// which adopts it into the hook BEFORE the reorder PUT.
//
// Unlike line-item-editor-panel.integration.test.tsx (which mocks useAutoSave to
// always-true and so never exercises the snapshot), this mounts the real hook and
// asserts the reorder PUT's body — the only place the regression is observable.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

import type {
  BuilderEntity,
  EstimateLineItem,
  EstimateWithContents,
  InvoiceLineItem,
  InvoiceWithContents,
} from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The mocked dialog emits a new line into the target section AND hands the POST's
// fresh updated_at along — mirroring the real dialog's onAdded(item, { updated_at })
// contract once Slice 5 lands. The token is deliberately NEWER than the entity's
// mount-time updated_at so a stale reorder snapshot is distinguishable from a fresh one.
const POST_UPDATED_AT = "2026-02-02T00:00:00Z";

vi.mock("./add-item-dialog", () => ({
  AddItemDialog: ({
    open,
    sectionId,
    onAdded,
  }: {
    open: boolean;
    sectionId: string;
    onAdded: (
      item: EstimateLineItem | InvoiceLineItem,
      meta?: { updated_at?: string | null },
    ) => void;
  }) =>
    open ? (
      <button
        data-testid="mock-add-confirm"
        onClick={() =>
          onAdded(
            {
              id: "NEW",
              organization_id: "org-1",
              estimate_id: "est-1",
              invoice_id: "inv-1",
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
              amount: 0,
              pricing_mode: "standard",
              pieces: null,
              days: null,
              sort_order: 99,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            } as unknown as EstimateLineItem,
            { updated_at: POST_UPDATED_AT },
          )
        }
      >
        add
      </button>
    ) : null,
}));

import { EstimateBuilder } from "./estimate-builder";

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

// Estimate with one empty section "Gutters" (S2) so the added line is the only
// row in its container — the reorder payload is unambiguous.
function makeEstimateEntity(): BuilderEntity {
  const estimate = {
    id: "est-1",
    organization_id: "org-1",
    job_id: "job-1",
    estimate_number: "EST-1",
    sequence_number: 1,
    title: "Snapshot test estimate",
    status: "draft",
    opening_statement: null,
    closing_statement: null,
    subtotal: 0,
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
    adjusted_subtotal: 0,
    tax_rate: 0,
    tax_amount: 0,
    total: 0,
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
        id: "S2",
        organization_id: "org-1",
        estimate_id: "est-1",
        parent_section_id: null,
        title: "Gutters",
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [],
        subsections: [],
      },
    ],
  } as unknown as EstimateWithContents;
  return { kind: "estimate", data: estimate };
}

function makeInvoiceEntity(): BuilderEntity {
  const invoice = {
    id: "inv-1",
    organization_id: "org-1",
    job_id: "job-1",
    invoice_number: "INV-1",
    sequence_number: 1,
    title: "Snapshot test invoice",
    status: "draft",
    issued_date: "2026-01-01",
    due_date: null,
    opening_statement: null,
    closing_statement: null,
    subtotal: 0,
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
    adjusted_subtotal: 0,
    tax_rate: 0,
    tax_amount: 0,
    total_amount: 0,
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
        id: "IS2",
        organization_id: "org-1",
        invoice_id: "inv-1",
        parent_section_id: null,
        title: "Gutters",
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [],
        subsections: [],
      },
    ],
  } as unknown as InvoiceWithContents;
  return { kind: "invoice", data: invoice };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setMatchMedia(true);
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, updated_at: "2026-02-02T01:00:00Z" }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reorderCall(path: string) {
  return fetchMock.mock.calls.find(([url]) => url === path);
}

function addItemToGutters() {
  const guttersHeader = screen.getByText("Gutters").closest("div") as HTMLElement;
  fireEvent.click(within(guttersHeader).getByRole("button", { name: "Add item" }));
  fireEvent.click(screen.getByTestId("mock-add-confirm"));
}

describe("EstimateBuilder add-then-reorder snapshot (#681)", () => {
  it("estimate: the reorder PUT carries the POST's fresh updated_at, not the mount-time token", async () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    addItemToGutters();

    const path = "/api/estimates/est-1/line-items";
    await waitFor(() => expect(reorderCall(path)).toBeDefined());
    const body = JSON.parse(
      (reorderCall(path)![1] as RequestInit).body as string,
    ) as { updated_at_snapshot?: string };
    expect(body.updated_at_snapshot).toBe(POST_UPDATED_AT);
  });

  it("invoice: the reorder PUT carries the POST's fresh updated_at, not the mount-time token", async () => {
    render(<EstimateBuilder entity={makeInvoiceEntity()} />);

    addItemToGutters();

    const path = "/api/invoices/inv-1/line-items";
    await waitFor(() => expect(reorderCall(path)).toBeDefined());
    const body = JSON.parse(
      (reorderCall(path)![1] as RequestInit).body as string,
    ) as { updated_at_snapshot?: string };
    expect(body.updated_at_snapshot).toBe(POST_UPDATED_AT);
  });
});

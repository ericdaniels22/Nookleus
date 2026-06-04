import { describe, it, expect } from "vitest";
import {
  buildBillingRows,
  type BillingEstimateFields,
  type BillingInvoiceFields,
} from "./billing-rows";

// ─────────────────────────────────────────────────────────────────────────────
// Tiny fixtures — the builder only reads these fields, so the full Estimate /
// Invoice row types (which carry ~30 fields each) are structurally assignable.
// ─────────────────────────────────────────────────────────────────────────────

function est(
  o: Partial<BillingEstimateFields> & Pick<BillingEstimateFields, "id">,
): BillingEstimateFields {
  return {
    status: "draft",
    sequence_number: 1,
    converted_to_invoice_id: null,
    ...o,
  };
}

function inv(
  o: Partial<BillingInvoiceFields> & Pick<BillingInvoiceFields, "id">,
): BillingInvoiceFields {
  return {
    status: "draft",
    sequence_number: 1,
    converted_from_estimate_id: null,
    ...o,
  };
}

// #384 — the billing-row builder is a pure transform: given a Job's estimates
// and their linked invoices, produce the ordered Overview rows, each carrying
// its derived state.
describe("buildBillingRows", () => {
  it("renders a plain estimate with no linked invoice as an estimate row", () => {
    const rows = buildBillingRows([est({ id: "est-1", status: "draft" })], []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "estimate",
      statusShown: "draft",
      document: { kind: "estimate", id: "est-1" },
      frozenEstimateId: null,
      tint: "none",
    });
    expect(rows[0].invoice).toBeNull();
  });

  it("flips a converted estimate's row to represent the linked invoice", () => {
    const estimate = est({
      id: "est-1",
      status: "converted",
      converted_to_invoice_id: "inv-1",
    });
    const invoice = inv({
      id: "inv-1",
      status: "sent",
      converted_from_estimate_id: "est-1",
    });

    const rows = buildBillingRows([estimate], [invoice]);

    // One estimate yields at most one invoice — the invoice does not appear as
    // a second row; the estimate's row becomes the invoice.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "invoice",
      statusShown: "sent",
      document: { kind: "invoice", id: "inv-1" },
      frozenEstimateId: "est-1",
    });
    expect(rows[0].invoice).toBe(invoice);
    expect(rows[0].estimate).toBe(estimate);
  });

  it("renders a legacy orphan invoice (no source estimate) as its own invoice row", () => {
    const orphan = inv({
      id: "inv-9",
      status: "paid",
      converted_from_estimate_id: null,
    });

    const rows = buildBillingRows([], [orphan]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "invoice",
      statusShown: "paid",
      document: { kind: "invoice", id: "inv-9" },
      frozenEstimateId: null, // no estimate behind it — nothing to link to
    });
    expect(rows[0].estimate).toBeNull();
    expect(rows[0].invoice).toBe(orphan);
  });

  it("treats an invoice whose source estimate is absent as an orphan", () => {
    const orphan = inv({
      id: "inv-9",
      converted_from_estimate_id: "est-gone", // points at an estimate not in the list
    });

    const rows = buildBillingRows([], [orphan]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "invoice", frozenEstimateId: null });
    expect(rows[0].estimate).toBeNull();
  });

  // The tint and edit-guard surfaced through the flipped row, across the whole
  // invoice lifecycle. Covers "voided invoice is handled": it stays flipped,
  // untinted, locked, with the frozen-estimate link intact.
  it.each([
    ["draft", "yellow", true],
    ["sent", "blue", true],
    ["partial", "none", true],
    ["paid", "none", false],
    ["voided", "none", false],
  ] as const)(
    "a converted invoice in %s → tint %s, canEdit %s, still flipped with frozen link",
    (status, tint, canEdit) => {
      const rows = buildBillingRows(
        [est({ id: "e", status: "converted", converted_to_invoice_id: "i" })],
        [inv({ id: "i", status, converted_from_estimate_id: "e" })],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "invoice",
        statusShown: status,
        tint,
        canEdit,
        frozenEstimateId: "e",
      });
    },
  );

  it("orders estimate-anchored rows by estimate sequence, then orphans by invoice sequence", () => {
    const estimates = [
      est({ id: "e2", sequence_number: 2 }),
      est({
        id: "e1",
        sequence_number: 1,
        status: "converted",
        converted_to_invoice_id: "i-e1",
      }),
    ];
    const invoices = [
      inv({ id: "orphan-b", sequence_number: 20, converted_from_estimate_id: null }),
      // The flipped invoice sorts by its estimate's sequence (1), not its own (99).
      inv({ id: "i-e1", sequence_number: 99, converted_from_estimate_id: "e1" }),
      inv({ id: "orphan-a", sequence_number: 10, converted_from_estimate_id: null }),
    ];

    const rows = buildBillingRows(estimates, invoices);

    // Flipped rows keep the estimate's id; orphans carry the invoice's id.
    expect(rows.map((r) => r.id)).toEqual(["e1", "e2", "orphan-a", "orphan-b"]);
  });
});

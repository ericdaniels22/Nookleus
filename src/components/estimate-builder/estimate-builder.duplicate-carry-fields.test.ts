// Regression for the #679 review: duplicating an INVOICE equipment row dropped it
// back to Standard. The duplicate flow POSTs a standard-only copy (duplicatePostBody
// carries no pricing_mode/pieces/days), so the corrective PUT — computed by
// correctiveDelta(original, serverRow, INVOICE_CARRY_FIELDS) — is the ONLY path that
// can restore pieces × days mode. If INVOICE_CARRY_FIELDS omits those fields, the
// delta can't restore them and the copy silently reverts to Standard.
//
// Estimate duplicate already carries them (ESTIMATE_CARRY_FIELDS); this locks the
// invoice side to the same parity (#684 shipped invoice equipment editing).

import { describe, it, expect } from "vitest";

import {
  correctiveDelta,
  ESTIMATE_CARRY_FIELDS,
  INVOICE_CARRY_FIELDS,
} from "./estimate-builder";
import type { InvoiceLineItem } from "@/lib/types";

// The original (selected) row the user is duplicating — an equipment row in
// pieces × days mode.
const equipmentOriginal = {
  pricing_mode: "pieces_days",
  pieces: 3,
  days: 2,
  quantity: 6,
  unit: "ea",
  unit_price: 25,
  note: "3 units for 2 days",
  code: null,
  description: "Air mover",
} as unknown as InvoiceLineItem;

// The freshly-created copy as the standard-only duplicate POST returns it: the
// server defaulted pricing_mode to 'standard' and left pieces/days NULL.
const standardServerRow = {
  pricing_mode: "standard",
  pieces: null,
  days: null,
  quantity: 6,
  unit: "ea",
  unit_price: 25,
  note: "3 units for 2 days",
  code: null,
  description: "Air mover",
} as unknown as InvoiceLineItem;

describe("invoice duplicate carries equipment pricing (#679 review fix)", () => {
  it("the corrective delta restores pricing_mode/pieces/days for an invoice equipment row", () => {
    const delta = correctiveDelta(
      equipmentOriginal,
      standardServerRow,
      INVOICE_CARRY_FIELDS,
    );

    expect(delta).toMatchObject({
      pricing_mode: "pieces_days",
      pieces: 3,
      days: 2,
    });
  });

  it("invoice and estimate carry the same field set, so duplicate behaves identically across modes", () => {
    // Sorted compare — order is irrelevant; what matters is parity of membership.
    expect([...INVOICE_CARRY_FIELDS].sort()).toEqual(
      [...ESTIMATE_CARRY_FIELDS].sort(),
    );
  });
});

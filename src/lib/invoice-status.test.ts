import { describe, it, expect } from "vitest";
import {
  isOfficialInvoiceStatus,
  OFFICIAL_INVOICE_STATUSES,
  type InvoiceStatus,
} from "./invoice-status";

// #383 — a single rule decides which invoice statuses are "official" (a real
// bill): sent / partial / paid count; draft / voided do not. This is the
// isolation test that every status maps to the correct official verdict.
describe("isOfficialInvoiceStatus", () => {
  const cases: Array<[InvoiceStatus, boolean]> = [
    ["sent", true],
    ["partial", true],
    ["paid", true],
    ["draft", false],
    ["voided", false],
  ];

  it.each(cases)("classifies %s as official=%s", (status, expected) => {
    expect(isOfficialInvoiceStatus(status)).toBe(expected);
  });
});

describe("OFFICIAL_INVOICE_STATUSES", () => {
  it("is exactly the official statuses", () => {
    expect([...OFFICIAL_INVOICE_STATUSES]).toEqual(["sent", "partial", "paid"]);
  });
});

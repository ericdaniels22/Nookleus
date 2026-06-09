import { describe, it, expect } from "vitest";
import { computeWaterfall } from "./waterfall";

// #566 — the pricing waterfall (subtotal → +markup → −discount → adjusted
// subtotal → +tax → total) is a single pure function shared by the server
// recalc paths and the builder's live totals. These tests pin the money
// contracts: discount comes off the RAW subtotal, tax is
// adjusted_subtotal × taxRatePercent / 100 (whole-number percent, matching
// the tax_rate numeric(6,4) column), and every leg rounds to cents on its own.

describe("computeWaterfall", () => {
  it.each([
    ["percent", 10, 100], // 10% of $1,000
    ["amount", 250, 250], // flat $250
    ["none", 10, 0], // value is ignored when type is none
  ] as const)(
    "markup %s %s on a $1,000 subtotal adds $%s",
    (type, value, expected) => {
      const result = computeWaterfall({
        lineItemCharges: [600, 400],
        markup: { type, value },
        discount: { type: "none", value: 0 },
        taxRatePercent: 0,
      });

      expect(result.subtotal).toBe(1000);
      expect(result.markup_amount).toBe(expected);
      expect(result.adjusted_subtotal).toBe(1000 + expected);
      expect(result.total).toBe(1000 + expected);
    },
  );

  it.each([
    ["percent", 10, 100], // 10% of the RAW $1,000 subtotal — NOT of $1,200
    ["amount", 75, 75],
    ["none", 10, 0],
  ] as const)(
    "discount %s %s comes off the raw subtotal, after a 20%% markup",
    (type, value, expected) => {
      const result = computeWaterfall({
        lineItemCharges: [1000],
        markup: { type: "percent", value: 20 },
        discount: { type, value },
        taxRatePercent: 0,
      });

      expect(result.discount_amount).toBe(expected);
      expect(result.adjusted_subtotal).toBe(1200 - expected);
      expect(result.total).toBe(1200 - expected);
    },
  );

  it("taxes the adjusted subtotal at taxRatePercent/100 — 8.25 means 8.25%, not a fraction", () => {
    const result = computeWaterfall({
      lineItemCharges: [1000],
      markup: { type: "amount", value: 200 },
      discount: { type: "amount", value: 100 },
      taxRatePercent: 8.25,
    });

    // adjusted = 1000 + 200 − 100 = 1100; tax = 1100 × 8.25 / 100
    expect(result.adjusted_subtotal).toBe(1100);
    expect(result.tax_amount).toBe(90.75);
    expect(result.total).toBe(1190.75);
  });

  it("rounds each leg to cents independently, not just the total", () => {
    const result = computeWaterfall({
      lineItemCharges: [33.33, 33.33, 33.33],
      markup: { type: "percent", value: 7.5 }, // 7.49925 → 7.50
      discount: { type: "percent", value: 5 }, // 4.9995 → 5.00
      taxRatePercent: 8.25, // 102.49 × 8.25% = 8.4554… → 8.46
    });

    expect(result).toEqual({
      subtotal: 99.99,
      markup_amount: 7.5,
      discount_amount: 5,
      adjusted_subtotal: 102.49,
      tax_amount: 8.46,
      total: 110.95,
    });
  });

  it("rounds a floating-point line-charge sum to cents", () => {
    const result = computeWaterfall({
      lineItemCharges: [0.1, 0.2], // 0.30000000000000004 in IEEE 754
      markup: { type: "none", value: 0 },
      discount: { type: "none", value: 0 },
      taxRatePercent: 0,
    });

    expect(result.subtotal).toBe(0.3);
    expect(result.total).toBe(0.3);
  });

  it("accepts a precomputed subtotal (the builder's live path) and matches the line-charges path exactly", () => {
    const legs = {
      markup: { type: "percent", value: 12.5 },
      discount: { type: "amount", value: 19.99 },
      taxRatePercent: 8.25,
    } as const;

    const fromCharges = computeWaterfall({ lineItemCharges: [149.5, 320.75, 89.99], ...legs });
    const fromSubtotal = computeWaterfall({ subtotal: 560.24, ...legs });

    expect(fromSubtotal).toEqual(fromCharges);
  });

  it("returns all-zero legs for an empty estimate", () => {
    const result = computeWaterfall({
      lineItemCharges: [],
      markup: { type: "none", value: 0 },
      discount: { type: "none", value: 0 },
      taxRatePercent: 0,
    });

    expect(result).toEqual({
      subtotal: 0,
      markup_amount: 0,
      discount_amount: 0,
      adjusted_subtotal: 0,
      tax_amount: 0,
      total: 0,
    });
  });
});

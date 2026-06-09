import { describe, it, expect } from "vitest";
import { computeWaterfall, type Adjustment, type WaterfallInput } from "./waterfall";

// #566 / #572 — the pricing waterfall (subtotal → +overhead → +profit →
// −discount → adjusted subtotal → +tax → total) is a single pure function
// shared by the server recalc paths and the builder's live totals. These tests
// pin the money contracts: the Markup is split into two independent uplifts —
// Overhead and Profit ("10 & 10") — each off the RAW subtotal; markup_amount is
// their sum (so every existing reader keeps working); discount comes off the
// RAW subtotal too; tax is adjusted_subtotal × taxRatePercent / 100 (whole-
// number percent, matching the tax_rate columns — numeric(5,2) on estimates,
// numeric(6,4) on invoices); and every leg rounds to cents on its own.
//
// NB: keep `$` and `%%` out of the it.each title templates — vitest treats
// `$1` as positional-arg injection, so a literal like "$1,000" renders as
// garbage in test output.

const NONE: Adjustment = { type: "none", value: 0 };

describe("computeWaterfall", () => {
  it.each([
    ["percent", 10, 100], // 10% of $1,000
    ["amount", 250, 250], // flat $250
    ["none", 10, 0], // value is ignored when type is none
  ] as const)(
    "overhead %s %s on a 1000 subtotal adds %s",
    (type, value, expected) => {
      const result = computeWaterfall({
        lineItemCharges: [600, 400],
        overhead: { type, value },
        profit: NONE,
        discount: NONE,
        taxRatePercent: 0,
      });

      expect(result.subtotal).toBe(1000);
      expect(result.overhead_amount).toBe(expected);
      expect(result.profit_amount).toBe(0);
      expect(result.markup_amount).toBe(expected);
      expect(result.adjusted_subtotal).toBe(1000 + expected);
      expect(result.total).toBe(1000 + expected);
    },
  );

  it.each([
    ["percent", 10, 100], // 10% of $1,000
    ["amount", 250, 250], // flat $250
    ["none", 10, 0], // value is ignored when type is none
  ] as const)(
    "profit %s %s on a 1000 subtotal adds %s",
    (type, value, expected) => {
      const result = computeWaterfall({
        lineItemCharges: [600, 400],
        overhead: NONE,
        profit: { type, value },
        discount: NONE,
        taxRatePercent: 0,
      });

      expect(result.subtotal).toBe(1000);
      expect(result.profit_amount).toBe(expected);
      expect(result.overhead_amount).toBe(0);
      expect(result.markup_amount).toBe(expected);
      expect(result.adjusted_subtotal).toBe(1000 + expected);
      expect(result.total).toBe(1000 + expected);
    },
  );

  it("stacks overhead and profit — each off the RAW subtotal — into markup_amount", () => {
    const result = computeWaterfall({
      lineItemCharges: [1000],
      overhead: { type: "percent", value: 10 }, // 100
      profit: { type: "amount", value: 50 }, // flat 50
      discount: NONE,
      taxRatePercent: 0,
    });

    expect(result.overhead_amount).toBe(100);
    expect(result.profit_amount).toBe(50);
    expect(result.markup_amount).toBe(150); // overhead_amount + profit_amount
    expect(result.adjusted_subtotal).toBe(1150);
    expect(result.total).toBe(1150);
  });

  it("rounds each leg to cents BEFORE summing — markup_amount can land a cent off a single combined markup (intended)", () => {
    // 10% of 12.35 = 1.235 → 1.24 per leg; summed = 2.48. A single 20% markup
    // would be round2(2.47) = 2.47. The per-leg-then-sum penny is the documented
    // behavior of splitting the Markup into two independently-rounded legs.
    const result = computeWaterfall({
      lineItemCharges: [12.35],
      overhead: { type: "percent", value: 10 },
      profit: { type: "percent", value: 10 },
      discount: NONE,
      taxRatePercent: 0,
    });

    expect(result.overhead_amount).toBe(1.24);
    expect(result.profit_amount).toBe(1.24);
    expect(result.markup_amount).toBe(2.48); // NOT 2.47 (round2(12.35 * 0.20))
    expect(result.adjusted_subtotal).toBe(14.83);
    expect(result.total).toBe(14.83);
  });

  it.each([
    ["percent", 10, 100], // 10% of the RAW $1,000 subtotal — NOT of the marked-up total
    ["amount", 75, 75],
    ["none", 10, 0],
  ] as const)(
    "discount %s %s takes %s off the raw 1000 subtotal, not the 1200 marked-up one",
    (type, value, expected) => {
      const result = computeWaterfall({
        lineItemCharges: [1000],
        overhead: { type: "percent", value: 20 },
        profit: NONE,
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
      overhead: { type: "amount", value: 200 },
      profit: NONE,
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
      overhead: { type: "percent", value: 7.5 }, // 7.49925 → 7.50
      profit: NONE,
      discount: { type: "percent", value: 5 }, // 4.9995 → 5.00
      taxRatePercent: 8.25, // 102.49 × 8.25% = 8.4554… → 8.46
    });

    expect(result).toEqual({
      subtotal: 99.99,
      overhead_amount: 7.5,
      profit_amount: 0,
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
      overhead: NONE,
      profit: NONE,
      discount: NONE,
      taxRatePercent: 0,
    });

    expect(result.subtotal).toBe(0.3);
    expect(result.total).toBe(0.3);
  });

  it("rounds a precomputed subtotal to cents before computing the legs", () => {
    // Pins the { subtotal } branch's round2 — a mutation-test survivor in the
    // original suite (the parity test below feeds a clean 2-decimal literal,
    // which can't tell rounded from unrounded).
    const result = computeWaterfall({
      subtotal: 0.1 + 0.2, // 0.30000000000000004 in IEEE 754
      overhead: NONE,
      profit: NONE,
      discount: NONE,
      taxRatePercent: 0,
    });

    expect(result.subtotal).toBe(0.3);
    expect(result.total).toBe(0.3);
  });

  it("coerces string line charges — Supabase numeric columns can arrive as strings", () => {
    const result = computeWaterfall({
      lineItemCharges: ["600", "400"] as unknown as number[],
      overhead: NONE,
      profit: NONE,
      discount: NONE,
      taxRatePercent: 0,
    });

    expect(result.subtotal).toBe(1000); // not string concatenation
  });

  it("rejects an input carrying both line charges and a precomputed subtotal", () => {
    const overhead: Adjustment = { type: "none", value: 0 };
    const profit: Adjustment = { type: "none", value: 0 };
    const discount: Adjustment = { type: "none", value: 0 };
    // @ts-expect-error — WaterfallInput forbids supplying both forms at once;
    // if the `?: never` exclusion is ever dropped, this directive turns into
    // an "unused @ts-expect-error" tsc failure.
    const both: WaterfallInput = {
      lineItemCharges: [100, 200],
      subtotal: 999999,
      overhead,
      profit,
      discount,
      taxRatePercent: 0,
    };

    // And if the types are bypassed with a cast anyway, subtotal wins:
    expect(computeWaterfall(both).subtotal).toBe(999999);
  });

  it("accepts a precomputed subtotal (the builder's live path) and matches the line-charges path exactly", () => {
    const legs = {
      overhead: { type: "percent", value: 12.5 },
      profit: { type: "amount", value: 19.99 },
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
      overhead: NONE,
      profit: NONE,
      discount: NONE,
      taxRatePercent: 0,
    });

    expect(result).toEqual({
      subtotal: 0,
      overhead_amount: 0,
      profit_amount: 0,
      markup_amount: 0,
      discount_amount: 0,
      adjusted_subtotal: 0,
      tax_amount: 0,
      total: 0,
    });
  });
});

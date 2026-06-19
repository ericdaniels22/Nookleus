import { describe, it, expect } from "vitest";

import { financialsViewModel } from "./financials-view-model";

// #716 — the pure view-model deriver: figures in → cash-flow waterfall rows
// (Collected − Expenses − Crew labor = Profit) plus the Profit sign/colour and
// caption. Every branch is asserted here, with no React in sight.
describe("financialsViewModel — cash-flow waterfall", () => {
  it("derives a Collected → Profit column whose subtotal reconciles", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1000,
      expenses: 0,
      crew_labor: 0,
      margin_pct: 100,
      in_progress: false,
    });

    const collected = vm.waterfall.find((r) => r.label === "Collected");
    const profit = vm.waterfall.find((r) => r.isSubtotal);

    expect(collected?.amount).toBe(1000);
    expect(profit?.label).toBe("Profit");
    expect(profit?.amount).toBe(1000);
  });

  it("shows Expenses as a clearly negative line that the subtotal reconciles", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1000,
      expenses: 300,
      crew_labor: 0,
      margin_pct: 70,
      in_progress: false,
    });

    const expenses = vm.waterfall.find((r) => r.label === "Expenses");
    const profit = vm.waterfall.find((r) => r.isSubtotal);

    expect(expenses?.amount).toBe(-300);
    expect(profit?.amount).toBe(700); // 1000 − 300
  });

  it("shows a negative Crew labor line marked '(est.)' when crew labor is non-zero", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1000,
      expenses: 300,
      crew_labor: 200,
      margin_pct: 50,
      in_progress: false,
    });

    const crew = vm.waterfall.find((r) => r.label === "Crew labor");
    const profit = vm.waterfall.find((r) => r.isSubtotal);

    expect(crew?.amount).toBe(-200);
    expect(crew?.note).toBe("(est.)");
    expect(profit?.amount).toBe(500); // 1000 − 300 − 200
  });

  it("omits the Crew labor line when crew labor is $0, still reconciling", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1000,
      expenses: 300,
      crew_labor: 0,
      margin_pct: 70,
      in_progress: false,
    });

    expect(vm.waterfall.find((r) => r.label === "Crew labor")).toBeUndefined();

    const profit = vm.waterfall.find((r) => r.isSubtotal);
    expect(profit?.amount).toBe(700); // Collected − Expenses = Profit
  });

  it("colours the Profit figure red when the reconciled subtotal is negative", () => {
    const vm = financialsViewModel({
      invoiced: 500,
      collected: 500,
      expenses: 900,
      crew_labor: 400,
      margin_pct: -160,
      in_progress: false,
    });

    // sign is taken from the reconciled subtotal (500 − 900 − 400 = −800)
    expect(vm.waterfall.find((r) => r.isSubtotal)?.amount).toBe(-800);
    expect(vm.profit.label).toBe("Profit");
    expect(vm.profit.palette.text).toBe("#F09595"); // red
  });

  it("colours the Profit figure green when the reconciled subtotal is non-negative", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1000,
      expenses: 300,
      crew_labor: 0,
      margin_pct: 70,
      in_progress: false,
    });

    expect(vm.profit.palette.text).toBe("#5DCAA5"); // green
  });

  it("captions an in-progress Job '(in progress)', not its percent", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1000,
      expenses: 300,
      crew_labor: 0,
      margin_pct: 70,
      in_progress: true,
    });

    expect(vm.profit.caption).toBe("(in progress)");
  });

  it("captions a completed Job with its profit percent", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1000,
      expenses: 300,
      crew_labor: 0,
      margin_pct: 70,
      in_progress: false,
    });

    expect(vm.profit.caption).toBe("70.0% profit");
  });
});

// #717 — the deriver also produces the phone collection ring's state: a
// discriminated union (collection-rate / not-invoiced-yet / clamped) carrying
// the ring geometry, so the component renders without any branch logic of its
// own. Invoiced is billing context here, separate from the waterfall math.
describe("financialsViewModel — collection ring", () => {
  it("derives a collection-rate ring with Outstanding when Invoiced > 0", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 600,
      expenses: 0,
      crew_labor: 0,
      margin_pct: 60,
      in_progress: false,
    });

    const ring = vm.collectionRing;
    expect(ring.kind).toBe("collection-rate");
    if (ring.kind === "collection-rate") {
      expect(ring.rate).toBeCloseTo(0.6, 6); // 600 / 1000
      expect(ring.outstanding).toBe(400); // Invoiced − Collected
      expect(ring.geometry.percent).toBe(60);
    }
  });

  it("reports not-invoiced-yet (no ring) when Invoiced is $0 but money has come in", () => {
    const vm = financialsViewModel({
      invoiced: 0,
      collected: 500, // a deposit before any billing — the owner's early-job state
      expenses: 0,
      crew_labor: 0,
      margin_pct: null,
      in_progress: true,
    });

    const ring = vm.collectionRing;
    expect(ring.kind).toBe("not-invoiced-yet");
    if (ring.kind === "not-invoiced-yet") {
      expect(ring.collected).toBe(500);
    }
  });

  it("clamps an over-collected Job (Collected > Invoiced) to a full ring", () => {
    const vm = financialsViewModel({
      invoiced: 1000,
      collected: 1200, // paid ahead — the dedicated annotation comes in #718
      expenses: 0,
      crew_labor: 0,
      margin_pct: 120,
      in_progress: false,
    });

    const ring = vm.collectionRing;
    expect(ring.kind).toBe("clamped");
    if (ring.kind === "clamped") {
      // a full ring, not a 120%-overflowing one
      expect(ring.geometry.percent).toBe(100);
      expect(ring.geometry.fraction).toBe(1);
    }
  });

  it("renders a brand-new Job with no activity as a zero not-invoiced-yet state, not a broken ring", () => {
    const vm = financialsViewModel({
      invoiced: 0,
      collected: 0,
      expenses: 0,
      crew_labor: 0,
      margin_pct: null,
      in_progress: true,
    });

    const ring = vm.collectionRing;
    // an intentional empty state — no division, no ring geometry to mis-paint
    expect(ring.kind).toBe("not-invoiced-yet");
    if (ring.kind === "not-invoiced-yet") {
      expect(ring.collected).toBe(0);
    }
  });
});

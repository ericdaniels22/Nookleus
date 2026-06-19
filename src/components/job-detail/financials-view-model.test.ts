import { describe, it, expect } from "vitest";

import { financialsViewModel } from "./financials-view-model";

// #716 — the pure view-model deriver: figures in → cash-flow waterfall rows
// (Collected − Expenses − Crew labor = Profit) plus the Profit sign/colour and
// caption. Every branch is asserted here, with no React in sight.
describe("financialsViewModel — cash-flow waterfall", () => {
  it("derives a Collected → Profit column whose subtotal reconciles", () => {
    const vm = financialsViewModel({
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
      collected: 1000,
      expenses: 300,
      crew_labor: 0,
      margin_pct: 70,
      in_progress: false,
    });

    expect(vm.profit.caption).toBe("70.0% profit");
  });
});

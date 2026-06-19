import { describe, it, expect } from "vitest";

import { profitFigure } from "./profit-figure";

// #715 — the Job Financials headline figure is "Profit" (a Job's running cash
// position, Collected − Expenses − Crew labor), coloured by sign: green ≥ 0,
// red < 0. This pure deriver owns that figure→display logic so every state is
// unit-testable without rendering React.
describe("profitFigure", () => {
  it("labels the figure 'Profit' and tints it green when profit is positive", () => {
    const figure = profitFigure({ gross_margin: 1200, margin_pct: 34, in_progress: false });

    expect(figure.label).toBe("Profit");
    expect(figure.palette.text).toBe("#5DCAA5");
  });

  it("tints a negative profit red (fixing the prior always-green bug)", () => {
    const figure = profitFigure({ gross_margin: -800, margin_pct: -20, in_progress: false });

    expect(figure.palette.text).toBe("#F09595");
  });

  it("treats exactly-zero profit as the non-negative (green) boundary", () => {
    const figure = profitFigure({ gross_margin: 0, margin_pct: 0, in_progress: false });

    expect(figure.palette.text).toBe("#5DCAA5");
  });

  it("carries a green card tint (background + border) for a positive profit", () => {
    const { palette } = profitFigure({ gross_margin: 500, margin_pct: 10, in_progress: false });

    expect(palette.background).toBe("rgba(29, 158, 117, 0.12)");
    expect(palette.border).toBe("rgba(29, 158, 117, 0.35)");
  });

  it("carries a red card tint (background + border) for a negative profit", () => {
    const { palette } = profitFigure({ gross_margin: -500, margin_pct: -10, in_progress: false });

    expect(palette.background).toBe("rgba(240, 149, 149, 0.12)");
    expect(palette.border).toBe("rgba(240, 149, 149, 0.35)");
  });

  it("captions a completed Job's percent in profit terms, not margin", () => {
    const figure = profitFigure({ gross_margin: 3400, margin_pct: 34, in_progress: false });

    expect(figure.caption).toBe("34.0% profit");
  });

  it("captions an in-progress Job '(in progress)', not a percent", () => {
    const figure = profitFigure({ gross_margin: 3400, margin_pct: 34, in_progress: true });

    expect(figure.caption).toBe("(in progress)");
  });

  it("omits the caption on a completed Job with no percent (nothing collected)", () => {
    const figure = profitFigure({ gross_margin: -200, margin_pct: null, in_progress: false });

    expect(figure.caption).toBeUndefined();
  });

  it("gives the caption a sign-matched colour so it never contradicts the figure", () => {
    const profit = profitFigure({ gross_margin: 3400, margin_pct: 34, in_progress: false });
    const loss = profitFigure({ gross_margin: -3400, margin_pct: -34, in_progress: false });

    expect(profit.palette.caption).toBe("#9FE1CB");
    expect(loss.palette.caption).toBe("#F09595");
  });
});

import { profitFigure, type ProfitFigure } from "./profit-figure";

export type WaterfallRow = {
  label: string;
  /** signed contribution: Collected positive, deductions negative, Profit = subtotal */
  amount: number;
  isSubtotal: boolean;
  /** e.g. "(est.)" on the Crew labor line */
  note?: string;
};

export type FinancialsViewModel = {
  profit: ProfitFigure;
  waterfall: WaterfallRow[];
};

export function financialsViewModel(summary: {
  collected: number;
  expenses: number;
  crew_labor: number;
  margin_pct: number | null;
  in_progress: boolean;
}): FinancialsViewModel {
  // Derive the subtotal FROM the addends so the column always reconciles —
  // Collected − Expenses − Crew labor = Profit — rather than trusting a
  // separately-passed figure.
  const profit = summary.collected - summary.expenses - summary.crew_labor;

  const waterfall: WaterfallRow[] = [
    { label: "Collected", amount: summary.collected, isSubtotal: false },
    { label: "Expenses", amount: -summary.expenses, isSubtotal: false },
  ];

  // Crew labor is an estimate, so it only earns a line once the owner has
  // entered one — a $0 line would just clutter the ledger.
  if (summary.crew_labor !== 0) {
    waterfall.push({
      label: "Crew labor",
      amount: -summary.crew_labor,
      isSubtotal: false,
      note: "(est.)",
    });
  }

  waterfall.push({ label: "Profit", amount: profit, isSubtotal: true });

  // The figure's sign/colour and caption come from the reconciled subtotal, so
  // the headline can never disagree with the math in the column above it.
  return {
    profit: profitFigure({
      gross_margin: profit,
      margin_pct: summary.margin_pct,
      in_progress: summary.in_progress,
    }),
    waterfall,
  };
}

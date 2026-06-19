import { profitFigure, type ProfitFigure } from "./profit-figure";
import { ringGeometry, type RingGeometry } from "./ring-geometry";

export type WaterfallRow = {
  label: string;
  /** signed contribution: Collected positive, deductions negative, Profit = subtotal */
  amount: number;
  isSubtotal: boolean;
  /** e.g. "(est.)" on the Crew labor line */
  note?: string;
};

// The phone collection ring's state. Invoiced is billing context — how much of
// what's been billed has come in — and is deliberately separate from the
// waterfall's profit math.
export type CollectionRing =
  | {
      /** Invoiced > 0: the ring fills to Collected ÷ Invoiced. */
      kind: "collection-rate";
      rate: number;
      collected: number;
      invoiced: number;
      /** Invoiced − Collected, the amount still owed */
      outstanding: number;
      geometry: RingGeometry;
    }
  | {
      /** Invoiced is $0 — deposits before billing; no ring, just the collected total. */
      kind: "not-invoiced-yet";
      collected: number;
    }
  | {
      /** Collected > Invoiced: the ring caps at a full 100% and reads "paid ahead". */
      kind: "paid-ahead";
      collected: number;
      invoiced: number;
      /** Collected − Invoiced, the amount paid ahead of what's been billed */
      overCollected: number;
      geometry: RingGeometry;
    };

export type FinancialsViewModel = {
  profit: ProfitFigure;
  waterfall: WaterfallRow[];
  collectionRing: CollectionRing;
};

function collectionRing(invoiced: number, collected: number): CollectionRing {
  // Nothing billed yet — deposits routinely precede billing, so draw no ring
  // and just report what's come in.
  if (invoiced <= 0) {
    return { kind: "not-invoiced-yet", collected };
  }

  const rate = collected / invoiced;
  const geometry = ringGeometry(rate);

  // Paid ahead: the ring caps at a full 100% (ringGeometry clamps the fraction)
  // and we surface the over-amount so the component can frame it as good news.
  // Outstanding would be negative here, so it is deliberately omitted.
  if (collected > invoiced) {
    return { kind: "paid-ahead", collected, invoiced, overCollected: collected - invoiced, geometry };
  }

  return {
    kind: "collection-rate",
    rate,
    collected,
    invoiced,
    outstanding: invoiced - collected,
    geometry,
  };
}

export function financialsViewModel(summary: {
  invoiced: number;
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
    collectionRing: collectionRing(summary.invoiced, summary.collected),
  };
}

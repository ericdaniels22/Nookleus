// src/components/accounting/margin-pill.tsx
// Color-coded margin-percentage pill. Green ≥30, amber ≥10, red <10, em-dash when null.
import { marginPctBand, type MarginBand } from "@/lib/accounting/margin-bands";

// §2.6 dark-tint bands: a ~14%-alpha wash behind colored text, as palette
// classes (never an inline hex). Positive = emerald (product accent family),
// warning = amber (matches urgencyColors.urgent), danger = red (matches
// urgencyColors.emergency treatment in badge-colors.ts).
const BAND_TINT: Record<Exclude<MarginBand, "none">, string> = {
  green: "bg-emerald-400/14 text-emerald-300",
  amber: "bg-amber-400/14 text-amber-300",
  red: "bg-red-500/14 text-red-300",
};

export function MarginPctPill({ pct }: { pct: number | null }) {
  const band = marginPctBand(pct);
  if (band === "none") return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium tabular-nums ${BAND_TINT[band]}`}>
      {pct!.toFixed(1)}%
    </span>
  );
}

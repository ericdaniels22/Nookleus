import type { WaterfallRow } from "./financials-view-model";
import type { ProfitFigure } from "./profit-figure";
import { fmtCurrency } from "./format-currency";

// Presentational only — the rows, sign colour, and caption are all decided by
// the view-model deriver; this just lays them out as a right-aligned ledger.
export default function CashFlowWaterfall({
  rows,
  profit,
}: {
  rows: WaterfallRow[];
  profit: ProfitFigure;
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <dl className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className={
              row.isSubtotal
                ? "flex items-baseline justify-between border-t border-white/10 pt-2"
                : "flex items-baseline justify-between"
            }
          >
            <dt className="text-sm text-neutral-300">
              {row.label}
              {row.note && <span className="ml-1 text-xs text-neutral-500">{row.note}</span>}
            </dt>
            <dd
              className={
                row.isSubtotal
                  ? "text-right tabular-nums text-lg font-semibold"
                  : "text-right tabular-nums"
              }
              style={row.isSubtotal ? { color: profit.palette.text } : undefined}
            >
              {fmtCurrency(row.amount)}
            </dd>
          </div>
        ))}
      </dl>
      {profit.caption && (
        <div className="mt-1 text-right text-xs" style={{ color: profit.palette.caption }}>
          {profit.caption}
        </div>
      )}
    </div>
  );
}

// Pure presentational table for an estimate section's line items (read view).
// Extracted from page.tsx so the note sub-line (#382) can be unit-tested without
// mounting the async server page.

import { formatCurrency } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";

export function ItemsTable({ items }: { items: EstimateLineItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium w-1/2">Description</th>
            <th className="py-1.5 pr-3 font-medium">Code</th>
            <th className="py-1.5 pr-3 font-medium text-right">Qty</th>
            <th className="py-1.5 pr-3 font-medium">Unit</th>
            <th className="py-1.5 pr-3 font-medium text-right">Unit Price</th>
            <th className="py-1.5 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-3 text-foreground">
                {item.description}
                {item.note && (
                  <span className="block text-xs italic text-muted-foreground">
                    {item.note}
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                {item.code ?? "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {item.quantity}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {item.unit ?? "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatCurrency(item.unit_price)}
              </td>
              <td className="py-2 text-right tabular-nums font-medium">
                {formatCurrency(item.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

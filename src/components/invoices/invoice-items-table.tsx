// Pure presentational table for one invoice section's line items (read view).
// Extracted from invoice-read-only-client.tsx so the note sub-line (#382) can be
// unit-tested without mounting the full read-only client and its action buttons.

import type { InvoiceWithContents } from "@/lib/types";

type Section = InvoiceWithContents["sections"][number];

export function InvoiceItemsTable({ section }: { section: Section }) {
  return (
    <table className="w-full mt-2 text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th>Description</th>
          <th>Qty</th>
          <th>Unit</th>
          <th>Unit Price</th>
          <th className="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {section.items.map((it) => (
          <tr key={it.id}>
            <td>
              {it.description}
              {it.note && (
                <span className="block text-xs italic text-muted-foreground">{it.note}</span>
              )}
            </td>
            <td>{it.quantity}</td>
            <td>{it.unit ?? ""}</td>
            <td>${it.unit_price.toFixed(2)}</td>
            <td className="text-right">${it.amount.toFixed(2)}</td>
          </tr>
        ))}
        {section.subsections.map((sub) => (
          <tr key={sub.id}>
            <td colSpan={5}>
              <strong>{sub.title}</strong>
            </td>
          </tr>
        ))}
        {section.subsections.flatMap((sub) =>
          sub.items.map((it) => (
            <tr key={it.id}>
              <td className="pl-4">
                {it.description}
                {it.note && (
                  <span className="block text-xs italic text-muted-foreground">{it.note}</span>
                )}
              </td>
              <td>{it.quantity}</td>
              <td>{it.unit ?? ""}</td>
              <td>${it.unit_price.toFixed(2)}</td>
              <td className="text-right">${it.amount.toFixed(2)}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

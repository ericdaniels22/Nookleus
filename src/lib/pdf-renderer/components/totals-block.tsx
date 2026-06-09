// src/lib/pdf-renderer/components/totals-block.tsx
// Right-aligned totals. Toggle-gated rows; non-zero gate on markup/discount.

import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { DocumentPdfLayout, Estimate, Invoice } from "@/lib/types";

interface Props {
  document: Estimate | Invoice;
  layout: DocumentPdfLayout;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function TotalsBlock({ document: doc, layout }: Props) {
  const subtotal = Number(doc.subtotal);
  const markupAmt = Number(doc.markup_amount);
  // #576 — the #572/#575 Overhead + Profit split; both document types carry it.
  const overheadAmt = Number(doc.overhead_amount);
  const profitAmt = Number(doc.profit_amount);
  const discountAmt = Number(doc.discount_amount);
  const adjusted = Number(doc.adjusted_subtotal);
  const taxRate = Number(doc.tax_rate);
  const taxAmt = Number(doc.tax_amount);
  // total: estimates store as `total`; invoices as `total_amount`
  const total = Number(("total" in doc ? doc.total : (doc as Invoice).total_amount));

  // Each adjustment row needs its toggle on AND a non-zero amount; the Adjusted
  // Subtotal line anchors the math whenever any of them is visible.
  const markupRow = layout.show_markup && markupAmt !== 0;
  const overheadRow = layout.show_overhead && overheadAmt !== 0;
  const profitRow = layout.show_profit && profitAmt !== 0;
  const discountRow = layout.show_discount && discountAmt !== 0;

  return (
    <View style={styles.totalsBlock}>
      <View style={styles.totalsRow}>
        <Text>Subtotal</Text>
        <Text>{fmt(subtotal)}</Text>
      </View>
      {markupRow && (
        <View style={styles.totalsRow}>
          <Text>Markup</Text>
          <Text>{fmt(markupAmt)}</Text>
        </View>
      )}
      {overheadRow && (
        <View style={styles.totalsRow}>
          <Text>Overhead</Text>
          <Text>{fmt(overheadAmt)}</Text>
        </View>
      )}
      {profitRow && (
        <View style={styles.totalsRow}>
          <Text>Profit</Text>
          <Text>{fmt(profitAmt)}</Text>
        </View>
      )}
      {discountRow && (
        <View style={styles.totalsRow}>
          <Text>Discount</Text>
          <Text>−{fmt(Math.abs(discountAmt))}</Text>
        </View>
      )}
      {markupRow || overheadRow || profitRow || discountRow ? (
        <View style={styles.totalsRow}>
          <Text>Adjusted Subtotal</Text>
          <Text>{fmt(adjusted)}</Text>
        </View>
      ) : null}
      {layout.show_tax && (
        <View style={styles.totalsRow}>
          <Text>Tax ({taxRate.toFixed(2)}%)</Text>
          <Text>{fmt(taxAmt)}</Text>
        </View>
      )}
      <View style={styles.totalsRowBold}>
        <Text>Total</Text>
        <Text>{fmt(total)}</Text>
      </View>
    </View>
  );
}

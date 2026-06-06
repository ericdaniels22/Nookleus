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
  const discountAmt = Number(doc.discount_amount);
  const adjusted = Number(doc.adjusted_subtotal);
  const taxRate = Number(doc.tax_rate);
  const taxAmt = Number(doc.tax_amount);
  // total: estimates store as `total`; invoices as `total_amount`
  const total = Number(("total" in doc ? doc.total : (doc as Invoice).total_amount));

  return (
    <View style={styles.totalsBlock}>
      <View style={styles.totalsRow}>
        <Text>Subtotal</Text>
        <Text>{fmt(subtotal)}</Text>
      </View>
      {layout.show_markup && markupAmt !== 0 && (
        <View style={styles.totalsRow}>
          <Text>Markup</Text>
          <Text>{fmt(markupAmt)}</Text>
        </View>
      )}
      {layout.show_discount && discountAmt !== 0 && (
        <View style={styles.totalsRow}>
          <Text>Discount</Text>
          <Text>−{fmt(Math.abs(discountAmt))}</Text>
        </View>
      )}
      {(layout.show_markup && markupAmt !== 0) || (layout.show_discount && discountAmt !== 0) ? (
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

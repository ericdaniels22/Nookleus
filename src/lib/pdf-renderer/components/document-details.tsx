import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { Estimate, Invoice } from "@/lib/types";

type Doc = Estimate | Invoice;

interface Props { document: Doc; kind: "estimate" | "invoice"; }

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  // Normalize an ISO YYYY-MM-DD or full timestamp into a short date.
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function DocumentDetails({ document: doc, kind }: Props) {
  const number = kind === "estimate"
    ? (doc as Estimate).estimate_number
    : (doc as Invoice).invoice_number;
  const issued = doc.issued_date;
  const dateLabel = kind === "estimate" ? "Valid Until" : "Due Date";
  const dateValue = kind === "estimate"
    ? (doc as Estimate).valid_until
    : (doc as Invoice).due_date;
  return (
    <View style={styles.detailsRow}>
      <View style={styles.detailItem}>
        <Text style={styles.detailLabel}>{kind === "estimate" ? "Estimate #" : "Invoice #"}</Text>
        <Text style={styles.detailValue}>{number}</Text>
      </View>
      <View style={styles.detailItem}>
        <Text style={styles.detailLabel}>Issued</Text>
        <Text style={styles.detailValue}>{formatDate(issued)}</Text>
      </View>
      {dateValue ? (
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{dateLabel}</Text>
          <Text style={styles.detailValue}>{formatDate(dateValue)}</Text>
        </View>
      ) : null}
      <View style={styles.detailItem}>
        <Text style={styles.detailLabel}>Status</Text>
        <Text style={styles.detailValue}>{doc.status}</Text>
      </View>
    </View>
  );
}

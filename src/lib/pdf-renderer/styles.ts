// src/lib/pdf-renderer/styles.ts — shared @react-pdf StyleSheet for estimate + invoice PDFs.

import { StyleSheet } from "@react-pdf/renderer";

export const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  // Header
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  docTitle: { fontSize: 22, fontWeight: "bold" },
  logo: { width: 80, height: 40, objectFit: "contain" },
  // Two-column rows
  twoCol: { flexDirection: "row", gap: 24, marginBottom: 16 },
  col: { flex: 1 },
  // Common typography
  h: { fontWeight: "bold", fontSize: 11, marginBottom: 4 },
  muted: { color: "#666", fontSize: 9 },
  // Document details row
  detailsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderTop: "1 solid #e5e5e5",
    borderBottom: "1 solid #e5e5e5",
  },
  detailItem: { flexDirection: "column", marginRight: 16 },
  detailLabel: { color: "#666", fontSize: 8, textTransform: "uppercase" },
  detailValue: { fontSize: 10 },
  // Sections table
  table: { marginTop: 8 },
  sectionHeader: {
    fontWeight: "bold",
    fontSize: 11,
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#f3f4f6",
  },
  subsectionHeader: {
    fontWeight: "bold",
    fontSize: 9,
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 12,
    color: "#444",
  },
  thRow: {
    flexDirection: "row",
    paddingVertical: 6,
    backgroundColor: "#f9fafb",
    borderBottom: "1 solid #e5e7eb",
  },
  tr: { flexDirection: "row", borderBottom: "1 solid #f3f4f6", paddingVertical: 6 },
  tdCode: { width: 60, paddingHorizontal: 6 },
  tdDesc: { flex: 3, paddingHorizontal: 6 },
  tdName: { fontWeight: "bold", marginBottom: 1 },
  tdQty: { width: 50, paddingHorizontal: 6, textAlign: "right" },
  tdUnit: { width: 50, paddingHorizontal: 6, textAlign: "left" },
  tdPrice: { width: 70, paddingHorizontal: 6, textAlign: "right" },
  tdTotal: { width: 80, paddingHorizontal: 6, textAlign: "right" },
  tdNotes: { flex: 1, paddingHorizontal: 6, fontSize: 8, color: "#6b7280" },
  sectionSubtotal: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 4,
    paddingRight: 6,
    fontSize: 9,
    fontStyle: "italic",
  },
  // Totals
  totalsBlock: { marginTop: 16, alignItems: "flex-end" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingVertical: 3,
  },
  totalsRowBold: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 240,
    paddingTop: 6,
    paddingBottom: 3,
    borderTop: "1 solid #1a1a1a",
    fontWeight: "bold",
    fontSize: 12,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#9ca3af",
  },
  // Statement (HTML rendered)
  statementBlock: { marginTop: 12, marginBottom: 12 },
});

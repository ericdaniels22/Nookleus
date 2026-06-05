"use client";

import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { format } from "date-fns";

import { parseDateOnly } from "@/lib/date-field";

const colors = {
  text: "#1A1A1A",
  muted: "#666666",
  border: "#E5E7EB",
};

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  left: {
    flexDirection: "row",
    flexShrink: 1,
  },
  customer: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
  },
  label: {
    fontSize: 9,
    color: colors.muted,
  },
  date: {
    fontSize: 9,
    color: colors.muted,
  },
});

interface PageHeaderProps {
  customerName: string;
  reportDate: string;
}

function formatReportDate(reportDate: string): string {
  // report_date is a Postgres `date` (YYYY-MM-DD); parse it as a local calendar
  // date so it does not shift across timezones (issue #444).
  const d = parseDateOnly(reportDate);
  if (Number.isNaN(d.getTime())) return reportDate;
  return format(d, "MMM d, yyyy");
}

export default function PageHeader({
  customerName,
  reportDate,
}: PageHeaderProps) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.left}>
        {customerName ? (
          <Text style={styles.customer}>{customerName} </Text>
        ) : null}
        <Text style={styles.label}>— Photo Report</Text>
      </View>
      <Text style={styles.date}>{formatReportDate(reportDate)}</Text>
    </View>
  );
}

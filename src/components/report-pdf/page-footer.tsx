"use client";

import { StyleSheet, Text, View } from "@react-pdf/renderer";

const colors = {
  muted: "#666666",
  light: "#999999",
  border: "#E5E7EB",
};

const styles = StyleSheet.create({
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  side: {
    flex: 1,
    fontSize: 8,
    color: colors.light,
  },
  right: {
    flex: 1,
    fontSize: 8,
    color: colors.light,
    textAlign: "right",
  },
  pageCounter: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.muted,
    textAlign: "center",
    flex: 1,
  },
});

interface PageFooterProps {
  sectionTitle: string;
  customerName: string;
  pageNumber?: number;
  totalPages?: number;
}

export default function PageFooter({
  sectionTitle,
  customerName,
  pageNumber,
  totalPages,
}: PageFooterProps) {
  const hasStaticCounter =
    pageNumber !== undefined && totalPages !== undefined;

  return (
    <View style={styles.footer} fixed>
      <Text style={styles.side}>{sectionTitle}</Text>
      {hasStaticCounter ? (
        <Text style={styles.pageCounter}>
          {pageNumber} / {totalPages}
        </Text>
      ) : (
        <Text
          style={styles.pageCounter}
          render={({ pageNumber: pn, totalPages: tp }) => `${pn} / ${tp}`}
        />
      )}
      <Text style={styles.right}>{customerName}</Text>
    </View>
  );
}

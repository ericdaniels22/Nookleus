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
  section: {
    flex: 1,
    fontSize: 8,
    color: colors.light,
  },
  pageCounter: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.muted,
    textAlign: "right",
  },
});

interface PageFooterProps {
  sectionTitle: string;
  pageNumber?: number;
  totalPages?: number;
}

export default function PageFooter({
  sectionTitle,
  pageNumber,
  totalPages,
}: PageFooterProps) {
  const hasStaticCounter =
    pageNumber !== undefined && totalPages !== undefined;

  return (
    <View style={styles.footer} fixed>
      <Text style={styles.section}>{sectionTitle}</Text>
      {hasStaticCounter ? (
        <Text style={styles.pageCounter}>
          Page {pageNumber} of {totalPages}
        </Text>
      ) : (
        <Text
          style={styles.pageCounter}
          render={({ pageNumber: pn, totalPages: tp }) =>
            `Page ${pn} of ${tp}`
          }
        />
      )}
    </View>
  );
}

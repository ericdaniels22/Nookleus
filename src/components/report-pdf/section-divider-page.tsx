"use client";

import { Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import PageFooter from "./page-footer";
import PageHeader from "./page-header";

const colors = {
  text: "#1A1A1A",
  muted: "#666666",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: colors.text,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  title: {
    fontSize: 36,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    textAlign: "center",
  },
  description: {
    marginTop: 24,
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 1.4,
  },
});

interface SectionDividerPageProps {
  title: string;
  description: string | null;
  customerName: string;
  reportDate: string;
  pageNumber?: number;
  totalPages?: number;
}

export default function SectionDividerPage({
  title,
  description,
  customerName,
  reportDate,
  pageNumber,
  totalPages,
}: SectionDividerPageProps) {
  const hasDescription = description != null && description.length > 0;

  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader customerName={customerName} reportDate={reportDate} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {hasDescription ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
      <PageFooter
        sectionTitle={title}
        customerName={customerName}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </Page>
  );
}

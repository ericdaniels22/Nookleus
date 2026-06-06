"use client";

import { Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import PageFooter from "./page-footer";
import PageHeader from "./page-header";
import { htmlToPdfNodes } from "@/lib/pdf-renderer/html-to-pdf";
import { normalizeSectionWriteup } from "@/lib/section-writeup";

const colors = {
  text: "#1A1A1A",
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
    // Horizontal margins come from the Page's paddingHorizontal; the write-up
    // then spans the same content width as the photo pages.
    flex: 1,
    alignItems: "center",
  },
  // An empty write-up keeps the clean centered-title divider look.
  bodyCentered: {
    justifyContent: "center",
  },
  // With a write-up the page becomes a top-down intro: heading, then narrative.
  bodyWithWriteup: {
    justifyContent: "flex-start",
    paddingTop: 72,
  },
  title: {
    fontSize: 36,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    textAlign: "center",
  },
  // The rich-text write-up reads as the page's body copy: full width, left
  // aligned, a touch larger than the photo-page captions. htmlToPdfNodes emits
  // the paragraphs / bullet rows; this View only sets the inherited typography.
  writeup: {
    marginTop: 28,
    width: "100%",
    fontSize: 12,
    lineHeight: 1.5,
    color: colors.text,
    textAlign: "left",
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
  // The write-up is rich-text HTML stored in `description` (issue #403). Read
  // it through the slice-1 normalizer so legacy one-line subtitles and missing
  // values are tolerated, then map the subset to PDF primitives. An empty
  // write-up yields no nodes, so the intro page is heading-only — no blank block.
  const writeupNodes = htmlToPdfNodes(normalizeSectionWriteup(description));
  const hasWriteup = writeupNodes.length > 0;

  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader customerName={customerName} reportDate={reportDate} />
      <View
        style={[styles.body, hasWriteup ? styles.bodyWithWriteup : styles.bodyCentered]}
      >
        <Text style={styles.title}>{title}</Text>
        {hasWriteup ? <View style={styles.writeup}>{writeupNodes}</View> : null}
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

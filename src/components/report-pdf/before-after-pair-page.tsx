"use client";

import { Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { RenderSlot } from "@/lib/report-render-model";
import PageFooter from "./page-footer";
import { PHOTO_CORNER_RADIUS, PhotoFrame, PhotoMeta } from "./photo-page";

const colors = {
  text: "#1A1A1A",
  muted: "#666666",
  border: "#E5E7EB",
  bg: "#F4F4F4",
};

const PHOTO_HEIGHT = 320;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: colors.text,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  column: {
    flex: 1,
    marginHorizontal: 4,
  },
  label: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: colors.text,
    textAlign: "center",
    marginBottom: 6,
  },
  photoFrame: {
    width: "100%",
    height: PHOTO_HEIGHT,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: PHOTO_CORNER_RADIUS,
    position: "relative",
    overflow: "hidden",
  },
  meta: {
    paddingTop: 10,
    paddingHorizontal: 2,
  },
  caption: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    marginBottom: 6,
  },
  metaLine: {
    fontSize: 9,
    color: colors.muted,
    marginBottom: 3,
  },
});

function PairColumn({ slot, label }: { slot: RenderSlot; label: string }) {
  return (
    <View style={styles.column}>
      <Text style={styles.label}>{label}</Text>
      <PhotoFrame slot={slot} frameStyle={styles.photoFrame} />
      <View style={styles.meta}>
        <PhotoMeta
          slot={slot}
          captionStyle={styles.caption}
          lineStyle={styles.metaLine}
        />
      </View>
    </View>
  );
}

interface BeforeAfterPairPageProps {
  before: RenderSlot;
  after: RenderSlot;
  sectionTitle: string;
  pageNumber?: number;
  totalPages?: number;
}

export default function BeforeAfterPairPage({
  before,
  after,
  sectionTitle,
  pageNumber,
  totalPages,
}: BeforeAfterPairPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.row}>
        <PairColumn slot={before} label="Before" />
        <PairColumn slot={after} label="After" />
      </View>
      <PageFooter
        sectionTitle={sectionTitle}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </Page>
  );
}

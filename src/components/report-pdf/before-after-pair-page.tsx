"use client";

import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { format } from "date-fns";

import PageFooter from "./page-footer";
import PageHeader from "./page-header";
import { PHOTO_CORNER_RADIUS, type PhotoPageSlot } from "./photo-page";

const colors = {
  primary: "#1B2434",
  text: "#1A1A1A",
  muted: "#666666",
  light: "#999999",
  border: "#E5E7EB",
  bg: "#F4F4F4",
  white: "#FFFFFF",
};

const PHOTO_HEIGHT = 320;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 56,
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
  photoImage: {
    width: "100%",
    height: "100%",
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: colors.primary,
    color: colors.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 10,
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

function formatTakenAt(takenAt: string | null): string | null {
  if (!takenAt) return null;
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMM d, yyyy, h:mm a");
}

function PairColumn({ slot, label }: { slot: PhotoPageSlot; label: string }) {
  const objectFit = slot.orientation === "landscape" ? "contain" : "cover";
  const dateLine = formatTakenAt(slot.takenAt);

  return (
    <View style={styles.column}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.photoFrame}>
        <Image src={slot.url} style={[styles.photoImage, { objectFit }]} />
        <Text style={styles.badge}>{slot.number}</Text>
      </View>
      <View style={styles.meta}>
        {slot.caption ? (
          <Text style={styles.caption}>{slot.caption}</Text>
        ) : null}
        {dateLine ? <Text style={styles.metaLine}>{dateLine}</Text> : null}
        {slot.takenBy ? (
          <Text style={styles.metaLine}>{slot.takenBy}</Text>
        ) : null}
      </View>
    </View>
  );
}

interface BeforeAfterPairPageProps {
  before: PhotoPageSlot;
  after: PhotoPageSlot;
  sectionTitle: string;
  customerName: string;
  reportDate: string;
  pageNumber?: number;
  totalPages?: number;
}

export default function BeforeAfterPairPage({
  before,
  after,
  sectionTitle,
  customerName,
  reportDate,
  pageNumber,
  totalPages,
}: BeforeAfterPairPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader customerName={customerName} reportDate={reportDate} />
      <View style={styles.row}>
        <PairColumn slot={before} label="Before" />
        <PairColumn slot={after} label="After" />
      </View>
      <PageFooter
        sectionTitle={sectionTitle}
        customerName={customerName}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </Page>
  );
}

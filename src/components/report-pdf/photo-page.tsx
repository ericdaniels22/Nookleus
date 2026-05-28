"use client";

import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { format } from "date-fns";

import PageFooter from "./page-footer";
import PageHeader from "./page-header";

const colors = {
  primary: "#1B2434",
  text: "#1A1A1A",
  muted: "#666666",
  light: "#999999",
  border: "#E5E7EB",
  bg: "#F4F4F4",
  white: "#FFFFFF",
};

// Slot geometry: each of the two photo rows takes roughly half of the
// printable area between header and footer. The photo itself is a
// portrait-shaped frame (~3:4) with the metadata column to the right.
const PHOTO_HEIGHT = 295;
const PHOTO_WIDTH = 220;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: colors.text,
  },
  slot: {
    flexDirection: "row",
    marginBottom: 16,
    alignItems: "stretch",
  },
  photoFrame: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
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
    flex: 1,
    paddingLeft: 14,
    paddingVertical: 4,
    justifyContent: "flex-start",
  },
  caption: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    marginBottom: 8,
  },
  metaLine: {
    fontSize: 9,
    color: colors.muted,
    marginBottom: 3,
  },
  metaLabel: {
    color: colors.light,
  },
});

export interface PhotoPageSlot {
  photoId: string;
  url: string;
  number: number;
  caption: string | null;
  takenAt: string | null;
  takenBy: string | null;
  orientation: "portrait" | "landscape";
}

interface PhotoPageProps {
  slots: PhotoPageSlot[];
  sectionTitle: string;
  customerName: string;
  reportDate: string;
  pageNumber?: number;
  totalPages?: number;
}

function formatTakenAt(takenAt: string | null): string | null {
  if (!takenAt) return null;
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMM d, yyyy, h:mm a");
}

function PhotoSlotView({ slot }: { slot: PhotoPageSlot }) {
  const objectFit = slot.orientation === "landscape" ? "contain" : "cover";
  const dateLine = formatTakenAt(slot.takenAt);

  return (
    <View style={styles.slot}>
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

export default function PhotoPage({
  slots,
  sectionTitle,
  customerName,
  reportDate,
  pageNumber,
  totalPages,
}: PhotoPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader customerName={customerName} reportDate={reportDate} />
      {slots.map((slot) => (
        <PhotoSlotView key={slot.photoId} slot={slot} />
      ))}
      <PageFooter
        sectionTitle={sectionTitle}
        customerName={customerName}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </Page>
  );
}

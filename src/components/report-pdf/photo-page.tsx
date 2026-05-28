"use client";

import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
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

// 2-per-page slot geometry: each of the two photo rows takes roughly half
// of the printable area between header and footer. The photo itself is a
// portrait-shaped frame (~3:4) with the metadata column to the right.
const TWO_PHOTO_HEIGHT = 295;
const TWO_PHOTO_WIDTH = 220;

// 1-per-page slot geometry: one large portrait-shaped photo dominating the
// page, metadata beneath.
const ONE_PHOTO_HEIGHT = 540;
const ONE_PHOTO_WIDTH = 405;

// 4-per-page tile geometry: 2x2 grid; each tile ~half the usable width.
const FOUR_TILE_WIDTH = 240;
const FOUR_PHOTO_HEIGHT = 245;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: colors.text,
  },

  // 2-per-page layout — photo + side metadata.
  twoSlot: {
    flexDirection: "row",
    marginBottom: 16,
    alignItems: "stretch",
  },
  twoPhotoFrame: {
    width: TWO_PHOTO_WIDTH,
    height: TWO_PHOTO_HEIGHT,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    position: "relative",
    overflow: "hidden",
  },
  twoMeta: {
    flex: 1,
    paddingLeft: 14,
    paddingVertical: 4,
    justifyContent: "flex-start",
  },

  // 1-per-page layout — large photo + metadata stacked beneath.
  oneTile: {
    alignItems: "center",
    marginBottom: 16,
  },
  onePhotoFrame: {
    width: ONE_PHOTO_WIDTH,
    height: ONE_PHOTO_HEIGHT,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    position: "relative",
    overflow: "hidden",
  },
  oneMeta: {
    width: ONE_PHOTO_WIDTH,
    paddingTop: 10,
  },

  // 4-per-page layout — 2x2 grid; each tile has photo + metadata beneath.
  fourGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  fourTile: {
    width: FOUR_TILE_WIDTH,
    marginBottom: 14,
  },
  fourPhotoFrame: {
    width: FOUR_TILE_WIDTH,
    height: FOUR_PHOTO_HEIGHT,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    position: "relative",
    overflow: "hidden",
  },
  fourMeta: {
    paddingTop: 6,
  },

  // Shared.
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
  caption: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    marginBottom: 8,
  },
  captionSmall: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    marginBottom: 4,
  },
  metaLine: {
    fontSize: 9,
    color: colors.muted,
    marginBottom: 3,
  },
  metaLineSmall: {
    fontSize: 8,
    color: colors.muted,
    marginBottom: 2,
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
  photosPerPage?: 1 | 2 | 4;
}

function formatTakenAt(takenAt: string | null): string | null {
  if (!takenAt) return null;
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMM d, yyyy, h:mm a");
}

function objectFitFor(orientation: PhotoPageSlot["orientation"]) {
  return orientation === "landscape" ? "contain" : "cover";
}

function renderMetaLines(
  slot: PhotoPageSlot,
  captionStyle: Style,
  lineStyle: Style,
) {
  const dateLine = formatTakenAt(slot.takenAt);
  return [
    slot.caption ? (
      <Text key="caption" style={captionStyle}>
        {slot.caption}
      </Text>
    ) : null,
    dateLine ? (
      <Text key="date" style={lineStyle}>
        {dateLine}
      </Text>
    ) : null,
    slot.takenBy ? (
      <Text key="creator" style={lineStyle}>
        {slot.takenBy}
      </Text>
    ) : null,
  ];
}

function TwoPerPageSlot({ slot }: { slot: PhotoPageSlot }) {
  return (
    <View style={styles.twoSlot}>
      <View style={styles.twoPhotoFrame}>
        <Image
          src={slot.url}
          style={[styles.photoImage, { objectFit: objectFitFor(slot.orientation) }]}
        />
        <Text style={styles.badge}>{slot.number}</Text>
      </View>
      <View style={styles.twoMeta}>
        {renderMetaLines(slot, styles.caption, styles.metaLine)}
      </View>
    </View>
  );
}

function OnePerPageTile({ slot }: { slot: PhotoPageSlot }) {
  return (
    <View style={styles.oneTile}>
      <View style={styles.onePhotoFrame}>
        <Image
          src={slot.url}
          style={[styles.photoImage, { objectFit: objectFitFor(slot.orientation) }]}
        />
        <Text style={styles.badge}>{slot.number}</Text>
      </View>
      <View style={styles.oneMeta}>
        {renderMetaLines(slot, styles.caption, styles.metaLine)}
      </View>
    </View>
  );
}

function FourPerPageTile({ slot }: { slot: PhotoPageSlot }) {
  return (
    <View style={styles.fourTile}>
      <View style={styles.fourPhotoFrame}>
        <Image
          src={slot.url}
          style={[styles.photoImage, { objectFit: objectFitFor(slot.orientation) }]}
        />
        <Text style={styles.badge}>{slot.number}</Text>
      </View>
      <View style={styles.fourMeta}>
        {renderMetaLines(slot, styles.captionSmall, styles.metaLineSmall)}
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
  photosPerPage = 2,
}: PhotoPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader customerName={customerName} reportDate={reportDate} />
      {photosPerPage === 1 ? (
        slots.map((slot) => <OnePerPageTile key={slot.photoId} slot={slot} />)
      ) : photosPerPage === 4 ? (
        <View style={styles.fourGrid}>
          {slots.map((slot) => (
            <FourPerPageTile key={slot.photoId} slot={slot} />
          ))}
        </View>
      ) : (
        slots.map((slot) => <TwoPerPageSlot key={slot.photoId} slot={slot} />)
      )}
      <PageFooter
        sectionTitle={sectionTitle}
        customerName={customerName}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </Page>
  );
}

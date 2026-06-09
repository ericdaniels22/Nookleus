"use client";

import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { format } from "date-fns";

import type { RenderSlot } from "@/lib/report-render-model";
import PageFooter from "./page-footer";
import TagChips from "./tag-chips";

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
// of the printable area. The photo is a portrait-shaped frame (~3:4) with
// the metadata column to the right.
const TWO_PHOTO_HEIGHT = 295;
const TWO_PHOTO_WIDTH = 220;

// 3-per-page slot geometry: same side-by-side shape as 2-per, but shorter so
// three rows fit between the (now header-less) top margin and the footer.
const THREE_PHOTO_HEIGHT = 195;
const THREE_PHOTO_WIDTH = 146;

// 4-per-page tile geometry: 2x2 grid; each tile ~half the usable width with
// metadata stacked beneath.
const FOUR_TILE_WIDTH = 240;
const FOUR_PHOTO_HEIGHT = 245;

// Corner radius shared by every photo frame (2/3/4-per-page) so the rounding
// stays consistent and is tuned in one place. Also imported by the cover and
// before/after pages.
export const PHOTO_CORNER_RADIUS = 12;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: colors.text,
  },

  // Side-by-side layout shared by 2- and 3-per-page — photo + side metadata.
  sideSlot: {
    flexDirection: "row",
    marginBottom: 16,
    alignItems: "stretch",
  },
  sideMeta: {
    flex: 1,
    paddingLeft: 14,
    paddingVertical: 4,
    justifyContent: "flex-start",
  },
  twoPhotoFrame: {
    width: TWO_PHOTO_WIDTH,
    height: TWO_PHOTO_HEIGHT,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: PHOTO_CORNER_RADIUS,
    position: "relative",
    overflow: "hidden",
  },
  threePhotoFrame: {
    width: THREE_PHOTO_WIDTH,
    height: THREE_PHOTO_HEIGHT,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: PHOTO_CORNER_RADIUS,
    position: "relative",
    overflow: "hidden",
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
    borderRadius: PHOTO_CORNER_RADIUS,
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
  tagsWrap: {
    marginTop: 4,
  },
});

interface PhotoPageProps {
  slots: RenderSlot[];
  sectionTitle: string;
  pageNumber?: number;
  totalPages?: number;
  photosPerPage?: 2 | 3 | 4;
}

function formatTakenAt(dateCaptured: string | null): string | null {
  if (!dateCaptured) return null;
  const d = new Date(dateCaptured);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMM d, yyyy, h:mm a");
}

function objectFitFor(orientation: RenderSlot["orientation"]) {
  return orientation === "landscape" ? "contain" : "cover";
}

/** The clipping frame holding one photo, with its number badge when present. */
export function PhotoFrame({
  slot,
  frameStyle,
}: {
  slot: RenderSlot;
  frameStyle: Style;
}) {
  return (
    <View style={frameStyle}>
      {slot.url ? (
        <Image
          src={slot.url}
          style={[
            styles.photoImage,
            { objectFit: objectFitFor(slot.orientation) },
          ]}
        />
      ) : null}
      {slot.number != null ? (
        <Text style={styles.badge}>{slot.number}</Text>
      ) : null}
    </View>
  );
}

/**
 * The per-photo detail block: each field is already gated to null upstream, so
 * we render exactly what is present — caption (bold), date captured, captured
 * by, location, then the tag chips.
 */
export function PhotoMeta({
  slot,
  captionStyle,
  lineStyle,
}: {
  slot: RenderSlot;
  captionStyle: Style;
  lineStyle: Style;
}) {
  const dateLine = formatTakenAt(slot.dateCaptured);
  return (
    <>
      {slot.caption ? <Text style={captionStyle}>{slot.caption}</Text> : null}
      {dateLine ? <Text style={lineStyle}>{dateLine}</Text> : null}
      {slot.capturedBy ? (
        <Text style={lineStyle}>{slot.capturedBy}</Text>
      ) : null}
      {slot.location ? <Text style={lineStyle}>{slot.location}</Text> : null}
      {slot.tags.length > 0 ? (
        <View style={styles.tagsWrap}>
          <TagChips tags={slot.tags} />
        </View>
      ) : null}
    </>
  );
}

function SideBySideSlot({
  slot,
  frameStyle,
}: {
  slot: RenderSlot;
  frameStyle: Style;
}) {
  return (
    <View style={styles.sideSlot}>
      <PhotoFrame slot={slot} frameStyle={frameStyle} />
      <View style={styles.sideMeta}>
        <PhotoMeta slot={slot} captionStyle={styles.caption} lineStyle={styles.metaLine} />
      </View>
    </View>
  );
}

function FourPerPageTile({ slot }: { slot: RenderSlot }) {
  return (
    <View style={styles.fourTile}>
      <PhotoFrame slot={slot} frameStyle={styles.fourPhotoFrame} />
      <View style={styles.fourMeta}>
        <PhotoMeta
          slot={slot}
          captionStyle={styles.captionSmall}
          lineStyle={styles.metaLineSmall}
        />
      </View>
    </View>
  );
}

export default function PhotoPage({
  slots,
  sectionTitle,
  pageNumber,
  totalPages,
  photosPerPage = 2,
}: PhotoPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      {photosPerPage === 4 ? (
        <View style={styles.fourGrid}>
          {slots.map((slot) => (
            <FourPerPageTile key={slot.photoId} slot={slot} />
          ))}
        </View>
      ) : (
        slots.map((slot) => (
          <SideBySideSlot
            key={slot.photoId}
            slot={slot}
            frameStyle={
              photosPerPage === 3 ? styles.threePhotoFrame : styles.twoPhotoFrame
            }
          />
        ))
      )}
      <PageFooter
        sectionTitle={sectionTitle}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </Page>
  );
}

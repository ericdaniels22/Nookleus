"use client";

import { Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { RenderCover } from "@/lib/report-render-model";
import { formatPreparedBy } from "@/lib/report-prepared-by";
import { PHOTO_CORNER_RADIUS } from "./photo-page";

const colors = {
  primary: "#1B2434",
  accent: "#C41E2A",
  text: "#1A1A1A",
  muted: "#666666",
  light: "#999999",
  border: "#E5E7EB",
  bg: "#F9FAFB",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 48,
    color: colors.text,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  logoImage: {
    height: 48,
    maxWidth: 200,
    objectFit: "contain",
  },
  logoText: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  title: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    marginBottom: 6,
  },
  preparedBy: {
    fontSize: 10,
    color: colors.muted,
    marginBottom: 18,
  },
  coverPhoto: {
    width: "100%",
    height: 340,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: PHOTO_CORNER_RADIUS,
    objectFit: "cover",
  },
  coverPhotoPlaceholder: {
    width: "100%",
    height: 340,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: PHOTO_CORNER_RADIUS,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: 10,
    color: colors.light,
  },
  twoColumn: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 18,
  },
  column: {
    flex: 1,
  },
  blockLabel: {
    fontSize: 8,
    color: colors.light,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  blockValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    marginBottom: 2,
  },
  blockLine: {
    fontSize: 11,
    color: colors.text,
    marginBottom: 2,
  },
  insuranceBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  insuranceLine: {
    fontSize: 11,
    color: colors.text,
    marginBottom: 2,
  },
});

interface CoverPageProps {
  /**
   * The resolved Cover Page model: hidden blocks are already nulled out and the
   * cover photo / title are resolved upstream (report → Job fallback). This
   * component renders exactly what survives, never raw Job data.
   */
  cover: RenderCover;
  /** Signed URL for an image logo; ignored for a text logo. */
  logoUrl: string | null;
  /** The report's creator name; renders the "Prepared by {name}" line (#400). */
  preparedBy?: string | null;
}

export default function CoverPage({
  cover,
  logoUrl,
  preparedBy,
}: CoverPageProps) {
  const {
    title,
    logo,
    customerName,
    propertyAddress,
    pointOfContact,
    insurance,
    coverPhotoUrl,
  } = cover;
  const preparedByLine = formatPreparedBy(preparedBy);

  return (
    <Page size="LETTER" style={styles.page}>
      {logo != null ? (
        <View style={styles.logoRow}>
          {logo.kind === "image" && logoUrl ? (
            <Image src={logoUrl} style={styles.logoImage} />
          ) : (
            <Text style={styles.logoText}>
              {logo.kind === "text" ? logo.name : ""}
            </Text>
          )}
        </View>
      ) : null}

      <Text style={styles.title}>{title.trim() ? title : "Photo Report"}</Text>

      {preparedByLine ? (
        <Text style={styles.preparedBy}>{preparedByLine}</Text>
      ) : null}

      {coverPhotoUrl ? (
        <Image src={coverPhotoUrl} style={styles.coverPhoto} />
      ) : (
        <View style={styles.coverPhotoPlaceholder}>
          <Text style={styles.placeholderText}>No cover photo selected</Text>
        </View>
      )}

      <View style={styles.twoColumn}>
        <View style={styles.column}>
          {customerName != null ? (
            <>
              <Text style={styles.blockLabel}>Customer</Text>
              <Text style={styles.blockValue}>{customerName}</Text>
            </>
          ) : null}
          {propertyAddress != null ? (
            <>
              <Text style={styles.blockLabel}>Property</Text>
              <Text style={styles.blockLine}>{propertyAddress}</Text>
            </>
          ) : null}
        </View>

        {pointOfContact != null ? (
          <View style={styles.column}>
            <Text style={styles.blockLabel}>Point of contact</Text>
            <Text style={styles.blockValue}>{pointOfContact.companyName}</Text>
            {pointOfContact.phone !== null ? (
              <Text style={styles.blockLine}>{pointOfContact.phone}</Text>
            ) : null}
            {pointOfContact.email !== null ? (
              <Text style={styles.blockLine}>{pointOfContact.email}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {insurance != null && insurance.visible ? (
        <View style={styles.insuranceBlock}>
          <Text style={styles.insuranceLine}>
            Insurance Carrier: {insurance.carrier || "—"}
          </Text>
          <Text style={styles.insuranceLine}>
            Claim Number: {insurance.claimNumber || "—"}
          </Text>
        </View>
      ) : null}
    </Page>
  );
}

"use client";

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import CoverPage from "@/components/report-pdf/cover-page";
import type { CoverPageData } from "@/lib/cover-page-data";
import type { DocumentPage } from "@/lib/build-report-document";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReportPhoto {
  id: string;
  url: string;
  caption: string | null;
  before_after_role: "before" | "after" | null;
  taken_at: string | null;
}

interface ReportPDFProps {
  title: string;
  coverPageData: CoverPageData;
  coverPhotoUrl: string | null;
  logoUrl: string | null;
  pages: DocumentPage[];
  photos: Record<string, ReportPhoto>;
  photosPerPage: number;
}

// ─── Styles (body only — cover lives in CoverPage) ───────────────────────────

const colors = {
  primary: "#1B2434",
  text: "#1A1A1A",
  muted: "#666666",
  light: "#999999",
  border: "#E5E7EB",
  bg: "#F9FAFB",
  white: "#FFFFFF",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    color: colors.text,
  },
  sectionHeader: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
  },
  sectionDescription: {
    fontSize: 9,
    color: "#CBD5E1",
    marginTop: 3,
  },
  photoRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  photoContainer: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    overflow: "hidden",
  },
  photoImage: {
    width: "100%",
    objectFit: "cover",
  },
  photoCaption: {
    padding: 6,
    backgroundColor: colors.bg,
  },
  photoCaptionText: {
    fontSize: 8,
    color: colors.text,
  },
  photoBadge: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 2,
    marginTop: 3,
    alignSelf: "flex-start",
  },
  beforeBadge: {
    backgroundColor: "#FCEBEB",
    color: "#791F1F",
  },
  afterBadge: {
    backgroundColor: "#E1F5EE",
    color: "#085041",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 7,
    color: colors.light,
  },
  footerPage: {
    fontSize: 7,
    color: colors.muted,
    fontFamily: "Helvetica-Bold",
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function getPhotoHeight(photosPerPage: number): number {
  switch (photosPerPage) {
    case 1:
      return 480;
    case 2:
      return 230;
    case 4:
      return 210;
    case 6:
      return 140;
    default:
      return 230;
  }
}

function getGridCols(photosPerPage: number): number {
  switch (photosPerPage) {
    case 1:
      return 1;
    case 2:
      return 1;
    case 4:
      return 2;
    case 6:
      return 2;
    default:
      return 1;
  }
}

function getRowsPerPage(photosPerPage: number): number {
  switch (photosPerPage) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 4:
      return 2;
    case 6:
      return 3;
    default:
      return 2;
  }
}

// ─── Components ──────────────────────────────────────────────────────────────

function PageFooter({ title }: { title: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        AAA Disaster Recovery — {title}
      </Text>
      <Text
        style={styles.footerPage}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

function PhotoCard({
  photo,
  height,
}: {
  photo: ReportPhoto;
  height: number;
}) {
  return (
    <View style={styles.photoContainer}>
      <Image src={photo.url} style={[styles.photoImage, { height }]} />
      <View style={styles.photoCaption}>
        {photo.caption && (
          <Text style={styles.photoCaptionText}>{photo.caption}</Text>
        )}
        {photo.before_after_role && (
          <Text
            style={[
              styles.photoBadge,
              photo.before_after_role === "before"
                ? styles.beforeBadge
                : styles.afterBadge,
            ]}
          >
            {photo.before_after_role === "before" ? "BEFORE" : "AFTER"}
          </Text>
        )}
        {!photo.caption && !photo.before_after_role && (
          <Text style={[styles.photoCaptionText, { color: colors.light }]}>
            No caption
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Main Document ───────────────────────────────────────────────────────────

export default function ReportPDFDocument({
  title,
  coverPageData,
  coverPhotoUrl,
  logoUrl,
  pages,
  photos,
  photosPerPage,
}: ReportPDFProps) {
  const photoHeight = getPhotoHeight(photosPerPage);
  const gridCols = getGridCols(photosPerPage);

  const sectionOrdinals = new Map<string, number>();
  for (const page of pages) {
    if (page.kind === "photoPage" && !sectionOrdinals.has(page.sectionTitle)) {
      sectionOrdinals.set(page.sectionTitle, sectionOrdinals.size + 1);
    }
  }

  let prevSectionTitle: string | null = null;

  return (
    <Document title={title} author="AAA Disaster Recovery">
      {pages.map((page, idx) => {
        if (page.kind === "cover") {
          return (
            <CoverPage
              key={`cover-${idx}`}
              data={coverPageData}
              title={title}
              coverPhotoUrl={coverPhotoUrl}
              logoUrl={logoUrl}
            />
          );
        }

        const isFirstOfSection = prevSectionTitle !== page.sectionTitle;
        prevSectionTitle = page.sectionTitle;
        const ordinal = sectionOrdinals.get(page.sectionTitle) ?? 0;
        const rows = chunkArray(page.slots, gridCols);

        return (
          <Page key={`p${idx}`} size="LETTER" style={styles.page}>
            {isFirstOfSection && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {ordinal}. {page.sectionTitle}
                </Text>
              </View>
            )}

            {rows.map((row, ri) => (
              <View key={ri} style={styles.photoRow}>
                {row.map((slot) => {
                  const photo = photos[slot.photoId];
                  if (!photo) return null;
                  return (
                    <PhotoCard
                      key={slot.photoId}
                      photo={photo}
                      height={photoHeight}
                    />
                  );
                })}
                {row.length < gridCols &&
                  Array.from({ length: gridCols - row.length }).map((_, i) => (
                    <View key={`empty-${i}`} style={{ flex: 1 }} />
                  ))}
              </View>
            ))}

            <PageFooter title={title} />
          </Page>
        );
      })}
    </Document>
  );
}

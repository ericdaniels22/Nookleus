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
import type { DocumentPage } from "@/lib/build-report-document";
import type { CoverPageData } from "@/lib/cover-page-data";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReportPhotoRenderData {
  url: string;
  before_after_role: "before" | "after" | null;
}

interface ReportSection {
  title: string;
  description: string;
  photo_ids: string[];
}

interface ReportPDFProps {
  title: string;
  coverPageData: CoverPageData;
  coverPhotoUrl: string | null;
  logoUrl: string | null;
  sections: ReportSection[];
  photoRenderData: Record<string, ReportPhotoRenderData>;
  documentPages: DocumentPage[];
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

// Slot height at photosPerPage=2 — matches prior layout.
const PHOTO_SLOT_HEIGHT = 230;

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
  url,
  caption,
  beforeAfterRole,
}: {
  url: string;
  caption: string | null;
  beforeAfterRole: "before" | "after" | null;
}) {
  return (
    <View style={styles.photoContainer}>
      <Image src={url} style={[styles.photoImage, { height: PHOTO_SLOT_HEIGHT }]} />
      <View style={styles.photoCaption}>
        {caption && (
          <Text style={styles.photoCaptionText}>{caption}</Text>
        )}
        {beforeAfterRole && (
          <Text
            style={[
              styles.photoBadge,
              beforeAfterRole === "before"
                ? styles.beforeBadge
                : styles.afterBadge,
            ]}
          >
            {beforeAfterRole === "before" ? "BEFORE" : "AFTER"}
          </Text>
        )}
        {!caption && !beforeAfterRole && (
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
  sections,
  photoRenderData,
  documentPages,
}: ReportPDFProps) {
  const descriptionByTitle = new Map<string, string>();
  for (const s of sections) {
    if (!descriptionByTitle.has(s.title)) {
      descriptionByTitle.set(s.title, s.description);
    }
  }

  // Section numbering: increment when sectionTitle changes between
  // consecutive photoPage entries. Mirrors the old "1. Section" treatment.
  let previousSectionTitle: string | null = null;
  let sectionCounter = 0;

  const pageElements: React.ReactNode[] = [];
  documentPages.forEach((page, index) => {
    if (page.kind === "cover") {
      pageElements.push(
        <CoverPage
          key={`cover-${index}`}
          data={coverPageData}
          title={title}
          coverPhotoUrl={coverPhotoUrl}
          logoUrl={logoUrl}
        />,
      );
      return;
    }

    const isFirstOfSection = page.sectionTitle !== previousSectionTitle;
    if (isFirstOfSection) {
      sectionCounter += 1;
    }
    previousSectionTitle = page.sectionTitle;

    pageElements.push(
      <Page key={`pp-${index}`} size="LETTER" style={styles.page}>
        {isFirstOfSection && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {sectionCounter}. {page.sectionTitle}
            </Text>
            {descriptionByTitle.get(page.sectionTitle) && (
              <Text style={styles.sectionDescription}>
                {descriptionByTitle.get(page.sectionTitle)}
              </Text>
            )}
          </View>
        )}

        {page.slots.map((slot) => {
          const render = photoRenderData[slot.photoId];
          if (!render) return null;
          return (
            <View key={slot.photoId} style={styles.photoRow}>
              <PhotoCard
                url={render.url}
                caption={slot.caption}
                beforeAfterRole={render.before_after_role}
              />
            </View>
          );
        })}

        <PageFooter title={title} />
      </Page>,
    );
  });

  return (
    <Document title={title} author="AAA Disaster Recovery">
      {pageElements}
    </Document>
  );
}

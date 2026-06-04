"use client";

import { Document } from "@react-pdf/renderer";

import BeforeAfterPairPage from "@/components/report-pdf/before-after-pair-page";
import CoverPage from "@/components/report-pdf/cover-page";
import PhotoPage from "@/components/report-pdf/photo-page";
import SectionDividerPage from "@/components/report-pdf/section-divider-page";
import type { CoverPageData } from "@/lib/cover-page-data";
import type { DocumentPage, PhotoSlot } from "@/lib/build-report-document";

interface ReportPhoto {
  id: string;
  url: string;
  caption: string | null;
  before_after_role: "before" | "after" | null;
  taken_at: string | null;
}

function resolveSlot(
  slot: PhotoSlot,
  photos: Record<string, ReportPhoto>,
) {
  const photo = photos[slot.photoId];
  if (!photo) return null;
  return {
    photoId: slot.photoId,
    url: photo.url,
    number: slot.number,
    caption: slot.caption,
    takenAt: slot.takenAt,
    takenBy: slot.takenBy,
    orientation: slot.orientation,
  };
}

interface ReportPDFProps {
  title: string;
  coverPageData: CoverPageData;
  coverPhotoUrl: string | null;
  logoUrl: string | null;
  reportDate: string;
  pages: DocumentPage[];
  photos: Record<string, ReportPhoto>;
  /** The report's creator name, for the cover's "Prepared by {name}" line. */
  preparedBy?: string | null;
}

export default function ReportPDFDocument({
  title,
  coverPageData,
  coverPhotoUrl,
  logoUrl,
  reportDate,
  pages,
  photos,
  preparedBy,
}: ReportPDFProps) {
  const customerName = coverPageData.customerName;

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
              preparedBy={preparedBy}
            />
          );
        }

        if (page.kind === "sectionDivider") {
          return (
            <SectionDividerPage
              key={`d${idx}`}
              title={page.title}
              description={page.description}
              customerName={customerName}
              reportDate={reportDate}
            />
          );
        }

        if (page.kind === "beforeAfterPair") {
          const beforeSlot = resolveSlot(page.before, photos);
          const afterSlot = resolveSlot(page.after, photos);
          if (!beforeSlot || !afterSlot) return null;
          return (
            <BeforeAfterPairPage
              key={`bap${idx}`}
              before={beforeSlot}
              after={afterSlot}
              sectionTitle={page.sectionTitle}
              customerName={customerName}
              reportDate={reportDate}
            />
          );
        }

        const photoSlots = page.slots
          .map((slot) => resolveSlot(slot, photos))
          .filter((s): s is NonNullable<typeof s> => s !== null);

        return (
          <PhotoPage
            key={`p${idx}`}
            slots={photoSlots}
            sectionTitle={page.sectionTitle}
            customerName={customerName}
            reportDate={reportDate}
            photosPerPage={page.photosPerPage}
          />
        );
      })}
    </Document>
  );
}

"use client";

import { Document } from "@react-pdf/renderer";

import CoverPage from "@/components/report-pdf/cover-page";
import PhotoPage from "@/components/report-pdf/photo-page";
import type { CoverPageData } from "@/lib/cover-page-data";
import type { DocumentPage } from "@/lib/build-report-document";

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
  reportDate: string;
  pages: DocumentPage[];
  photos: Record<string, ReportPhoto>;
}

export default function ReportPDFDocument({
  title,
  coverPageData,
  coverPhotoUrl,
  logoUrl,
  reportDate,
  pages,
  photos,
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
            />
          );
        }

        const photoSlots = page.slots
          .map((slot) => {
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
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        return (
          <PhotoPage
            key={`p${idx}`}
            slots={photoSlots}
            sectionTitle={page.sectionTitle}
            customerName={customerName}
            reportDate={reportDate}
          />
        );
      })}
    </Document>
  );
}

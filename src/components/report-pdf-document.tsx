"use client";

import { Document } from "@react-pdf/renderer";

import BeforeAfterPairPage from "@/components/report-pdf/before-after-pair-page";
import CoverPage from "@/components/report-pdf/cover-page";
import PhotoPage from "@/components/report-pdf/photo-page";
import SectionDividerPage from "@/components/report-pdf/section-divider-page";
import type { ReportRenderModel } from "@/lib/report-render-model";

interface ReportPDFProps {
  /**
   * The fully-resolved render model: cover blocks, page list, and every photo
   * slot's enabled detail fields are already decided upstream. This component
   * only routes each page to its component — it makes no content decisions.
   */
  model: ReportRenderModel;
  /** Signed URL for an image logo; ignored for a text logo. */
  logoUrl: string | null;
  /** The report's creator name, for the cover's "Prepared by {name}" line. */
  preparedBy?: string | null;
}

export default function ReportPDFDocument({
  model,
  logoUrl,
  preparedBy,
}: ReportPDFProps) {
  return (
    <Document title={model.title} author="AAA Disaster Recovery">
      {model.pages.map((page, idx) => {
        if (page.kind === "cover") {
          return (
            <CoverPage
              key={`cover-${idx}`}
              cover={model.cover}
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
            />
          );
        }

        if (page.kind === "beforeAfterPair") {
          return (
            <BeforeAfterPairPage
              key={`bap${idx}`}
              before={page.before}
              after={page.after}
              sectionTitle={page.sectionTitle}
            />
          );
        }

        return (
          <PhotoPage
            key={`p${idx}`}
            slots={page.slots}
            sectionTitle={page.sectionTitle}
            photosPerPage={page.photosPerPage}
          />
        );
      })}
    </Document>
  );
}

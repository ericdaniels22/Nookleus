"use client";

import { pdf } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase";
import ReportPDFDocument from "@/components/report-pdf-document";
import {
  buildReportDocument,
  type ReportPhotoInput,
} from "@/lib/build-report-document";
import { resolveCoverPageData } from "@/lib/cover-page-data";
import { resolvePhotosPerPage } from "@/lib/resolve-photos-per-page";
import { photoUrl, reportCoverPhotoUrl } from "@/lib/jobs/photo-url";
import type { CompanySettings } from "@/lib/types";

interface ReportSection {
  title: string;
  description: string;
  photo_ids: string[];
}

interface JoinedContact {
  full_name: string | null;
}

interface JoinedCoverPhoto {
  storage_path: string | null;
  annotated_path: string | null;
}

interface JoinedJob {
  id: string;
  job_number: string;
  property_address: string;
  claim_number: string | null;
  insurance_company: string | null;
  cover_photo_id: string | null;
  contact: JoinedContact | null;
  cover_photo: JoinedCoverPhoto | null;
}

const COMPANY_SETTINGS_KEYS = [
  "company_name",
  "phone",
  "email",
  "logo_path",
  "report_photos_per_page",
] as const;

async function loadCompanySettings(
  supabase: ReturnType<typeof createClient>,
): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", COMPANY_SETTINGS_KEYS as unknown as string[]);

  if (error) {
    // Soft-fail: render with empty settings rather than block PDF generation.
    return {};
  }

  const settings: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.value != null) settings[row.key] = row.value;
  }
  return settings as CompanySettings;
}

/**
 * Generate a PDF for a photo report, upload to Supabase storage,
 * and update the report record with the pdf_path and status.
 */
export async function generateReportPDF(reportId: string): Promise<string> {
  const supabase = createClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // 1. Fetch the report + joined job, contact, and cover photo
  const { data: report, error: reportErr } = await supabase
    .from("photo_reports")
    .select(
      `
        *,
        job:jobs!job_id(
          id,
          job_number,
          property_address,
          claim_number,
          insurance_company,
          cover_photo_id,
          contact:contacts!contact_id(full_name),
          cover_photo:photos!cover_photo_id(storage_path, annotated_path)
        )
      `,
    )
    .eq("id", reportId)
    .single();

  if (reportErr || !report) {
    throw new Error("Failed to fetch report");
  }

  const job = report.job as JoinedJob;
  const sections = report.sections as ReportSection[];

  // 2. Company settings for cover page + branding + body layout
  const companySettings = await loadCompanySettings(supabase);

  // 3. Photos-per-page is company-wide (ADR 0003, amended): resolved from
  //    Company Settings, not the report's template. A report's template_id is
  //    preset provenance only and no longer influences layout.
  const photosPerPage = resolvePhotosPerPage(companySettings);

  // 4. Resolve cover page model (pure)
  const coverPageData = resolveCoverPageData(
    {
      property_address: job.property_address,
      insurance_company: job.insurance_company,
      claim_number: job.claim_number,
      contact: job.contact
        ? { full_name: job.contact.full_name ?? "" }
        : null,
    },
    companySettings,
  );

  // 5. Resolve image URLs (both buckets are public)
  const logoUrl =
    coverPageData.logo.kind === "image"
      ? `${supabaseUrl}/storage/v1/object/public/company-assets/${coverPageData.logo.path}`
      : null;

  const coverPhotoUrl = reportCoverPhotoUrl(job.cover_photo, supabaseUrl);

  // 6. Collect body photos (body unchanged in slice 1)
  const allPhotoIds = new Set<string>();
  sections.forEach((s) => s.photo_ids.forEach((id) => allPhotoIds.add(id)));

  const { data: photoData } = await supabase
    .from("photos")
    .select(
      "id, storage_path, annotated_path, caption, before_after_pair_id, before_after_role, taken_at, taken_by, width, height",
    )
    .in("id", Array.from(allPhotoIds));

  const photos: Record<
    string,
    {
      id: string;
      url: string;
      caption: string | null;
      before_after_role: "before" | "after" | null;
      taken_at: string | null;
    }
  > = {};

  const engineInputPhotos: Record<string, ReportPhotoInput> = {};

  for (const p of photoData || []) {
    photos[p.id] = {
      id: p.id,
      url: photoUrl(
        { annotated_path: p.annotated_path, storage_path: p.storage_path },
        supabaseUrl,
        "full",
      ),
      caption: p.caption,
      before_after_role: p.before_after_role,
      taken_at: p.taken_at,
    };
    engineInputPhotos[p.id] = {
      id: p.id,
      caption: p.caption,
      takenAt: p.taken_at,
      takenBy: p.taken_by ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      beforeAfterPairId: p.before_after_pair_id ?? null,
      beforeAfterRole: p.before_after_role ?? null,
    };
  }

  // 7. Build the document page list from the engine
  const documentPages = buildReportDocument({
    sections: sections.map((s) => ({
      title: s.title,
      description: s.description ?? null,
      photoIds: s.photo_ids,
    })),
    photos: engineInputPhotos,
    photosPerPage,
  });

  // 8. Render PDF
  const blob = await pdf(
    <ReportPDFDocument
      title={report.title}
      coverPageData={coverPageData}
      coverPhotoUrl={coverPhotoUrl}
      logoUrl={logoUrl}
      reportDate={report.report_date}
      pages={documentPages}
      photos={photos}
    />,
  ).toBlob();

  // 8. Upload PDF to Supabase Storage
  const pdfPath = `${job.job_number}/${reportId}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from("reports")
    .upload(pdfPath, blob, {
      upsert: true,
      contentType: "application/pdf",
    });

  if (uploadErr) {
    throw new Error(`Failed to upload PDF: ${uploadErr.message}`);
  }

  // 9. Update report record
  const { error: updateErr } = await supabase
    .from("photo_reports")
    .update({
      pdf_path: pdfPath,
      status: "generated",
    })
    .eq("id", reportId);

  if (updateErr) {
    throw new Error(`Failed to update report: ${updateErr.message}`);
  }

  return pdfPath;
}

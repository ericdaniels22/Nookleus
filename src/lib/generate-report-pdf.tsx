"use client";

import { pdf } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase";
import ReportPDFDocument from "@/components/report-pdf-document";
import type { ReportPhotoInput } from "@/lib/build-report-document";
import {
  buildReportRenderModel,
  type RenderPhotoInput,
  type RenderTag,
} from "@/lib/report-render-model";
import { resolveCoverPageData } from "@/lib/cover-page-data";
import {
  companySettingsToReportDefault,
  resolveReportSettings,
  REPORT_DEFAULT_SETTING_KEYS,
  type StoredReportSettings,
} from "@/lib/photo-report-settings";
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

interface JoinedJob {
  id: string;
  job_number: string;
  property_address: string;
  claim_number: string | null;
  insurance_company: string | null;
  cover_photo_id: string | null;
  contact: JoinedContact | null;
}

// One nested tag embed as PostgREST returns it for
// photo_tag_assignments(tag:photo_tags(name, color)).
interface JoinedTagAssignment {
  tag: { name: string; color: string } | null;
}

// Branding + Cover Page settings plus the Organization's Report-layout default
// keys (photos-per-page and the six detail toggles, ADR 0014 / #549).
const COMPANY_SETTINGS_KEYS: string[] = [
  "company_name",
  "phone",
  "email",
  "logo_path",
  ...Object.values(REPORT_DEFAULT_SETTING_KEYS),
];

async function loadCompanySettings(
  supabase: ReturnType<typeof createClient>,
): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", COMPANY_SETTINGS_KEYS);

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

// Resolve the chosen cover photo (the report's own pick, else the Job's — both
// folded into one id by resolveReportSettings) to a full-resolution URL. The
// photo may live outside any Section, so it is fetched by id rather than read
// from the body-photo load.
async function resolveCoverPhotoUrl(
  supabase: ReturnType<typeof createClient>,
  coverPhotoId: string | null,
  supabaseUrl: string,
): Promise<string | null> {
  if (!coverPhotoId) return null;
  const { data } = await supabase
    .from("photos")
    .select("storage_path, annotated_path")
    .eq("id", coverPhotoId)
    .maybeSingle();
  return reportCoverPhotoUrl(data ?? null, supabaseUrl);
}

/**
 * The shared PDF producer behind both Preview and Generate. Fetches the report,
 * its Job, company settings, and photos; resolves the report's effective look;
 * assembles the complete render model; and renders it to a PDF blob. It performs
 * NO writes — Preview consumes the blob directly, Generate uploads it — so both
 * paths render from one identical model and cannot drift (#554). Returns the
 * Job's number alongside the blob, which Generate needs for the storage path.
 */
async function assembleReportPdf(
  reportId: string,
): Promise<{ blob: Blob; jobNumber: string }> {
  const supabase = createClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // 1. Fetch the report (its own look snapshot included) + joined job + contact
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
          contact:contacts!contact_id(full_name)
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

  // 2. Company settings: cover-page data + branding + the Organization's
  //    Report-layout default (photos-per-page and detail toggles).
  const companySettings = await loadCompanySettings(supabase);

  // 3. Resolve the report's effective look (ADR 0014): its own snapshot wins,
  //    else the Organization default, else hardcoded defaults. This owns the
  //    legacy 1-per-page → 2 remap and the cover-photo precedence (report → Job).
  const reportStored: StoredReportSettings = {
    report_settings: report.report_settings ?? null,
    cover_config: report.cover_config ?? null,
    cover_photo_id: report.cover_photo_id ?? null,
  };
  const settings = resolveReportSettings(
    reportStored,
    companySettingsToReportDefault(
      companySettings as Record<string, string | undefined>,
    ),
    job.cover_photo_id,
  );

  // 4. Resolve cover-page data (pure) and image URLs (both buckets are public)
  const coverData = resolveCoverPageData(
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

  const logoUrl =
    coverData.logo.kind === "image"
      ? `${supabaseUrl}/storage/v1/object/public/company-assets/${coverData.logo.path}`
      : null;

  const coverPhotoUrl = await resolveCoverPhotoUrl(
    supabase,
    settings.cover.coverPhotoId,
    supabaseUrl,
  );

  // 5. Collect body photos with their tags
  const allPhotoIds = new Set<string>();
  sections.forEach((s) => s.photo_ids.forEach((id) => allPhotoIds.add(id)));

  const { data: photoData } = await supabase
    .from("photos")
    .select(
      "id, storage_path, annotated_path, caption, before_after_pair_id, before_after_role, taken_at, taken_by, width, height, photo_tag_assignments(tag:photo_tags(name, color))",
    )
    .in("id", Array.from(allPhotoIds));

  const photos: Record<string, RenderPhotoInput> = {};

  for (const p of photoData || []) {
    // The untyped client infers the to-one `tag` embed pessimistically (as an
    // array); at runtime PostgREST returns a single object per assignment, so
    // narrow through `unknown` to the actual shape.
    const tags: RenderTag[] = (
      (p.photo_tag_assignments ?? []) as unknown as JoinedTagAssignment[]
    )
      .map((a) => a.tag)
      .filter((t): t is { name: string; color: string } => t != null)
      .map((t) => ({ name: t.name, color: t.color }));

    const base: ReportPhotoInput = {
      id: p.id,
      caption: p.caption,
      takenAt: p.taken_at,
      takenBy: p.taken_by ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      beforeAfterPairId: p.before_after_pair_id ?? null,
      beforeAfterRole: p.before_after_role ?? null,
    };
    photos[p.id] = {
      ...base,
      url: photoUrl(
        { annotated_path: p.annotated_path, storage_path: p.storage_path },
        supabaseUrl,
        "full",
      ),
      tags,
    };
  }

  // 6. Assemble the complete, render-ready model: page structure + cover blocks
  //    + each slot's enabled detail fields, all decided here (the @react-pdf
  //    components stay dumb).
  const model = buildReportRenderModel({
    title: report.title,
    sections: sections.map((s) => ({
      title: s.title,
      description: s.description ?? null,
      photoIds: s.photo_ids,
    })),
    photos,
    settings,
    coverData,
    coverPhotoUrl,
    propertyAddress: job.property_address,
  });

  // 7. Render PDF
  const blob = await pdf(
    <ReportPDFDocument
      model={model}
      logoUrl={logoUrl}
      preparedBy={report.created_by}
    />,
  ).toBlob();

  return { blob, jobNumber: job.job_number };
}

/**
 * Render a photo report to a PDF blob without persisting anything — the
 * on-demand Preview pane (#554) feeds this blob straight into the viewer. Shares
 * one producer with {@link generateReportPDF}, so Preview renders byte-identical
 * to Generate.
 */
export async function renderReportPdfBlob(reportId: string): Promise<Blob> {
  const { blob } = await assembleReportPdf(reportId);
  return blob;
}

/**
 * Generate a PDF for a photo report, upload to Supabase storage,
 * and update the report record with the pdf_path and status.
 */
export async function generateReportPDF(reportId: string): Promise<string> {
  const supabase = createClient();
  const { blob, jobNumber } = await assembleReportPdf(reportId);

  // 8. Upload PDF to Supabase Storage
  const pdfPath = `${jobNumber}/${reportId}.pdf`;
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

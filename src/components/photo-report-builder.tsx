"use client";

import { useEffect, useReducer, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase";
import { photoUrl } from "@/lib/jobs/photo-url";
import { generateReportPDF } from "@/lib/generate-report-pdf";
import {
  initBuilderState,
  photoReportBuilderReducer,
} from "@/lib/photo-report-builder";
import type { ReportSection } from "@/lib/build-initial-sections";
import type { Photo, PhotoReport } from "@/lib/types";

// How long to wait after the last edit before persisting (mirrors the
// estimate builder's auto-save debounce).
const DEBOUNCE_MS = 2000;

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface PhotoReportBuilderProps {
  jobId: string;
  report: PhotoReport;
  /** Photos referenced by the report's sections, for thumbnails. */
  photos: Photo[];
  supabaseUrl: string;
}

export default function PhotoReportBuilder({
  jobId,
  report,
  photos,
  supabaseUrl,
}: PhotoReportBuilderProps) {
  const [state, dispatch] = useReducer(
    photoReportBuilderReducer,
    {
      title: report.title,
      report_date: report.report_date,
      sections: report.sections as ReportSection[],
    },
    initBuilderState,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [generating, setGenerating] = useState(false);

  const photosById = new Map(photos.map((p) => [p.id, p]));

  // Auto-save: a debounced write whenever the builder is dirty. The closure
  // captures the state (and its `revision`) as of the last edit, so we persist
  // exactly that snapshot and tell `markSaved` which revision it was. If the
  // user edits again while this write is in flight, that edit bumps the
  // revision and reschedules its own save; `markSaved` then declines to clear
  // dirty for the older revision, so the newer edit is never lost.
  useEffect(() => {
    if (!state.dirty) return;
    const savedRevision = state.revision;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      const supabase = createClient();
      const { error } = await supabase
        .from("photo_reports")
        .update({
          title: state.title,
          report_date: state.reportDate,
          sections: state.sections,
        })
        .eq("id", report.id);
      if (error) {
        setSaveStatus("error");
        return;
      }
      dispatch({ type: "markSaved", revision: savedRevision });
      setSaveStatus("saved");
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    state.dirty,
    state.title,
    state.reportDate,
    state.sections,
    state.revision,
    report.id,
  ]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const pdfPath = await generateReportPDF(report.id);
      toast.success("PDF generated.");
      window.open(
        `${supabaseUrl}/storage/v1/object/public/reports/${pdfPath}`,
        "_blank",
      );
    } catch {
      toast.error("Failed to generate PDF.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header bar */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Link
          href={`/jobs/${jobId}`}
          aria-label="Back to job"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          Back to job
        </Link>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground min-w-[64px] text-right">
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "error" && "Save failed"}
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5EA7] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#234b8a] transition-colors disabled:opacity-60"
        >
          {generating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FileDown size={14} />
          )}
          Generate PDF
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
          {/* Report meta */}
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Report title
              </span>
              <input
                type="text"
                aria-label="Report title"
                value={state.title}
                onChange={(e) =>
                  dispatch({ type: "setTitle", title: e.target.value })
                }
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="block w-48">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Report date
              </span>
              <input
                type="date"
                aria-label="Report date"
                value={state.reportDate}
                onChange={(e) =>
                  dispatch({ type: "setReportDate", reportDate: e.target.value })
                }
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          {/* Sections */}
          {state.sections.map((section, index) => (
            <section
              key={index}
              className="rounded-xl border border-border bg-card p-4 space-y-3"
            >
              <input
                type="text"
                aria-label="Section heading"
                value={section.title}
                onChange={(e) =>
                  dispatch({
                    type: "setSectionHeading",
                    index,
                    heading: e.target.value,
                  })
                }
                placeholder="Section heading"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <textarea
                aria-label="Section write-up"
                value={section.description}
                onChange={(e) =>
                  dispatch({
                    type: "setSectionWriteup",
                    index,
                    writeup: e.target.value,
                  })
                }
                placeholder="Write-up"
                rows={4}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                {section.photo_ids.map((photoId) => {
                  const photo = photosById.get(photoId);
                  if (!photo) return null;
                  return (
                    <div
                      key={photoId}
                      className="aspect-square overflow-hidden rounded-lg"
                    >
                      <img
                        src={photoUrl(photo, supabaseUrl, "grid")}
                        alt={photo.caption || "Photo"}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {section.photo_ids.length} photo
                {section.photo_ids.length === 1 ? "" : "s"}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

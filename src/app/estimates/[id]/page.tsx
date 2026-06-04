import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ArrowLeft, FileText, Pencil } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import { getEstimateWithContents } from "@/lib/estimates";
import { STATUS_BADGE_CLASSES, formatStatusLabel } from "@/lib/estimate-status";
import { ExportPdfButton } from "@/components/export-pdf-modal/button";
import { SendButton } from "@/components/send-modal/button";
import { TrashedBanner } from "@/components/trash/trashed-banner";
import { PdfPreviewFrame } from "@/components/documents/pdf-preview-frame";

// ─────────────────────────────────────────────────────────────────────────────
// Local ErrorPage helper — mirrors the pattern in /estimates/[id]/edit/page.tsx
// ─────────────────────────────────────────────────────────────────────────────

interface ErrorPageProps {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
}

function ErrorPage({ title, message, backHref, backLabel }: ErrorPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[40vh] px-4">
      <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
        <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{message}</p>
        <Link
          href={backHref}
          className="inline-block mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page — #385: View shows the real customer-facing PDF inline. Line-item
// editing lives in the builder (the Edit link), never here.
// ─────────────────────────────────────────────────────────────────────────────

export default async function EstimateViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // 1. Permission check — must happen before any DB reads.
  const auth = await requirePagePermission(supabase, {
    permission: "view_estimates",
  });
  if (!auth.ok) {
    return (
      <ErrorPage
        title="Access restricted"
        message="You don't have permission to view estimates."
        backHref="/jobs"
        backLabel="Back to jobs"
      />
    );
  }

  // 2. Fetch the estimate for the header chrome (number, status, title, the
  //    parent-job back-link). The document body itself is the rendered PDF.
  const estimate = await getEstimateWithContents(id, supabase);
  if (!estimate) notFound();

  // 3. Check edit permission for the conditional Edit button (server-side).
  const editAuth = await requirePagePermission(supabase, {
    permission: "edit_estimates",
  });
  const canEdit = editAuth.ok;

  // ── Derived display values ─────────────────────────────────────────────────
  const isVoided = estimate.status === "voided";
  const statusLabel = formatStatusLabel(estimate.status);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* ── BACK LINK ───────────────────────────────────────────────────────── */}
      <Link
        href={`/jobs/${estimate.job_id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} />
        Back to job
      </Link>

      {/* ── VOIDED BANNER ───────────────────────────────────────────────────── */}
      {isVoided && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2 text-destructive font-medium">
          This estimate has been voided
          {estimate.void_reason && (
            <span className="font-normal"> — {estimate.void_reason}</span>
          )}
        </div>
      )}

      {/* ── TRASHED BANNER ──────────────────────────────────────────────────── */}
      {estimate.deleted_at && (
        <TrashedBanner
          documentKind="estimate"
          documentId={estimate.id}
          documentNumber={estimate.estimate_number}
          deletedAt={estimate.deleted_at}
          jobId={estimate.job_id}
        />
      )}

      {/* ── HEADER ROW ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4">
        {/* Left: icon + number + badge + title */}
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText size={16} className="text-muted-foreground shrink-0" />
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
              {estimate.estimate_number}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[estimate.status]}`}
            >
              {statusLabel}
            </span>
          </div>
          <h1
            className={`text-xl font-semibold text-foreground ${
              isVoided ? "line-through text-muted-foreground" : ""
            }`}
          >
            {estimate.title}
          </h1>
        </div>

        {/* Right: Send + Export PDF + Edit button (if permitted, and not trashed) */}
        {!estimate.deleted_at && (
          <div className="flex items-center gap-2 shrink-0">
            <SendButton
              mode="estimate"
              documentId={id}
              jobId={estimate.job_id}
              status={estimate.status}
            />
            <ExportPdfButton
              documentType="estimate"
              documentId={id}
              filenameHint={estimate.estimate_number}
            />
            {canEdit && (
              <Link
                href={`/estimates/${id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
              >
                <Pencil size={14} />
                Edit
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── INLINE PDF (the real customer-facing document) ──────────────────── */}
      <PdfPreviewFrame
        src={`/api/estimates/${id}/preview`}
        title={`Estimate ${estimate.estimate_number}`}
      />
    </div>
  );
}

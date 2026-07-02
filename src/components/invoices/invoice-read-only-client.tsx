"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import RecordPaymentModal from "@/components/payments/record-payment-modal";
import { PaymentRequestModal } from "@/components/payments/payment-request-modal";
import { ExportPdfButton } from "@/components/documents/export-pdf-button";
import { SendButton } from "@/components/send-modal/button";
import { TrashedBanner } from "@/components/trash/trashed-banner";
import { LiveLayoutPanel } from "@/components/documents/live-layout-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { getStatusBadgeClasses, formatStatusLabel } from "@/lib/estimate-status";
import type { DocumentPdfLayout, InvoiceWithContents, PdfPreset } from "@/lib/types";

export interface InvoiceReadOnlyClientProps {
  invoice: InvoiceWithContents & {
    job: {
      id: string;
      job_number: string;
      property_address: string | null;
      contacts: {
        full_name: string | null;
        email: string | null;
      } | null;
    } | null;
  };
  stripeConnected: boolean;
  isTrashed?: boolean;
  deletedAt?: string;
  /** The document's effective PDF layout (ADR 0012 precedence, resolved server-side). */
  layout: DocumentPdfLayout;
  /** Caller holds edit_invoices — the layout panel's toggles are interactive. */
  canEdit: boolean;
  /** The invoice is frozen (paid or voided) or trashed — the panel is read-only. */
  locked: boolean;
  /** The Organization's saved invoice presets — the panel's one-click starting points (#486). */
  presets?: PdfPreset[];
  /** Caller holds manage_pdf_presets — gates the panel's "Save as preset" action (#486). */
  canManagePresets?: boolean;
}

export default function InvoiceReadOnlyClient({
  invoice,
  stripeConnected,
  isTrashed = false,
  deletedAt,
  layout,
  canEdit,
  locked,
  presets = [],
  canManagePresets = false,
}: InvoiceReadOnlyClientProps) {
  const [paymentRequestOpen, setPaymentRequestOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);

  return (
    // max-w-6xl (wider than the usual View width): the live-layout panel's right
    // rail eats ~290px, so the preview column needs this room to clear the
    // viewer's 640px page-picker threshold (#465, #488). Keep in sync with the
    // Estimate View container.
    <div className="p-6 max-w-6xl mx-auto">
      {/* ── TRASHED BANNER ────────────────────────────────────────────────────── */}
      {isTrashed && deletedAt && (
        <div className="mb-4">
          <TrashedBanner
            documentKind="invoice"
            documentId={invoice.id}
            documentNumber={invoice.invoice_number}
            deletedAt={deletedAt}
          />
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <Link
          // Job-less invoices fall back to the accounting dashboard (AR aging);
          // the standalone /invoices list was retired in #386.
          href={invoice.job ? `/jobs/${invoice.job.id}` : "/accounting"}
          className="text-sm text-muted-foreground flex items-center gap-1"
        >
          <ArrowLeft size={14} /> Back
        </Link>
        <h1 className="text-xl font-semibold font-mono">{invoice.invoice_number}</h1>
        <span
          className={`px-2 py-1 rounded text-xs ${getStatusBadgeClasses("invoice", invoice.status)}`}
        >
          {formatStatusLabel("invoice", invoice.status)}
        </span>
        {/* Edit + payment actions stay in the header; Send + Export PDF moved
            beside the layout panel/preview below (#487). */}
        {!isTrashed && (
          <div className="ml-auto flex gap-2">
            <Link
              href={`/invoices/${invoice.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Edit
            </Link>
            {invoice.status !== "voided" && invoice.status !== "paid" && stripeConnected && (
              <Button variant="outline" size="sm" onClick={() => setPaymentRequestOpen(true)}>
                Send Payment Request
              </Button>
            )}
            {(invoice.status === "sent" || invoice.status === "partial") && (
              <Button variant="outline" size="sm" onClick={() => setRecordPaymentOpen(true)}>
                Record Payment
              </Button>
            )}
          </div>
        )}
      </div>

      <h2 className="text-xl">{invoice.title}</h2>

      {/* ── LAYOUT PANEL + INLINE PDF (the real customer-facing document) ───── */}
      {/* #385: View shows the real PDF, not an HTML re-render. #485: the panel
          owns the live preview so a single shared version drives the re-render —
          flip a toggle → autosave the snapshot → reload. Line-item editing lives
          in the builder (the Edit link), never here. */}
      <div className="mt-4">
        {/* ── DOCUMENT ACTIONS (beside the panel/preview, #487) ─────────────── */}
        {/* Send + Export render the invoice through the same effective layout
            (ADR 0012) as the preview below, so the file the customer gets is
            byte-for-byte the look shown here. */}
        {!isTrashed && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <SendButton
              mode="invoice"
              documentId={invoice.id}
              jobId={invoice.job_id}
              status={invoice.status}
            />
            <ExportPdfButton
              documentType="invoice"
              documentId={invoice.id}
              filenameHint={invoice.invoice_number}
            />
          </div>
        )}
        <LiveLayoutPanel
          documentType="invoice"
          documentId={invoice.id}
          previewSrc={`/api/invoices/${invoice.id}/preview`}
          previewTitle={`Invoice ${invoice.invoice_number}`}
          layout={layout}
          canEdit={canEdit}
          locked={locked}
          presets={presets}
          canManagePresets={canManagePresets}
        />
      </div>

      <RecordPaymentModal
        invoiceId={invoice.id}
        jobId={invoice.job_id}
        open={recordPaymentOpen}
        onOpenChange={setRecordPaymentOpen}
        onRecorded={() => {
          setRecordPaymentOpen(false);
          /* trigger refetch */
        }}
      />
      <PaymentRequestModal
        invoiceId={invoice.id}
        jobId={invoice.job_id}
        open={paymentRequestOpen}
        onOpenChange={setPaymentRequestOpen}
      />
    </div>
  );
}

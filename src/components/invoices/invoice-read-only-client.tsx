"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import RecordPaymentModal from "@/components/payments/record-payment-modal";
import { PaymentRequestModal } from "@/components/payments/payment-request-modal";
import { ExportPdfButton } from "@/components/export-pdf-modal/button";
import { SendButton } from "@/components/send-modal/button";
import { TrashedBanner } from "@/components/trash/trashed-banner";
import { PdfPreviewFrame } from "@/components/documents/pdf-preview-frame";
import { getStatusBadgeClasses, formatStatusLabel } from "@/lib/estimate-status";
import type { InvoiceWithContents } from "@/lib/types";

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
}

export default function InvoiceReadOnlyClient({
  invoice,
  stripeConnected,
  isTrashed = false,
  deletedAt,
}: InvoiceReadOnlyClientProps) {
  const [paymentRequestOpen, setPaymentRequestOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);

  return (
    <div className="p-6 max-w-5xl mx-auto">
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
          href={invoice.job ? `/jobs/${invoice.job.id}` : "/invoices"}
          className="text-sm text-muted-foreground flex items-center gap-1"
        >
          <ArrowLeft size={14} /> Back
        </Link>
        <h1 className="text-2xl font-semibold font-mono">{invoice.invoice_number}</h1>
        <span
          className={`px-2 py-1 rounded text-xs ${getStatusBadgeClasses("invoice", invoice.status)}`}
        >
          {formatStatusLabel("invoice", invoice.status)}
        </span>
        {!isTrashed && (
          <div className="ml-auto flex gap-2">
            <Link href={`/invoices/${invoice.id}/edit`} className="btn">
              Edit
            </Link>
            <SendButton
              mode="invoice"
              documentId={invoice.id}
              jobId={invoice.job_id}
              status={invoice.status}
            />
            {invoice.status !== "voided" && invoice.status !== "paid" && stripeConnected && (
              <button onClick={() => setPaymentRequestOpen(true)} className="btn">
                Send Payment Request
              </button>
            )}
            {(invoice.status === "sent" || invoice.status === "partial") && (
              <button onClick={() => setRecordPaymentOpen(true)} className="btn">
                Record Payment
              </button>
            )}
            <ExportPdfButton
              documentType="invoice"
              documentId={invoice.id}
              filenameHint={invoice.invoice_number}
            />
          </div>
        )}
      </div>

      <h2 className="text-xl">{invoice.title}</h2>

      {/* ── INLINE PDF (the real customer-facing document) ──────────────────── */}
      {/* #385: View shows the real PDF, not an HTML re-render. Line-item
          editing lives in the builder (the Edit link), never here. */}
      <div className="mt-4">
        <PdfPreviewFrame
          src={`/api/invoices/${invoice.id}/preview`}
          title={`Invoice ${invoice.invoice_number}`}
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import RecordPaymentModal from "@/components/payments/record-payment-modal";
import { PaymentRequestModal } from "@/components/payments/payment-request-modal";
import { ExportPdfButton } from "@/components/export-pdf-modal/button";
import { SendButton } from "@/components/send-modal/button";
import { TrashedBanner } from "@/components/trash/trashed-banner";
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

      {invoice.opening_statement && (
        <div
          className="prose prose-sm mt-4"
          dangerouslySetInnerHTML={{ __html: invoice.opening_statement }}
        />
      )}

      <div className="mt-6 space-y-4">
        {invoice.sections.map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-4">
            <h3 className="font-semibold">{s.title}</h3>
            <table className="w-full mt-2 text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Unit Price</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td>{it.quantity}</td>
                    <td>{it.unit ?? ""}</td>
                    <td>${it.unit_price.toFixed(2)}</td>
                    <td className="text-right">${it.amount.toFixed(2)}</td>
                  </tr>
                ))}
                {s.subsections.map((sub) => (
                  <tr key={sub.id}>
                    <td colSpan={5}>
                      <strong>{sub.title}</strong>
                    </td>
                  </tr>
                ))}
                {s.subsections.flatMap((sub) =>
                  sub.items.map((it) => (
                    <tr key={it.id}>
                      <td className="pl-4">{it.description}</td>
                      <td>{it.quantity}</td>
                      <td>{it.unit ?? ""}</td>
                      <td>${it.unit_price.toFixed(2)}</td>
                      <td className="text-right">${it.amount.toFixed(2)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="mt-6 ml-auto w-80 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>${invoice.subtotal.toFixed(2)}</span>
        </div>
        {invoice.markup_amount > 0 && (
          <div className="flex justify-between">
            <span>Markup</span>
            <span>${invoice.markup_amount.toFixed(2)}</span>
          </div>
        )}
        {invoice.discount_amount > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>−${invoice.discount_amount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <span>Adjusted</span>
          <span>${invoice.adjusted_subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax ({invoice.tax_rate}%)</span>
          <span>${invoice.tax_amount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold border-t pt-1">
          <span>Total</span>
          <span>${invoice.total_amount.toFixed(2)}</span>
        </div>
      </div>

      {invoice.closing_statement && (
        <div
          className="prose prose-sm mt-4"
          dangerouslySetInnerHTML={{ __html: invoice.closing_statement }}
        />
      )}

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

"use client";

import { useState } from "react";
import Link from "next/link";
import type { Payment } from "@/lib/types";
import RecordPaymentModal from "@/components/record-payment";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OnlinePaymentRequestsSubsection } from "@/components/payments/online-payment-requests-subsection";

type Props = {
  jobId: string;
  payments: Payment[];
  onPaymentRecorded: () => void;
  stripeConnected?: boolean;
};

export default function BillingSection({ jobId, payments, onPaymentRecorded, stripeConnected = false }: Props) {
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const totalPaid = payments
    .filter((p) => p.status === "received")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const insurancePaid = payments
    .filter((p) => p.status === "received" && p.source === "insurance")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const homeownerPaid = payments
    .filter((p) => p.status === "received" && p.source === "homeowner")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">Billing</h3>
        <div className="flex items-center gap-2">
          <Link
            href={`/jobs/${jobId}/invoices/new`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-border hover:bg-accent transition-colors"
          >
            + Create Invoice
          </Link>
          <button
            onClick={() => setPaymentModalOpen(true)}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-colors"
          >
            + Record Payment
          </button>
        </div>
      </div>
      <RecordPaymentModal
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        jobId={jobId}
        onPaymentAdded={onPaymentRecorded}
      />
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-4">
          No payments recorded yet.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Collected</span>
              <span className="font-semibold text-foreground">
                ${totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {totalPaid > 0 && (
              <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                {insurancePaid > 0 && (
                  <div
                    className="bg-[#0F6E56] h-full"
                    style={{
                      width: `${(insurancePaid / totalPaid) * 100}%`,
                    }}
                  />
                )}
                {homeownerPaid > 0 && (
                  <div
                    className="bg-[#2B5EA7] h-full"
                    style={{
                      width: `${(homeownerPaid / totalPaid) * 100}%`,
                    }}
                  />
                )}
              </div>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground/60">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#0F6E56]" />
                Insurance: ${insurancePaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#2B5EA7]" />
                Homeowner: ${homeownerPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Payment rows */}
          <div className="border-t border-border/50 pt-3 space-y-2">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-sm py-1.5"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn(
                      "text-[10px] px-1.5 py-0 rounded",
                      p.source === "insurance"
                        ? "bg-[#E1F5EE] text-[#085041]"
                        : p.source === "homeowner"
                        ? "bg-[#E6F1FB] text-[#0C447C]"
                        : "bg-[#F1EFE8] text-[#5F5E5A]"
                    )}
                  >
                    {p.source}
                  </Badge>
                  <span className="text-muted-foreground">
                    {p.method.replace("_", " ")}
                    {p.reference_number && ` — ${p.reference_number}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    ${Number(p.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  <Badge
                    className={cn(
                      "text-[10px] px-1.5 py-0 rounded",
                      p.status === "received"
                        ? "bg-[#E1F5EE] text-[#085041]"
                        : p.status === "pending"
                        ? "bg-[#FAEEDA] text-[#633806]"
                        : "bg-[#FCEBEB] text-[#791F1F]"
                    )}
                  >
                    {p.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <OnlinePaymentRequestsSubsection jobId={jobId} stripeConnected={stripeConnected} />
    </div>
  );
}

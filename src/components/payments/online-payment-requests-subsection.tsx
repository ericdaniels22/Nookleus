"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CreditCard, Landmark } from "lucide-react";
import { PaymentRequestModal } from "./payment-request-modal";
import { RefundModal } from "./refund-modal";
import { QbSyncBadge } from "./qb-sync-badge";

interface PaymentRequestRow {
  id: string;
  title: string;
  amount: number;
  status: string;
  request_type: string;
  created_at: string;
  link_expires_at: string | null;
  link_token: string | null;
  paid_at: string | null;
  payer_name: string | null;
  payment_method_type: "card" | "us_bank_account" | null;
  receipt_pdf_path: string | null;
  quickbooks_sync_status:
    | "pending"
    | "synced"
    | "failed"
    | "not_applicable"
    | null;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  sent: {
    label: "Sent",
    className: "bg-amber-500/20 text-amber-300",
  },
  viewed: {
    label: "Viewed",
    className: "bg-amber-500/20 text-amber-300",
  },
  paid: {
    label: "Paid",
    className: "bg-emerald-500/20 text-emerald-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/20 text-red-300",
  },
  refunded: {
    label: "Refunded",
    className: "bg-slate-500/20 text-slate-300",
  },
  partially_refunded: {
    label: "Partial refund",
    className: "bg-slate-500/20 text-slate-300",
  },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
  voided: {
    label: "Voided",
    className: "bg-muted text-muted-foreground line-through",
  },
};

export function OnlinePaymentRequestsSubsection({
  jobId,
  stripeConnected,
}: {
  jobId: string;
  stripeConnected: boolean;
}) {
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<PaymentRequestRow | null>(
    null,
  );
  const [refundRemaining, setRefundRemaining] = useState(0);

  const refresh = async () => {
    const res = await fetch(`/api/payment-requests?job_id=${encodeURIComponent(jobId)}`);
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const { payment_requests } = (await res.json()) as { payment_requests: PaymentRequestRow[] };
    setRows(payment_requests ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const onVoid = async (id: string) => {
    const res = await fetch(`/api/payment-requests/${id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "User voided from billing section" }),
    });
    if (!res.ok) {
      toast.error("Failed to void");
      return;
    }
    toast.success("Voided");
    await refresh();
  };

  const onSend = async (id: string) => {
    setSendingId(id);
    const res = await fetch(`/api/payment-requests/${id}/send`, {
      method: "POST",
    });
    setSendingId(null);
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      toast.error(error ?? "Failed to send");
      return;
    }
    toast.success("Payment request sent");
    await refresh();
  };

  const onCopyLink = async (tokenValue: string | null) => {
    if (!tokenValue) {
      toast.error("No link token — the request hasn't been created with a link yet.");
      return;
    }
    const url = `${window.location.origin}/pay/${tokenValue}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to copy — open View as customer and copy from the address bar.");
    }
  };

  const onViewAsCustomer = (tokenValue: string | null) => {
    if (!tokenValue) {
      toast.error("No link token.");
      return;
    }
    window.open(`/pay/${tokenValue}`, "_blank", "noopener,noreferrer");
  };

  const onViewReceipt = async (id: string) => {
    const res = await fetch(`/api/payment-requests/${id}/receipt-url`);
    if (!res.ok) {
      toast.error(
        "Receipt PDF not available yet — it generates after Stripe confirms the payment.",
      );
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const onRetryQb = async (prId: string) => {
    const rfRes = await fetch(`/api/payment-requests/${prId}/refundable`);
    if (!rfRes.ok) {
      toast.error("Cannot locate linked payment.");
      return;
    }
    const { payment_id } = (await rfRes.json()) as { payment_id: string };
    const res = await fetch(`/api/payments/${payment_id}/retry-qb-sync`, {
      method: "POST",
    });
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      toast.error(error ?? "Retry failed");
      return;
    }
    toast.success("Synced to QuickBooks");
    await refresh();
  };

  const onOpenRefund = async (r: PaymentRequestRow) => {
    const res = await fetch(`/api/payment-requests/${r.id}/refundable`);
    if (!res.ok) {
      toast.error("Cannot refund this payment.");
      return;
    }
    const { remaining } = (await res.json()) as { remaining: number };
    setRefundRemaining(remaining);
    setRefundTarget(r);
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">Online Payment Requests</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No online payment requests yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const s = STATUS_STYLES[r.status] ?? STATUS_STYLES.draft;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border bg-card p-3"
              >
                <div>
                  <div className="font-medium flex items-center gap-1">
                    {(r.status === "paid" ||
                      r.status === "partially_refunded") &&
                      r.payment_method_type === "us_bank_account" && (
                        <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    {(r.status === "paid" ||
                      r.status === "partially_refunded") &&
                      r.payment_method_type === "card" && (
                        <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    {r.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${Number(r.amount).toFixed(2)} &middot; {r.request_type}
                    {r.paid_at && (
                      <>
                        {" "}
                        &middot; paid{" "}
                        {new Date(r.paid_at).toLocaleDateString()}
                      </>
                    )}
                    {r.payer_name && <> &middot; {r.payer_name}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={s.className}>{s.label}</Badge>
                  {r.status === "draft" && (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => onSend(r.id)}
                        disabled={sendingId === r.id}
                      >
                        {sendingId === r.id ? "Sending\u2026" : "Send"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onVoid(r.id)}
                      >
                        Void
                      </Button>
                    </>
                  )}
                  {(r.status === "sent" || r.status === "viewed") && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onCopyLink(r.link_token)}
                      >
                        Copy link
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewAsCustomer(r.link_token)}
                      >
                        View as customer
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onVoid(r.id)}
                      >
                        Void
                      </Button>
                    </>
                  )}
                  {(r.status === "paid" ||
                    r.status === "partially_refunded") && (
                    <>
                      <QbSyncBadge status={r.quickbooks_sync_status} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void onViewReceipt(r.id)}
                      >
                        View receipt
                      </Button>
                      {r.quickbooks_sync_status === "failed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void onRetryQb(r.id)}
                        >
                          Retry QB sync
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void onOpenRefund(r)}
                      >
                        Refund
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {stripeConnected && (
        <Button variant="secondary" onClick={() => setDepositOpen(true)}>
          + Request Deposit
        </Button>
      )}

      <PaymentRequestModal
        open={depositOpen}
        onOpenChange={setDepositOpen}
        jobId={jobId}
        defaultTitle=""
        defaultRequestType="deposit"
        onCreated={() => void refresh()}
      />

      {refundTarget && (
        <RefundModal
          open={Boolean(refundTarget)}
          onOpenChange={(v) => {
            if (!v) setRefundTarget(null);
          }}
          paymentRequestId={refundTarget.id}
          paymentRequestTitle={refundTarget.title}
          remainingRefundable={refundRemaining}
          onRefunded={async () => {
            setRefundTarget(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

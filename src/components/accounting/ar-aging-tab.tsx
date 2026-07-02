"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PayerFilter = "all" | "insurance" | "homeowner";
type Bucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

type Row = {
  invoiceId: string;
  jobId: string;
  jobNumber: string | null;
  jobAddress: string | null;
  invoiceNumber: string | null;
  payerType: string | null;
  outstanding: number;
  ageDays: number;
  bucket: Bucket;
  lastContact: string | null;
};

const BUCKET_LABEL: Record<Bucket, string> = {
  current: "Current",
  "1-30": "1-30d",
  "31-60": "31-60d",
  "61-90": "61-90d",
  "90+": "90+d",
};
// §2.6 aging-severity gradient as palette classes (tint-not-fill, never a raw
// hex): neutral → amber → orange → red as the bucket ages. `text` paints the
// label + age pill foreground, `border` the card outline (~25% alpha), `tint`
// the age-pill wash (~14% alpha).
const BUCKET_SEVERITY: Record<Bucket, { text: string; border: string; tint: string }> = {
  current: { text: "text-muted-foreground", border: "border-white/10", tint: "bg-white/5" },
  "1-30": { text: "text-muted-foreground", border: "border-white/10", tint: "bg-white/5" },
  "31-60": { text: "text-amber-300", border: "border-amber-400/25", tint: "bg-amber-400/14" },
  "61-90": { text: "text-orange-300", border: "border-orange-400/25", tint: "bg-orange-400/14" },
  "90+": { text: "text-red-300", border: "border-red-500/25", tint: "bg-red-500/14" },
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function ArAgingTab() {
  const router = useRouter();
  const [payer, setPayer] = useState<PayerFilter>("all");
  const [data, setData] = useState<{ buckets: Record<Bucket, { total: number; count: number }>; rows: Row[] } | null>(null);

  useEffect(() => {
    fetch(`/api/accounting/ar-aging?payer=${payer}`)
      .then((r) => r.json())
      .then(setData);
  }, [payer]);

  const nudge = (row: Row) => {
    const subject = `Invoice ${row.invoiceNumber} - Payment follow-up`;
    const body =
      row.payerType === "insurance"
        ? `Hi,\n\nFollowing up on invoice ${row.invoiceNumber} for job ${row.jobNumber}. Current outstanding balance is ${fmt(row.outstanding)}. Please let me know if you need anything from our side to process payment.\n\nThank you.`
        : `Hi,\n\nJust a quick reminder about invoice ${row.invoiceNumber} (${fmt(row.outstanding)} outstanding). Please let me know if you have any questions.\n\nThank you.`;
    const params = new URLSearchParams({
      compose: "1",
      subject,
      body,
      jobId: row.jobId,
    });
    router.push(`/email?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* 5 bucket cards */}
      <div className="grid grid-cols-5 gap-3">
        {(["current", "1-30", "31-60", "61-90", "90+"] as Bucket[]).map((b) => {
          const bk = data?.buckets?.[b] ?? { total: 0, count: 0 };
          const sev = BUCKET_SEVERITY[b];
          return (
            <div key={b} className={`rounded-lg p-4 bg-white/3 border ${sev.border}`}>
              <div className={`text-xs uppercase ${sev.text}`}>{BUCKET_LABEL[b]}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{fmt(bk.total)}</div>
              <div className="text-xs text-muted-foreground tabular-nums">{bk.count} invoices</div>
            </div>
          );
        })}
      </div>

      {/* Payer filter pills */}
      <div className="inline-flex rounded-md border border-border overflow-hidden">
        {(["all", "insurance", "homeowner"] as PayerFilter[]).map((p) => (
          <button
            key={p}
            onClick={() => setPayer(p)}
            className={`px-3 py-1.5 text-sm capitalize ${payer === p ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {p === "all" ? "All payers" : p}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Job / Invoice</th>
              <th className="text-left px-3 py-2">Payer</th>
              <th className="text-right px-3 py-2">Outstanding</th>
              <th className="text-left px-3 py-2">Age</th>
              <th className="text-left px-3 py-2">Last contact</th>
              <th className="text-right px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.invoiceId} className="border-t border-border">
                <td className="px-3 py-2">
                  <div>{r.jobAddress ?? r.jobNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    #{r.invoiceNumber} • {r.jobNumber}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {r.payerType ? <PayerBadge value={r.payerType} /> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="text-right px-3 py-2 tabular-nums">{fmt(r.outstanding)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-xs tabular-nums ${BUCKET_SEVERITY[r.bucket].text} ${BUCKET_SEVERITY[r.bucket].tint}`}
                  >
                    {r.ageDays}d
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.lastContact ? new Date(r.lastContact).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                </td>
                <td className="text-right px-3 py-2">
                  <button onClick={() => nudge(r)} className="text-sm rounded px-2 py-1 hover:bg-muted">
                    Nudge ↗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayerBadge({ value }: { value: string }) {
  // §2.6 tint treatment as palette classes: insurance = violet, homeowner =
  // blue, mixed = amber, anything else = neutral.
  const m: Record<string, { cls: string; label: string }> = {
    insurance: { cls: "bg-violet-500/15 text-violet-300", label: "Insurance" },
    homeowner: { cls: "bg-blue-500/15 text-blue-300", label: "Homeowner" },
    mixed: { cls: "bg-amber-400/15 text-amber-300", label: "Mixed" },
  };
  const s = m[value] ?? { cls: "bg-white/5 text-muted-foreground", label: value };
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>;
}

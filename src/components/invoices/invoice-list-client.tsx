"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatStatusLabel,
  getStatusBadgeClasses,
} from "@/lib/estimate-status";
import { ForceDeleteConfirmDialog } from "@/components/trash/force-delete-confirm-dialog";
import { daysLeft } from "@/lib/trash/days-left";
import type { InvoiceRow, InvoiceStatus } from "@/lib/invoices";

type StatusFilter = "all" | InvoiceStatus | "trash";

interface InvoiceWithJob extends InvoiceRow {
  jobs?: {
    id: string;
    job_number: string;
    property_address: string | null;
    contacts?: { first_name: string | null; last_name: string | null } | null;
  };
}

const FILTER_TABS: StatusFilter[] = ["all", "draft", "sent", "partial", "paid", "voided", "trash"];

export default function InvoiceListClient() {
  const [rows, setRows] = useState<InvoiceWithJob[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [trashRows, setTrashRows] = useState<InvoiceWithJob[]>([]);
  const [forceTarget, setForceTarget] = useState<InvoiceWithJob | null>(null);
  const [isForceDeleting, setIsForceDeleting] = useState(false);

  const refreshTrash = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/invoices/trash");
    if (!res.ok) {
      toast.error("Failed to load trash");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { invoices: InvoiceWithJob[] };
    setTrashRows(data.invoices);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (filter === "trash") {
      await refreshTrash();
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (search.trim()) params.set("search", search.trim());
    params.set("limit", "100");
    const res = await fetch(`/api/invoices?${params.toString()}`);
    if (!res.ok) {
      toast.error("Failed to load invoices");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { rows: InvoiceWithJob[] };
    setRows(data.rows);
    setLoading(false);
  }, [filter, search, refreshTrash]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onVoid = useCallback(
    async (r: InvoiceWithJob) => {
      if (!confirm(`Void invoice ${r.invoice_number}? This cannot be undone.`)) return;
      const res = await fetch(`/api/invoices/${r.id}/void`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        toast.error(body?.error ?? "Failed to void invoice");
        return;
      }
      toast.success(`Invoice ${r.invoice_number} voided`);
      refresh();
    },
    [refresh],
  );

  const onRestore = useCallback(
    async (r: InvoiceWithJob) => {
      const res = await fetch(`/api/invoices/${r.id}/restore`, { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to restore invoice");
        return;
      }
      toast.success(`Invoice ${r.invoice_number} restored`);
      await refreshTrash();
    },
    [refreshTrash],
  );

  const onForceDelete = useCallback(async () => {
    if (!forceTarget || isForceDeleting) return;
    setIsForceDeleting(true);
    const res = await fetch(`/api/invoices/${forceTarget.id}`, { method: "DELETE" });
    setIsForceDeleting(false);
    setForceTarget(null);
    if (!res.ok) {
      toast.error("Failed to delete invoice");
      return;
    }
    toast.success(`Invoice ${forceTarget.invoice_number} permanently deleted`);
    await refreshTrash();
  }, [forceTarget, isForceDeleting, refreshTrash]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted-foreground">All invoices across all jobs</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_TABS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === f
                ? "bg-[#0F6E56] text-white border-[#0F6E56]"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "All" : f === "trash" ? "Trash" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
        <input
          type="text"
          placeholder="Search invoice #, title, memo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border border-border rounded-lg px-3 py-1.5 bg-background text-sm w-72"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="animate-spin mx-auto mb-2" size={22} /> Loading…
        </div>
      ) : filter === "trash" ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Invoice #</th>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Job</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trashRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    Trash is empty.
                  </td>
                </tr>
              )}
              {trashRows.map((r) => (
                <tr key={r.id} className="border-t border-border opacity-60 bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/invoices/${r.id}`} className="text-primary hover:underline">
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.title || "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {[r.jobs?.contacts?.first_name, r.jobs?.contacts?.last_name]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.jobs ? (r.jobs.property_address ?? r.jobs.job_number) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    ${Number(r.total_amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs text-muted-foreground">
                      In trash · {daysLeft(r.deleted_at)} days left
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        className="text-blue-600 text-xs hover:underline"
                        onClick={() => void onRestore(r)}
                      >
                        Restore
                      </button>
                      <button
                        className="text-red-600 text-xs hover:underline"
                        onClick={() => setForceTarget(r)}
                      >
                        Delete now
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Invoice #</th>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Job</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-left px-4 py-2 font-medium">Issued</th>
                <th className="text-left px-4 py-2 font-medium">Due</th>
                <th className="text-left px-4 py-2 font-medium">QB</th>
                <th className="px-4 py-2 font-medium w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-muted-foreground">
                    No invoices match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-accent/30">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/invoices/${r.id}`} className="text-primary hover:underline">
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.title || "—"}</td>
                  <td className="px-4 py-2">
                    {[r.jobs?.contacts?.first_name, r.jobs?.contacts?.last_name]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.jobs ? (
                      <Link
                        href={`/jobs/${r.jobs.id}`}
                        className="text-primary hover:underline"
                      >
                        {r.jobs.property_address ?? r.jobs.job_number}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${getStatusBadgeClasses(
                        "invoice",
                        r.status,
                      )}`}
                    >
                      {formatStatusLabel("invoice", r.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">${Number(r.total_amount).toFixed(2)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(r.issued_date)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(r.due_date)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.qb_invoice_id ? `QB ${r.qb_invoice_id}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex items-center justify-center rounded-md h-7 w-7 p-0 hover:bg-accent hover:text-accent-foreground transition-colors"
                        aria-label={`Actions for ${r.invoice_number}`}
                      >
                        <MoreVertical size={14} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem render={<Link href={`/invoices/${r.id}`} />}>
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem render={<Link href={`/invoices/${r.id}/edit`} />}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={r.status === "voided" || r.status === "draft"}
                          onClick={() => onVoid(r)}
                          className="text-destructive"
                        >
                          Void
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ForceDeleteConfirmDialog
        open={forceTarget !== null}
        onOpenChange={(open) => { if (!open) setForceTarget(null); }}
        documentKind="invoice"
        documentNumber={forceTarget?.invoice_number ?? ""}
        onConfirm={onForceDelete}
        isDeleting={isForceDeleting}
      />
    </div>
  );
}

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

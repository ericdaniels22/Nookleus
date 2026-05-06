"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Pencil, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import InvoicesList from "./invoices-list";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { STATUS_BADGE_CLASSES, formatStatusLabel } from "@/lib/estimate-status";
import { TrashConfirmDialog } from "@/components/trash/trash-confirm-dialog";
import { ForceDeleteConfirmDialog } from "@/components/trash/force-delete-confirm-dialog";
import { daysLeft } from "@/lib/trash/days-left";
import type { Estimate, Invoice } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// EstimatesInvoicesSection
// ─────────────────────────────────────────────────────────────────────────────

interface EstimatesInvoicesSectionProps {
  jobId: string;
}

export function EstimatesInvoicesSection({ jobId }: EstimatesInvoicesSectionProps) {
  const router = useRouter();
  const { hasPermission, loading: authLoading } = useAuth();

  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [trashTarget, setTrashTarget] = useState<
    | { kind: "estimate"; row: Estimate }
    | { kind: "invoice"; row: Pick<Invoice, "id" | "invoice_number"> }
    | null
  >(null);
  const [isTrashing, setIsTrashing] = useState(false);
  const [forceTarget, setForceTarget] = useState<
    | { kind: "estimate"; row: Estimate }
    | { kind: "invoice"; row: Invoice }
    | null
  >(null);
  const [isForceDeleting, setIsForceDeleting] = useState(false);

  const [showTrashed, setShowTrashed] = useState(false);
  const [trashedEstimates, setTrashedEstimates] = useState<Estimate[]>([]);
  const [trashedInvoices, setTrashedInvoices] = useState<Invoice[]>([]);

  async function fetchEstimates() {
    try {
      const res = await fetch(`/api/estimates?job_id=${jobId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to load estimates");
        return;
      }
      const data = (await res.json()) as { estimates: Estimate[] };
      setEstimates(data.estimates);
      setError(null);
    } catch {
      setError("Failed to load estimates");
    }
  }

  useEffect(() => {
    fetchEstimates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (!showTrashed) {
      setTrashedEstimates([]);
      setTrashedInvoices([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`/api/estimates/trash?job_id=${jobId}`).then((r) => r.json()),
      fetch(`/api/invoices/trash?job_id=${jobId}`).then((r) => r.json()),
    ]).then(([est, inv]) => {
      if (cancelled) return;
      setTrashedEstimates((est?.estimates ?? []) as Estimate[]);
      setTrashedInvoices((inv?.invoices ?? []) as Invoice[]);
    });
    return () => { cancelled = true; };
  }, [showTrashed, jobId]);

  async function handleTrashConfirm(reason: string | null) {
    if (!trashTarget || isTrashing) return;
    setIsTrashing(true);
    const url =
      trashTarget.kind === "estimate"
        ? `/api/estimates/${trashTarget.row.id}/delete`
        : `/api/invoices/${trashTarget.row.id}/delete`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_reason: reason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error((j as { error?: string }).error ?? `Failed to move ${trashTarget.kind} to trash`);
        return;
      }
      const number =
        trashTarget.kind === "estimate"
          ? trashTarget.row.estimate_number
          : trashTarget.row.invoice_number;
      const capturedTarget = trashTarget;
      toast.success(`${capitalize(capturedTarget.kind)} ${number} moved to trash`, {
        action: {
          label: "Undo",
          onClick: async () => {
            await fetch(
              capturedTarget.kind === "estimate"
                ? `/api/estimates/${capturedTarget.row.id}/restore`
                : `/api/invoices/${capturedTarget.row.id}/restore`,
              { method: "POST" },
            );
            router.refresh();
          },
        },
      });
      setTrashTarget(null);
      router.refresh();
      await fetchEstimates();
    } catch {
      toast.error(`Failed to move ${trashTarget.kind} to trash`);
    } finally {
      setIsTrashing(false);
    }
  }

  async function handleForceDelete() {
    if (!forceTarget || isForceDeleting) return;
    setIsForceDeleting(true);
    const capturedTarget = forceTarget;
    const url =
      capturedTarget.kind === "estimate"
        ? `/api/estimates/${capturedTarget.row.id}`
        : `/api/invoices/${capturedTarget.row.id}`;
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error((j as { error?: string }).error ?? `Failed to delete ${capturedTarget.kind}`);
        return;
      }
      const number =
        capturedTarget.kind === "estimate"
          ? capturedTarget.row.estimate_number
          : capturedTarget.row.invoice_number;
      toast.success(`${capitalize(capturedTarget.kind)} ${number} permanently deleted`);
      setForceTarget(null);
      router.refresh();
      if (showTrashed) {
        if (capturedTarget.kind === "estimate") {
          const tr = await fetch(`/api/estimates/trash?job_id=${jobId}`).then((r) => r.json());
          setTrashedEstimates((tr?.estimates ?? []) as Estimate[]);
        } else {
          const tr = await fetch(`/api/invoices/trash?job_id=${jobId}`).then((r) => r.json());
          setTrashedInvoices((tr?.invoices ?? []) as Invoice[]);
        }
      }
    } catch {
      toast.error(`Failed to delete ${capturedTarget.kind}`);
    } finally {
      setIsForceDeleting(false);
    }
  }

  async function restoreEstimate(id: string) {
    const res = await fetch(`/api/estimates/${id}/restore`, { method: "POST" });
    if (!res.ok) {
      toast.error("Failed to restore estimate");
      return;
    }
    toast.success("Estimate restored");
    router.refresh();
    await fetchEstimates();
    const tr = await fetch(`/api/estimates/trash?job_id=${jobId}`).then((r) => r.json());
    setTrashedEstimates((tr?.estimates ?? []) as Estimate[]);
  }

  async function restoreInvoice(id: string) {
    const res = await fetch(`/api/invoices/${id}/restore`, { method: "POST" });
    if (!res.ok) {
      toast.error("Failed to restore invoice");
      return;
    }
    toast.success("Invoice restored");
    router.refresh();
    const tr = await fetch(`/api/invoices/trash?job_id=${jobId}`).then((r) => r.json());
    setTrashedInvoices((tr?.invoices ?? []) as Invoice[]);
  }

  const canView = !authLoading && hasPermission("view_estimates");
  const canEdit = !authLoading && hasPermission("edit_estimates");
  const canCreate = !authLoading && hasPermission("create_estimates");
  const canCreateInvoices = !authLoading && hasPermission("create_invoices");
  const canManageEstimates = !authLoading && hasPermission("manage_estimates");
  const canManageInvoices = !authLoading && hasPermission("manage_invoices");

  return (
    <div className="space-y-6 mb-6">
      {/* ── Estimates card ─────────────────────────────────────────────────── */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h3 className="text-base font-semibold text-foreground">Estimates</h3>
            <div className="flex items-center gap-2">
              <input
                id="show-trashed"
                type="checkbox"
                checked={showTrashed}
                onChange={(e) => setShowTrashed(e.target.checked)}
              />
              <label htmlFor="show-trashed" className="text-sm text-muted-foreground">
                Show trashed
              </label>
            </div>
          </div>
          {authLoading ? null : canCreate ? (
            <Link href={`/jobs/${jobId}/estimates/new`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus size={14} />
                New Estimate
              </Button>
            </Link>
          ) : null}
        </div>

        {/* Loading state */}
        {estimates === null && !error && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {/* Error state */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Empty state */}
        {estimates !== null && !error && estimates.length === 0 && (!showTrashed || trashedEstimates.length === 0) && (
          <p className="text-sm text-muted-foreground">
            No estimates yet — create one to get started.
          </p>
        )}

        {/* Table */}
        {estimates !== null && !error && (estimates.length > 0 || (showTrashed && trashedEstimates.length > 0)) && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimates.map((est) => (
                <TableRow key={est.id}>
                  {/* Estimate number — monospace */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {est.estimate_number}
                      </span>
                      {est.converted_to_invoice_id && (
                        <Link
                          href={`/invoices/${est.converted_to_invoice_id}`}
                          className="text-xs text-blue-600 hover:underline"
                          title="View linked invoice"
                        >
                          → INV
                        </Link>
                      )}
                    </div>
                  </TableCell>

                  {/* Title */}
                  <TableCell className="max-w-xs truncate">
                    {est.title}
                  </TableCell>

                  {/* Total */}
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(est.total)}
                  </TableCell>

                  {/* Status badge */}
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[est.status]}`}
                    >
                      {formatStatusLabel(est.status)}
                    </span>
                  </TableCell>

                  {/* Actions */}
                  <TableCell>
                    {authLoading ? (
                      <span className="text-xs text-muted-foreground">Loading…</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        {canView && (
                          <Link href={`/estimates/${est.id}`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 gap-1 text-xs"
                              title="View estimate"
                            >
                              <Eye size={12} />
                              View
                            </Button>
                          </Link>
                        )}
                        {canEdit && est.status !== "voided" && est.status !== "converted" && (
                          <Link href={`/estimates/${est.id}/edit`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 gap-1 text-xs"
                              title="Edit estimate"
                            >
                              <Pencil size={12} />
                              Edit
                            </Button>
                          </Link>
                        )}
                        {canManageEstimates && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 gap-1 text-xs text-destructive hover:text-destructive"
                            title="Move estimate to trash"
                            onClick={() => setTrashTarget({ kind: "estimate", row: est })}
                          >
                            Trash
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}

              {/* Trashed estimate rows */}
              {showTrashed && trashedEstimates.map((est) => (
                <TableRow key={`trashed-est-${est.id}`} className="opacity-60 bg-muted/30">
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {est.estimate_number}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {est.title}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(est.total)}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      In trash · {daysLeft(est.deleted_at)} days left
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <button
                        className="text-blue-600 text-xs hover:underline"
                        onClick={() => void restoreEstimate(est.id)}
                      >
                        Restore
                      </button>
                      <button
                        className="text-red-600 text-xs hover:underline"
                        onClick={() => setForceTarget({ kind: "estimate", row: est })}
                      >
                        Delete now
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Invoices card ───────────────────────────────────────────────────── */}
      <div className="bg-card rounded-xl border border-border p-5">
        <InvoicesList
          jobId={jobId}
          canCreate={canCreateInvoices}
          canManage={canManageInvoices}
          onTrash={(row) => setTrashTarget({ kind: "invoice", row })}
        />

        {/* Trashed invoices — rendered below InvoicesList without modifying it */}
        {showTrashed && trashedInvoices.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Trashed invoices</h4>
            <table className="w-full text-sm">
              <tbody>
                {trashedInvoices.map((inv) => (
                  <tr key={`trashed-inv-${inv.id}`} className="opacity-60">
                    <td className="font-mono text-xs py-1 pr-3">{inv.invoice_number}</td>
                    <td className="py-1 pr-3">{inv.title}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">${inv.total_amount.toFixed(2)}</td>
                    <td className="py-1 pr-3">
                      <span className="text-xs text-muted-foreground">
                        In trash · {daysLeft(inv.deleted_at)} days left
                      </span>
                    </td>
                    <td className="py-1">
                      <div className="flex items-center gap-2">
                        <button
                          className="text-blue-600 text-xs hover:underline"
                          onClick={() => void restoreInvoice(inv.id)}
                        >
                          Restore
                        </button>
                        <button
                          className="text-red-600 text-xs hover:underline"
                          onClick={() => setForceTarget({ kind: "invoice", row: inv })}
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
        )}
      </div>

      {/* ── Trash confirm dialog ────────────────────────────────────────────── */}
      <TrashConfirmDialog
        open={trashTarget !== null}
        onOpenChange={(open) => { if (!open) setTrashTarget(null); }}
        documentNumber={
          trashTarget?.kind === "estimate"
            ? trashTarget.row.estimate_number
            : trashTarget?.row.invoice_number ?? ""
        }
        documentKind={trashTarget?.kind ?? "estimate"}
        onConfirm={handleTrashConfirm}
        isTrashing={isTrashing}
      />

      {/* ── Force-delete confirm dialog ─────────────────────────────────────── */}
      <ForceDeleteConfirmDialog
        open={forceTarget !== null}
        onOpenChange={(open) => { if (!open) setForceTarget(null); }}
        documentNumber={
          forceTarget?.kind === "estimate"
            ? forceTarget.row.estimate_number
            : forceTarget?.row.invoice_number ?? ""
        }
        documentKind={forceTarget?.kind ?? "estimate"}
        onConfirm={handleForceDelete}
        isDeleting={isForceDeleting}
      />
    </div>
  );
}

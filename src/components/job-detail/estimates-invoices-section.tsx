"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CreditCard, Eye, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
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
import {
  ROW_TINT_CLASSES,
  formatStatusLabel,
  getStatusBadgeClasses,
} from "@/lib/estimate-status";
import { buildBillingRows } from "@/lib/billing-rows";
import { TrashConfirmDialog } from "@/components/trash/trash-confirm-dialog";
import { ForceDeleteConfirmDialog } from "@/components/trash/force-delete-confirm-dialog";
import { VoidConfirmDialog } from "@/components/void-confirm-dialog";
import { PaymentRequestModal } from "@/components/payments/payment-request-modal";
import { NewEstimateModal } from "@/components/job-detail/new-estimate-modal";
import { daysLeft } from "@/lib/trash/days-left";
import type { Estimate, Invoice } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// EstimatesInvoicesSection (#384)
//
// The Job's Overview tab is one list of estimates. When an estimate is
// converted, its row flips to represent the invoice — that same row becomes
// where you view and edit the invoice — while the original estimate is kept as
// a frozen, view-only record reachable via a link on the flipped row. The
// derived shape of every row (plain estimate vs flipped invoice, the status
// shown, the tint, which document view/edit target, the frozen link) comes from
// the pure `buildBillingRows` transform; this component only renders it.
// ─────────────────────────────────────────────────────────────────────────────

interface EstimatesInvoicesSectionProps {
  jobId: string;
  jobDamageType: string | null;
}

export function EstimatesInvoicesSection({
  jobId,
  jobDamageType,
}: EstimatesInvoicesSectionProps) {
  const router = useRouter();
  const { hasPermission, loading: authLoading } = useAuth();

  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

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

  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);
  const [paymentRequestTarget, setPaymentRequestTarget] = useState<Invoice | null>(null);
  const [newEstimateOpen, setNewEstimateOpen] = useState(false);

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

  async function fetchInvoices() {
    try {
      const res = await fetch(`/api/invoices?jobId=${jobId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setInvoicesError(body.error ?? "Failed to load invoices");
        return;
      }
      const data = (await res.json()) as { rows: Invoice[] };
      setInvoices(data.rows ?? []);
      setInvoicesError(null);
    } catch {
      setInvoicesError("Failed to load invoices");
    }
  }

  useEffect(() => {
    fetchEstimates();
    fetchInvoices();
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
      if (capturedTarget.kind === "estimate") {
        await fetchEstimates();
      } else {
        await fetchInvoices();
      }
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

  async function handleVoidConfirm(reason: string) {
    if (!voidTarget || isVoiding) return;
    setIsVoiding(true);
    try {
      const res = await fetch(`/api/invoices/${voidTarget.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "voided",
          reason,
          updated_at_snapshot: voidTarget.updated_at,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error((j as { error?: string }).error ?? "Failed to void invoice");
        return;
      }
      toast.success(`Invoice ${voidTarget.invoice_number} voided`);
      setVoidTarget(null);
      router.refresh();
      await fetchInvoices();
    } catch {
      toast.error("Failed to void invoice");
    } finally {
      setIsVoiding(false);
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
    await fetchInvoices();
    const tr = await fetch(`/api/invoices/trash?job_id=${jobId}`).then((r) => r.json());
    setTrashedInvoices((tr?.invoices ?? []) as Invoice[]);
  }

  const canView = !authLoading && hasPermission("view_estimates");
  const canEdit = !authLoading && hasPermission("edit_estimates");
  const canCreate = !authLoading && hasPermission("create_estimates");
  const canEditInvoices = !authLoading && hasPermission("edit_invoices");
  const canViewInvoices = !authLoading && hasPermission("view_invoices");
  const canManageEstimates = !authLoading && hasPermission("manage_estimates");
  const canManageInvoices = !authLoading && hasPermission("manage_invoices");

  const loading = estimates === null || invoices === null;
  const loadError = error ?? invoicesError;
  // One ordered list: estimates, with converted rows flipped to their invoice.
  const rows = estimates && invoices ? buildBillingRows(estimates, invoices) : [];
  const hasTrashed = trashedEstimates.length > 0 || trashedInvoices.length > 0;

  return (
    <div className="space-y-6 mb-6">
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
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setNewEstimateOpen(true)}
            >
              <Plus size={14} />
              New Estimate
            </Button>
          ) : null}
        </div>

        {/* Loading state */}
        {loading && !loadError && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {/* Error state */}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        {/* Empty state */}
        {!loading && !loadError && rows.length === 0 && (!showTrashed || !hasTrashed) && (
          <p className="text-sm text-muted-foreground">
            No estimates yet — create one to get started.
          </p>
        )}

        {/* Table */}
        {!loading && !loadError && (rows.length > 0 || (showTrashed && hasTrashed)) && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-44">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const est = row.estimate;
                const inv = row.invoice;
                const isInvoice = row.kind === "invoice";
                // The flipped/orphan row shows the invoice; a plain row the estimate.
                const number = isInvoice ? inv!.invoice_number : est!.estimate_number;
                const title = isInvoice ? inv!.title : est!.title;
                const total = isInvoice ? inv!.total_amount : est!.total;

                return (
                  <TableRow key={row.id} className={ROW_TINT_CLASSES[row.tint]}>
                    {/* Number — monospace, with the frozen-estimate link on flips */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {number}
                        </span>
                        {row.frozenEstimateId && (
                          <Link
                            href={`/estimates/${row.frozenEstimateId}`}
                            className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline"
                            title="View the original estimate (frozen)"
                          >
                            <FileText size={11} />
                            Estimate
                          </Link>
                        )}
                      </div>
                    </TableCell>

                    {/* Title */}
                    <TableCell className="max-w-xs truncate">{title}</TableCell>

                    {/* Total */}
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(total)}
                    </TableCell>

                    {/* Status badge */}
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClasses(row.kind, row.statusShown)}`}
                      >
                        {formatStatusLabel(row.statusShown)}
                      </span>
                    </TableCell>

                    {/* Actions — targeting the row's document (estimate or invoice) */}
                    <TableCell>
                      {authLoading ? (
                        <span className="text-xs text-muted-foreground">Loading…</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          {/* View */}
                          {((isInvoice && canViewInvoices) || (!isInvoice && canView)) && (
                            <Link href={`/${row.document.kind}s/${row.document.id}`}>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 gap-1 text-xs"
                                title={`View ${row.kind}`}
                              >
                                <Eye size={12} />
                                View
                              </Button>
                            </Link>
                          )}

                          {/* Edit — gated by the row's edit guard (locked once paid/voided) */}
                          {row.canEdit &&
                            ((isInvoice && canEditInvoices) || (!isInvoice && canEdit)) && (
                              <Link href={`/${row.document.kind}s/${row.document.id}/edit`}>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 gap-1 text-xs"
                                  title={`Edit ${row.kind}`}
                                >
                                  <Pencil size={12} />
                                  Edit
                                </Button>
                              </Link>
                            )}

                          {/* Invoice-only: payment request */}
                          {isInvoice &&
                            canEditInvoices &&
                            (inv!.status === "sent" || inv!.status === "partial") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title="Send payment request"
                                aria-label="Send payment request"
                                onClick={() => setPaymentRequestTarget(inv!)}
                              >
                                <CreditCard size={14} />
                              </Button>
                            )}

                          {/* Invoice-only: void */}
                          {isInvoice &&
                            canManageInvoices &&
                            inv!.status !== "voided" &&
                            inv!.status !== "paid" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                title="Void invoice"
                                aria-label="Void invoice"
                                disabled={isVoiding}
                                onClick={() => setVoidTarget(inv!)}
                              >
                                <Ban size={14} />
                              </Button>
                            )}

                          {/* Trash — the active document (invoice on a flip, else estimate) */}
                          {isInvoice
                            ? canManageInvoices && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  title="Move invoice to trash"
                                  aria-label="Move invoice to trash"
                                  onClick={() => setTrashTarget({ kind: "invoice", row: inv! })}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )
                            : canManageEstimates && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  title="Move estimate to trash"
                                  aria-label="Move estimate to trash"
                                  onClick={() => setTrashTarget({ kind: "estimate", row: est! })}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

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

              {/* Trashed invoice rows */}
              {showTrashed && trashedInvoices.map((inv) => (
                <TableRow key={`trashed-inv-${inv.id}`} className="opacity-60 bg-muted/30">
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {inv.invoice_number}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {inv.title}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(inv.total_amount)}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      In trash · {daysLeft(inv.deleted_at)} days left
                    </span>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

      {/* ── Void confirm dialog (invoices only) ─────────────────────────────── */}
      <VoidConfirmDialog
        open={voidTarget !== null}
        onOpenChange={(open) => { if (!open) setVoidTarget(null); }}
        onConfirm={handleVoidConfirm}
        entityLabel="invoice"
      />

      {/* ── New Estimate modal (#571) — create + apply template in one action,
          then land in the populated builder. ─────────────────────────────── */}
      {newEstimateOpen && (
        <NewEstimateModal
          open={newEstimateOpen}
          onOpenChange={setNewEstimateOpen}
          jobId={jobId}
          jobDamageType={jobDamageType}
          onCreated={(estimateId) => {
            router.push(`/estimates/${estimateId}/edit`);
          }}
        />
      )}

      {/* ── Payment request modal (invoices only) ───────────────────────────── */}
      {paymentRequestTarget && (
        <PaymentRequestModal
          open={paymentRequestTarget !== null}
          onOpenChange={(open) => { if (!open) setPaymentRequestTarget(null); }}
          jobId={jobId}
          invoiceId={paymentRequestTarget.id}
          defaultTitle={paymentRequestTarget.title || `Invoice ${paymentRequestTarget.invoice_number}`}
          defaultAmount={paymentRequestTarget.total_amount}
          defaultRequestType="invoice"
        />
      )}
    </div>
  );
}

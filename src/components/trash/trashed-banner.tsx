"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ForceDeleteConfirmDialog } from "@/components/trash/force-delete-confirm-dialog";

interface Props {
  documentKind: "estimate" | "invoice";
  documentId: string;
  documentNumber: string;
  deletedAt: string;
  // Estimate-only: parent job to return to after force-delete. Ignored for invoices,
  // which always return to the global /invoices list.
  jobId?: string;
}

export function TrashedBanner({ documentKind, documentId, documentNumber, deletedAt, jobId }: Props) {
  const router = useRouter();
  const [forceOpen, setForceOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const purgeAt = new Date(new Date(deletedAt).getTime() + 30 * 86_400_000)
    .toLocaleDateString();

  async function restore() {
    setBusy(true);
    const res = await fetch(
      documentKind === "estimate"
        ? `/api/estimates/${documentId}/restore`
        : `/api/invoices/${documentId}/restore`,
      { method: "POST" },
    );
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to restore");
      return;
    }
    toast.success("Restored");
    router.refresh();
  }

  async function forceDelete() {
    setBusy(true);
    const res = await fetch(
      documentKind === "estimate"
        ? `/api/estimates/${documentId}`
        : `/api/invoices/${documentId}`,
      { method: "DELETE" },
    );
    setBusy(false);
    setForceOpen(false);
    if (!res.ok) {
      toast.error("Failed to delete");
      return;
    }
    toast.success(`${documentKind === "estimate" ? "Estimate" : "Invoice"} permanently deleted`);
    if (documentKind === "estimate") {
      router.push(jobId ? `/jobs/${jobId}` : "/jobs");
    } else {
      // The standalone /invoices list was retired in #386; cross-job invoice
      // context now lives on the accounting dashboard (AR aging).
      router.push("/accounting");
    }
  }

  return (
    <>
      <div className="flex items-center justify-between rounded-md border border-warning/20 bg-warning-tint p-3 text-sm text-warning">
        <span>
          This {documentKind} is in the trash. Auto-deletes on {purgeAt}.
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={restore} disabled={busy}>
            Restore
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setForceOpen(true)}
            disabled={busy}
          >
            Delete now
          </Button>
        </div>
      </div>
      <ForceDeleteConfirmDialog
        open={forceOpen}
        onOpenChange={setForceOpen}
        documentKind={documentKind}
        documentNumber={documentNumber}
        onConfirm={forceDelete}
        isDeleting={busy}
      />
    </>
  );
}

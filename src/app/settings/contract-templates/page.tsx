"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Copy,
  Archive,
  ArchiveRestore,
  FileText,
  Loader2,
  Lock,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import type { ContractTemplateListItem } from "@/lib/contracts/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Usage picture from GET …/[id]/usage, used to choose between the block
// dialog (a customer is mid-signing) and the confirm dialog (#76).
interface DeleteDialogState {
  template: ContractTemplateListItem;
  blockers: { contractId: string; status: string }[];
  draftCount: number;
}

export default function ContractTemplatesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const allowed = hasPermission("manage_contract_templates");

  const [templates, setTemplates] = useState<ContractTemplateListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/contract-templates");
    if (res.ok) {
      const data = (await res.json()) as ContractTemplateListItem[];
      setTemplates(data);
    } else {
      toast.error("Failed to load templates");
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && allowed) {
      refresh();
    }
  }, [authLoading, allowed, refresh]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/settings/contract-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Template" }),
      });
      if (!res.ok) throw new Error("Failed to create template");
      const created = (await res.json()) as { id: string };
      router.push(`/settings/contract-templates/${created.id}/edit`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create template");
      setCreating(false);
    }
  }

  async function handleDuplicate(id: string) {
    const res = await fetch(`/api/settings/contract-templates/${id}/duplicate`, {
      method: "POST",
    });
    if (res.ok) {
      toast.success("Template duplicated");
      refresh();
    } else {
      toast.error("Failed to duplicate");
    }
  }

  async function handleToggleArchive(t: ContractTemplateListItem) {
    if (t.is_active) {
      // Archive via DELETE (soft, sets is_active=false).
      const res = await fetch(`/api/settings/contract-templates/${t.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Template archived");
        refresh();
      } else {
        toast.error("Failed to archive");
      }
    } else {
      // Restore via PATCH.
      const res = await fetch(`/api/settings/contract-templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      if (res.ok) {
        toast.success("Template restored");
        refresh();
      } else {
        toast.error("Failed to restore");
      }
    }
  }

  async function handleToggleActive(t: ContractTemplateListItem, next: boolean) {
    // Optimistic update.
    setTemplates((prev) =>
      prev ? prev.map((row) => (row.id === t.id ? { ...row, is_active: next } : row)) : prev,
    );
    const res = await fetch(`/api/settings/contract-templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      toast.error("Failed to update");
      refresh();
    }
  }

  // Permanent delete (#76). Step one: ask the usage endpoint whether a
  // customer is mid-signing, then open the block or confirm dialog.
  async function handleDeletePermanently(t: ContractTemplateListItem) {
    const res = await fetch(`/api/settings/contract-templates/${t.id}/usage`);
    if (!res.ok) {
      toast.error("Failed to check template usage");
      return;
    }
    const usage = (await res.json()) as {
      blockers: { contractId: string; status: string }[];
      draftCount: number;
    };
    setDeleteDialog({
      template: t,
      blockers: usage.blockers,
      draftCount: usage.draftCount,
    });
  }

  // Step two: the user confirmed. The RPC re-checks eligibility, so a 409
  // here means a contract became mid-signing since the dialog opened.
  async function confirmDelete() {
    if (!deleteDialog) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/settings/contract-templates/${deleteDialog.template.id}/permanent`,
        { method: "DELETE" },
      );
      if (res.ok) {
        toast.success("Template permanently deleted");
        setDeleteDialog(null);
        refresh();
      } else if (res.status === 409) {
        toast.error(
          "Can't delete — a customer is mid-signing a contract from this template",
        );
        setDeleteDialog(null);
      } else {
        toast.error("Failed to delete template");
      }
    } finally {
      setDeleting(false);
    }
  }

  if (authLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Lock size={28} className="mx-auto text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          You don&apos;t have permission to manage contract templates. Ask an admin to grant you
          <span className="font-mono text-xs"> manage_contract_templates</span> in Users &amp; Crew.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <FileText size={18} className="text-[var(--brand-primary)]" />
            Contract Templates
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Templates define the body of contracts sent for signature. Merge fields resolve to job data at send time.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all disabled:opacity-60"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Upload Contract PDF
        </button>
      </div>

      {/* Table */}
      {templates === null ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 size={20} className="inline animate-spin mr-2" /> Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
          <FileText size={32} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-foreground font-medium">No contract templates yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create your first template to start sending contracts for signature.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-3">Name</th>
                <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Description</th>
                <th className="text-left font-medium px-4 py-3 whitespace-nowrap">Pages · Signers</th>
                <th className="text-left font-medium px-4 py-3">Active</th>
                <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Last Edited</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-border hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/settings/contract-templates/${t.id}/edit`}
                      className="font-medium text-foreground hover:text-[var(--brand-primary)] transition-colors"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[28ch] truncate hidden md:table-cell">
                    {t.description || <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex items-center gap-2 text-xs whitespace-nowrap">
                      {t.pdf_page_count != null ? (
                        <span>
                          {t.pdf_page_count} {t.pdf_page_count === 1 ? "page" : "pages"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">no PDF</span>
                      )}
                      <span>·</span>
                      <span>
                        {t.signer_count} signer{t.signer_count > 1 ? "s" : ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={t.is_active}
                        onChange={(e) => handleToggleActive(t, e.target.checked)}
                        className="h-4 w-4 rounded border-border accent-[var(--brand-primary)]"
                      />
                      <span
                        className={
                          t.is_active
                            ? "text-xs text-[var(--brand-primary)]"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {t.is_active ? "Active" : "Archived"}
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {formatLastEdited(t.updated_at)}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        aria-label={`Actions for ${t.name}`}
                      >
                        <MoreHorizontal size={16} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          render={
                            <Link href={`/settings/contract-templates/${t.id}/edit`} />
                          }
                        >
                          <Pencil size={14} /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(t.id)}>
                          <Copy size={14} /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleArchive(t)}>
                          {t.is_active ? (
                            <>
                              <Archive size={14} /> Archive
                            </>
                          ) : (
                            <>
                              <ArchiveRestore size={14} /> Restore
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDeletePermanently(t)}
                        >
                          <Trash2 size={14} /> Delete permanently
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

      {/* Permanent-delete confirm / block dialog (#76) */}
      <Dialog
        open={deleteDialog !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteDialog(null);
        }}
      >
        <DialogContent>
          {deleteDialog && deleteDialog.blockers.length > 0 ? (
            <>
              <DialogHeader>
                <DialogTitle>Can&apos;t delete this template</DialogTitle>
                <DialogDescription>
                  {deleteDialog.blockers.length} contract
                  {deleteDialog.blockers.length === 1 ? " is" : "s are"} still
                  awaiting signature from a customer. Once they are signed,
                  expired, or voided you can permanently delete &ldquo;
                  {deleteDialog.template.name}&rdquo;.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteDialog(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : deleteDialog ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete template permanently?</DialogTitle>
                <DialogDescription>
                  This permanently removes &ldquo;{deleteDialog.template.name}
                  &rdquo; and its uploaded PDF. This cannot be undone.
                  {deleteDialog.draftCount > 0 ? (
                    <>
                      {" "}
                      {deleteDialog.draftCount} unsent draft contract
                      {deleteDialog.draftCount === 1 ? "" : "s"} built from this
                      template will also be deleted.
                    </>
                  ) : null}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialog(null)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete permanently
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatLastEdited(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (diffMs < day) {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    if (diffMs < 7 * day) {
      return d.toLocaleDateString("en-US", { weekday: "short" });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

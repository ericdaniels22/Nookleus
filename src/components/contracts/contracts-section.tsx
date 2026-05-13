"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileSignature,
  Send,
  Users,
  Loader2,
  MoreHorizontal,
  Eye,
  Download,
  Bell,
  Trash2,
  Ban,
  Pencil,
  Check,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import SendContractModal from "./send-contract-modal";
import SignInPersonModal from "./sign-in-person-modal";
import VoidContractDialog from "./void-contract-dialog";
import DownloadPdfButton from "./download-pdf-button";
import ConfirmDialog from "./confirm-dialog";
import type { ContractListItem, ContractListSigner } from "@/lib/contracts/types";
import { cn } from "@/lib/utils";
import { sanitizePdfFilename } from "@/lib/contracts/pdf-filename";

interface Props {
  jobId: string;
  customerEmail: string | null;
  customerName: string | null;
  onChanged?: () => void;
}

export default function ContractsSection({ jobId, customerEmail, customerName, onChanged }: Props) {
  const [rows, setRows] = useState<ContractListItem[] | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [inPersonOpen, setInPersonOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<ContractListItem | null>(null);
  const [deleteDraftTarget, setDeleteDraftTarget] =
    useState<ContractListItem | null>(null);
  const [permDeleteTarget, setPermDeleteTarget] =
    useState<ContractListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/contracts/by-job/${jobId}`);
    if (res.ok) {
      const data = (await res.json()) as ContractListItem[];
      const now = Date.now();
      const decorated = data.map((r) => {
        if (
          (r.status === "sent" || r.status === "viewed") &&
          r.link_expires_at &&
          new Date(r.link_expires_at).getTime() < now
        ) {
          return { ...r, status: "expired" as const };
        }
        return r;
      });
      setRows(decorated);
    } else {
      toast.error("Failed to load contracts");
      setRows([]);
    }
  }, [jobId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    function onDoc() {
      setMenuId(null);
    }
    if (menuId) document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuId]);

  async function handleRemind(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contracts/${id}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Reminder failed");
      toast.success(`Reminder sent to ${data.sentTo || "signer"}`);
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reminder failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResend(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contracts/${id}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Resend failed");
      toast.success("Signing link re-sent");
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteDraft(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        throw new Error("Session expired — sign in again and retry.");
      }
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success("Draft deleted");
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed", {
        duration: 6000,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handlePermanentlyDelete(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contracts/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        throw new Error("Session expired — sign in again and retry.");
      }
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success("Contract permanently deleted");
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed", {
        duration: 6000,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(id: string) {
    setBusyId(id);
    setMenuId(null);
    try {
      const res = await fetch(`/api/contracts/${id}/restore`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        throw new Error("Session expired — sign in again and retry.");
      }
      if (!res.ok) throw new Error(data.error || "Restore failed");
      toast.success("Contract restored");
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed", {
        duration: 6000,
      });
    } finally {
      setBusyId(null);
    }
  }

  const count = rows?.length ?? 0;

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <FileSignature size={16} />
          Contracts
          {count > 0 && (
            <span className="text-[11px] px-1.5 py-0 rounded-full bg-muted text-muted-foreground font-medium">
              {count}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setInPersonOpen(true)}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-border text-foreground hover:bg-accent transition-colors gap-1.5"
          >
            <Users size={14} />
            Sign In Person
          </button>
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-colors gap-1.5"
          >
            <Send size={14} />
            Send for Signature
          </button>
        </div>
      </div>

      {rows === null ? (
        <div className="text-center py-6 text-muted-foreground text-sm">
          <Loader2 size={16} className="inline animate-spin mr-2" /> Loading contracts…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border/70 rounded-lg">
          No contracts yet. Click <span className="text-foreground font-medium">Send for Signature</span> or <span className="text-foreground font-medium">Sign In Person</span> to create one.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <ContractRow
              key={row.id}
              row={row}
              busy={busyId === row.id}
              menuOpen={menuId === row.id}
              onMenuToggle={() => setMenuId(menuId === row.id ? null : row.id)}
              onClose={() => setMenuId(null)}
              onResend={() => handleResend(row.id)}
              onRemind={() => handleRemind(row.id)}
              onDeleteDraft={() => {
                setDeleteDraftTarget(row);
                setMenuId(null);
              }}
              onVoid={() => {
                setVoidTarget(row);
                setMenuId(null);
              }}
              onRestore={() => handleRestore(row.id)}
              onPermanentlyDelete={() => {
                setPermDeleteTarget(row);
                setMenuId(null);
              }}
            />
          ))}
        </div>
      )}

      <SendContractModal
        open={sendOpen}
        onOpenChange={setSendOpen}
        jobId={jobId}
        defaultSignerName={customerName}
        defaultSignerEmail={customerEmail}
        onSent={async () => {
          await refresh();
          onChanged?.();
        }}
      />

      <SignInPersonModal
        open={inPersonOpen}
        onOpenChange={setInPersonOpen}
        jobId={jobId}
        defaultSignerName={customerName}
        defaultSignerEmail={customerEmail}
      />

      <VoidContractDialog
        contract={voidTarget}
        onClose={() => setVoidTarget(null)}
        onVoided={async () => {
          setVoidTarget(null);
          await refresh();
          onChanged?.();
        }}
      />

      <ConfirmDialog
        open={!!deleteDraftTarget}
        ariaLabel="Delete draft contract"
        title="Delete draft?"
        body="This draft was never sent to a customer. Deleting it removes the row for good."
        onCancel={() => setDeleteDraftTarget(null)}
        onConfirm={async () => {
          const target = deleteDraftTarget;
          setDeleteDraftTarget(null);
          if (target) await handleDeleteDraft(target.id);
        }}
      />

      <ConfirmDialog
        open={!!permDeleteTarget}
        ariaLabel="Permanently delete contract"
        title={
          <>
            <AlertTriangle size={16} className="text-red-400" />
            Permanently delete?
          </>
        }
        body={
          <>
            Are you sure? This will permanently remove{" "}
            <span className="text-foreground font-medium">
              {permDeleteTarget?.title}
            </span>
            , including the signed PDF. This can&apos;t be undone.
          </>
        }
        onCancel={() => setPermDeleteTarget(null)}
        onConfirm={async () => {
          const target = permDeleteTarget;
          setPermDeleteTarget(null);
          if (target) await handlePermanentlyDelete(target.id);
        }}
      />
    </div>
  );
}

// ---------- Row ----------

interface RowProps {
  row: ContractListItem;
  busy: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onClose: () => void;
  onResend: () => void;
  onRemind: () => void;
  onDeleteDraft: () => void;
  onVoid: () => void;
  onRestore: () => void;
  onPermanentlyDelete: () => void;
}

const STATUS_STYLES: Record<ContractListItem["status"], { wrap: string; label: string; text: string }> = {
  signed: {
    wrap: "bg-[rgba(29,158,117,0.10)] border-[rgba(29,158,117,0.30)]",
    label: "Signed",
    text: "text-[#5DCAA5]",
  },
  sent: {
    wrap: "bg-[rgba(239,159,39,0.10)] border-[rgba(239,159,39,0.30)]",
    label: "Sent",
    text: "text-[#FAC775]",
  },
  viewed: {
    wrap: "bg-[rgba(239,159,39,0.10)] border-[rgba(239,159,39,0.30)]",
    label: "Viewed",
    text: "text-[#FAC775]",
  },
  draft: {
    wrap: "bg-muted/30 border-border",
    label: "Draft",
    text: "text-muted-foreground",
  },
  voided: {
    wrap: "bg-muted/20 border-border/60",
    label: "Voided",
    text: "text-muted-foreground",
  },
  expired: {
    wrap: "bg-[rgba(228,75,74,0.08)] border-[rgba(228,75,74,0.30)]",
    label: "Expired",
    text: "text-[#F09595]",
  },
};

function ContractRow({
  row,
  busy,
  menuOpen,
  onMenuToggle,
  onResend,
  onRemind,
  onDeleteDraft,
  onVoid,
  onRestore,
  onPermanentlyDelete,
}: RowProps) {
  const style = STATUS_STYLES[row.status];
  const isVoided = row.status === "voided";
  const isMultiSigner = row.signer_count > 1;

  return (
    <div
      className={cn(
        "border rounded-lg px-4 py-3 flex items-start justify-between gap-3 transition-colors",
        style.wrap,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className={cn(
              "text-sm font-medium",
              isVoided ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {row.title}
          </p>
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0 rounded",
              style.text,
            )}
          >
            {style.label}
          </span>
          {row.reminder_count > 0 && (row.status === "sent" || row.status === "viewed") && (
            <span className="text-[10px] text-muted-foreground">
              · {row.reminder_count} reminder{row.reminder_count === 1 ? "" : "s"} sent
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
          {row.status === "signed" && (
            <div>
              Signed by {row.primary_signer_name || "signer"} ·{" "}
              {row.signed_at && <>{formatDateTime(row.signed_at)}</>}
              {row.primary_signer_ip && (
                <> · {truncateIp(row.primary_signer_ip)}</>
              )}
            </div>
          )}
          {(row.status === "sent" || row.status === "viewed") && (
            <div>
              {row.sent_at && <>Sent {formatDateTime(row.sent_at)}</>}
              {row.first_viewed_at && <> · Opened {formatDateTime(row.first_viewed_at)}</>}
              {row.link_expires_at && (
                <> · Expires {formatDateTime(row.link_expires_at)}</>
              )}
            </div>
          )}
          {isMultiSigner && row.status !== "draft" && (
            <MultiSignerStatus signers={row.signers} />
          )}
          {row.status === "draft" && (
            <div>Draft — send failed or not yet dispatched.</div>
          )}
          {row.status === "voided" && (
            <div>{row.void_reason ? `Voided · ${row.void_reason}` : "Voided"}</div>
          )}
          {row.status === "expired" && (
            <div>Signing link has expired. Resend to issue a new one.</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {row.status === "signed" && row.signed_pdf_path && (
          <DownloadPdfButton
            pdfUrl={`/api/contracts/${row.id}/pdf`}
            filename={`${sanitizePdfFilename(row.title)}.pdf`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Download size={12} /> Download
          </DownloadPdfButton>
        )}
        {row.status === "signed" && (
          <Link
            href={`/contracts/${row.id}/view`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Eye size={12} /> View
          </Link>
        )}
        {row.status === "expired" && (
          <button
            type="button"
            onClick={onResend}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/20 transition-colors"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Resend
          </button>
        )}
        {(row.status === "sent" || row.status === "viewed") && (
          <button
            type="button"
            onClick={onRemind}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />} Remind
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMenuToggle();
            }}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Row actions"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-7 z-20 w-44 rounded-lg border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {row.status === "draft" && (
                <button
                  type="button"
                  onClick={onDeleteDraft}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left text-red-300"
                >
                  <Trash2 size={14} /> Delete draft
                </button>
              )}
              {row.status !== "draft" && row.status !== "voided" && (
                <button
                  type="button"
                  onClick={onVoid}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left text-red-300"
                >
                  <Ban size={14} /> Void contract
                </button>
              )}
              {isVoided && (
                <>
                  <button
                    type="button"
                    onClick={onRestore}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                  <button
                    type="button"
                    onClick={onPermanentlyDelete}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left text-red-300"
                  >
                    <Trash2 size={14} /> Permanently delete
                  </button>
                </>
              )}
              {row.status === "draft" && (
                <button
                  type="button"
                  disabled
                  title="Edit flow lands post-15c"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed"
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MultiSignerStatus({ signers }: { signers: ContractListSigner[] }) {
  if (!signers?.length) return null;
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
      {signers.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1">
          <span className="text-muted-foreground/80">
            Signer {s.signer_order}:
          </span>
          {s.signed_at ? (
            <span className="text-[#5DCAA5] inline-flex items-center gap-0.5">
              <Check size={11} /> Signed {formatDate(s.signed_at)}
            </span>
          ) : (
            <span className="text-[#FAC775]">Awaiting signature</span>
          )}
        </span>
      ))}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function truncateIp(ip: string): string {
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return ip.slice(0, 8) + "…";
}

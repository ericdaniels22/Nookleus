"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Ban, ArrowLeft, CheckCircle, XCircle, Receipt, CreditCard, Send } from "lucide-react";
import { toast } from "sonner";
import { SaveIndicator } from "./save-indicator";
import { ExportPdfButton } from "@/components/export-pdf-modal/button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { BuilderEntity } from "@/lib/types";
import { getStatusBadgeClasses, formatStatusLabel } from "@/lib/estimate-status";

// ─────────────────────────────────────────────────────────────────────────────
// Props — single `entity: BuilderEntity` discriminator (Task 33.5).
// Internally narrowed via `entity.kind`.
// ─────────────────────────────────────────────────────────────────────────────

export interface HeaderBarProps {
  entity: BuilderEntity;
  onTitleChange: (title: string) => void;
  onVoid: (reason: string) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  isVoiding: boolean;
  // New optional callbacks for non-estimate modes
  onSaveTemplate?: () => void;
  onSendPaymentRequest?: () => void;
  onConvertClick?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// VoidDialog — confirm dialog with required reason field
// ─────────────────────────────────────────────────────────────────────────────

function VoidDialog({
  open,
  onOpenChange,
  onConfirm,
  entityLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  entityLabel: string;
}) {
  const [reason, setReason] = useState("");

  // Reset reason when dialog opens
  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  const canConfirm = reason.trim().length > 0;
  const remaining = 500 - reason.length;

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(reason.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Void this {entityLabel}?</DialogTitle>
          <DialogDescription>
            Voiding is irreversible. The {entityLabel} will be marked as voided and
            no further edits will be allowed. Please provide a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Textarea
            autoFocus
            rows={3}
            placeholder="Reason for voiding…"
            value={reason}
            onChange={(e) => {
              if (e.target.value.length <= 500) setReason(e.target.value);
            }}
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onOpenChange(false);
              }
            }}
          />
          <p
            className={`text-xs text-right ${
              remaining <= 50 ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {remaining} characters remaining
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Void {entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeaderBar
// ─────────────────────────────────────────────────────────────────────────────

export function HeaderBar({
  entity,
  onTitleChange,
  onVoid,
  saveStatus,
  lastSavedAt,
  isVoiding,
  onSaveTemplate,
  onSendPaymentRequest,
  onConvertClick,
}: HeaderBarProps) {
  const router = useRouter();

  // Derive entity title: EstimateTemplate uses `name`, everything else uses `title`
  const entityTitle =
    entity.kind === "template" ? entity.data.name : entity.data.title;

  // Derive whether entity is voided (templates have no status)
  const isVoided =
    entity.kind !== "template" && entity.data.status === "voided";

  // ── Title inline-edit state ──────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(entityTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync edit value if title changes from outside
  useEffect(() => {
    if (!isEditing) {
      setEditValue(entityTitle);
    }
  }, [entityTitle, isEditing]);

  // Auto-focus the input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function startEdit() {
    if (isVoided) return;
    setEditValue(entityTitle);
    setIsEditing(true);
  }

  function saveEdit() {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditValue(entityTitle);
    } else if (trimmed !== entityTitle) {
      onTitleChange(trimmed);
    }
    setIsEditing(false);
  }

  function cancelEdit() {
    setEditValue(entityTitle);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  // ── Void dialog state ────────────────────────────────────────────────────
  const [voidOpen, setVoidOpen] = useState(false);

  // ── Status transition ────────────────────────────────────────────────────
  async function transitionStatus(next: string) {
    if (entity.kind === "template") return; // templates have no status workflow
    const base = entity.kind === "invoice" ? "invoices" : "estimates";
    const res = await fetch(`/api/${base}/${entity.data.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, updated_at_snapshot: entity.data.updated_at }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.error("Modified by another user — refresh to see changes.");
        return;
      }
      toast.error((err as { error?: string }).error || `Failed to ${next}`);
      return;
    }
    router.refresh();
  }

  // ── Back link ─────────────────────────────────────────────────────────────
  const backHref =
    entity.kind === "template"
      ? "/settings/estimate-templates"
      : `/jobs/${entity.data.job_id}`;

  // ── Entity number label (estimate_number / invoice_number / none) ─────────
  const entityNumberLabel =
    entity.kind === "estimate"
      ? entity.data.estimate_number
      : entity.kind === "invoice"
      ? entity.data.invoice_number
      : null;

  // ── Status badge ──────────────────────────────────────────────────────────
  const statusBadgeClasses =
    entity.kind !== "template"
      ? getStatusBadgeClasses(entity.kind, entity.data.status)
      : null;
  const statusLabel =
    entity.kind !== "template" ? formatStatusLabel(entity.data.status) : null;

  // ── Void dialog label ─────────────────────────────────────────────────────
  const entityLabel =
    entity.kind === "invoice"
      ? "invoice"
      : entity.kind === "template"
      ? "template"
      : "estimate";

  // ── Action buttons ────────────────────────────────────────────────────────
  function renderActions() {
    if (entity.kind === "template") {
      return (
        <Button
          variant="default"
          size="sm"
          onClick={onSaveTemplate}
          disabled={!onSaveTemplate}
        >
          Save Template
        </Button>
      );
    }

    if (entity.kind === "invoice") {
      const inv = entity.data;
      return (
        <>
          {inv.status === "draft" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("sent")}
            >
              <Send size={14} />
              Mark as Sent
            </Button>
          )}
          {(inv.status === "sent" || inv.status === "partial") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("paid")}
            >
              <CheckCircle size={14} />
              Mark as Paid
            </Button>
          )}
          {inv.status !== "voided" && inv.status !== "paid" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSendPaymentRequest}
              disabled={!onSendPaymentRequest}
            >
              <CreditCard size={14} />
              Send Payment Request
            </Button>
          )}
          {inv.status !== "voided" && inv.status !== "paid" && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isVoiding}
              title={isVoiding ? "Voiding…" : undefined}
              onClick={() => setVoidOpen(true)}
            >
              <Ban size={14} />
              Void
            </Button>
          )}
        </>
      );
    }

    // entity.kind === "estimate"
    const est = entity.data;
    return (
      <>
        {est.status === "draft" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => transitionStatus("sent")}
          >
            <Send size={14} />
            Mark as Sent
          </Button>
        )}
        {est.status === "sent" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("approved")}
            >
              <CheckCircle size={14} />
              Mark Approved
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("rejected")}
            >
              <XCircle size={14} />
              Mark Rejected
            </Button>
          </>
        )}
        {est.status === "approved" && (
          <Button
            variant="outline"
            size="sm"
            onClick={onConvertClick}
            disabled={!onConvertClick}
            title={!onConvertClick ? "Convert flow lands in Task 38" : undefined}
          >
            <Receipt size={14} />
            Convert to Invoice
          </Button>
        )}
        {est.status !== "voided" && est.status !== "converted" && (
          <Button
            variant="destructive"
            size="sm"
            disabled={isVoiding}
            title={isVoiding ? "Voiding…" : undefined}
            onClick={() => setVoidOpen(true)}
          >
            <Ban size={14} />
            Void
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
        {/* ── Left: back link + entity number + status badge ──────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 px-2 py-1 -ml-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={entity.kind === "template" ? "Back to templates" : "Back to job"}
            aria-label={entity.kind === "template" ? "Back to templates" : "Back to job"}
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <FileText size={16} className="text-muted-foreground" />
          {entityNumberLabel && (
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
              {entityNumberLabel}
            </span>
          )}
          {statusBadgeClasses && statusLabel && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClasses}`}
            >
              {statusLabel}
            </span>
          )}
        </div>

        {/* ── Middle: editable title ────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={handleKeyDown}
              className="h-7 text-sm font-semibold"
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className={`w-full text-left text-sm font-semibold truncate px-1 rounded hover:bg-muted/60 transition-colors ${
                isVoided
                  ? "line-through text-muted-foreground cursor-default"
                  : "text-foreground cursor-text"
              }`}
              title={isVoided ? undefined : "Click to edit title"}
            >
              {entityTitle}
            </button>
          )}
        </div>

        {/* ── Right: action buttons + save indicator ────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <SaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} mode={entity.kind} />
          {renderActions()}
          {entity.kind !== "template" && (
            <ExportPdfButton
              documentType={entity.kind}
              documentId={entity.data.id}
              filenameHint={
                entity.kind === "estimate"
                  ? entity.data.estimate_number
                  : entity.data.invoice_number
              }
            />
          )}
        </div>
      </div>

      {/* Void confirmation dialog */}
      <VoidDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        onConfirm={onVoid}
        entityLabel={entityLabel}
      />
    </>
  );
}

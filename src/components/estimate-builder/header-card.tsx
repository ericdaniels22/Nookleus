"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Ban, ArrowLeft, CheckCircle, XCircle, Receipt, Send } from "lucide-react";
import { toast } from "sonner";
import { SaveIndicator } from "./save-indicator";
import { ExportPdfButton } from "@/components/documents/export-pdf-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoidConfirmDialog } from "@/components/void-confirm-dialog";
import type { BuilderEntity } from "@/lib/types";
import { getStatusBadgeClasses, formatStatusLabel } from "@/lib/estimate-status";

// ─────────────────────────────────────────────────────────────────────────────
// HeaderCard (#574) — one compact card consolidating the document's identity
// (back link, number badge, status badge, editable title, save indicator,
// actions, Export PDF) with the mode-branched date/PO fields. Replaces the
// HeaderBar + MetadataBar sibling strips.
// ─────────────────────────────────────────────────────────────────────────────

export interface HeaderCardProps {
  entity: BuilderEntity;
  onTitleChange: (title: string) => void;
  onVoid: (reason: string) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  isVoiding: boolean;
  onIssuedDateChange: (d: string | null) => void;
  onValidUntilChange: (d: string | null) => void;
  onDueDateChange?: (d: string | null) => void;
  onPoNumberChange?: (po: string | null) => void;
  onSaveTemplate?: () => void;
  onConvertClick?: () => void;
}

export function HeaderCard(props: HeaderCardProps) {
  const {
    entity,
    onVoid,
    saveStatus,
    lastSavedAt,
    isVoiding,
    onIssuedDateChange,
    onValidUntilChange,
    onDueDateChange,
    onPoNumberChange,
    onSaveTemplate,
    onConvertClick,
  } = props;

  const router = useRouter();
  const [voidOpen, setVoidOpen] = useState(false);

  const entityTitle =
    entity.kind === "template" ? entity.data.name : entity.data.title;

  const isVoided =
    entity.kind !== "template" && entity.data.status === "voided";

  // ── Title inline-edit state ──────────────────────────────────────────────
  // editValue is only read while editing; startEdit/cancelEdit reseed it from
  // entityTitle, so no sync-from-outside effect is needed.
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(entityTitle);
  const inputRef = useRef<HTMLInputElement>(null);

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
      props.onTitleChange(trimmed);
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

  // Paid invoices lock their metadata fields too (parity with MetadataBar).
  const isFieldsDisabled =
    isVoided || (entity.kind === "invoice" && entity.data.status === "paid");

  const entityNumberLabel =
    entity.kind === "estimate"
      ? entity.data.estimate_number
      : entity.kind === "invoice"
      ? entity.data.invoice_number
      : null;

  const statusBadgeClasses =
    entity.kind !== "template"
      ? getStatusBadgeClasses(entity.kind, entity.data.status)
      : null;
  const statusLabel =
    entity.kind !== "template" ? formatStatusLabel(entity.data.status) : null;

  const backHref =
    entity.kind === "template"
      ? "/settings/estimate-templates"
      : `/jobs/${entity.data.job_id}`;

  const entityLabel =
    entity.kind === "invoice"
      ? "invoice"
      : entity.kind === "template"
      ? "template"
      : "estimate";

  // ── Status transition (badge is read-only; actions drive status) ──────────
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
          {inv.status === "paid" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("sent")}
              title="Revert to Sent (in case this was marked paid by mistake)"
            >
              <XCircle size={14} />
              Unmark Paid
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
        {est.status !== "voided" && est.status !== "converted" && (
          <Button
            variant="outline"
            size="sm"
            onClick={onConvertClick}
            disabled={!onConvertClick}
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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {/* ── Row 1: identity ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
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

      {/* ── Row 2: mode-branched dates ──────────────────────────────────── */}
      {entity.kind === "estimate" && (
        <div className="flex flex-row gap-6">
          <MetaField
            label="Date of issue"
            type="date"
            disabled={isFieldsDisabled}
            value={entity.data.issued_date}
            onChange={onIssuedDateChange}
          />
          <MetaField
            label="Valid until"
            type="date"
            disabled={isFieldsDisabled}
            value={entity.data.valid_until}
            onChange={onValidUntilChange}
          />
        </div>
      )}

      {entity.kind === "invoice" && (
        <div className="flex flex-row gap-6">
          <MetaField
            label="Date of issue"
            type="date"
            disabled={isFieldsDisabled}
            value={entity.data.issued_date}
            onChange={onIssuedDateChange}
          />
          <MetaField
            label="Due date"
            type="date"
            disabled={isFieldsDisabled}
            value={entity.data.due_date}
            onChange={(d) => onDueDateChange?.(d)}
          />
          <MetaField
            label="PO number"
            type="text"
            disabled={isFieldsDisabled}
            value={entity.data.po_number}
            onChange={(po) => onPoNumberChange?.(po)}
          />

          {entity.data.converted_from_estimate_id && (
            <div className="flex flex-col gap-1 text-xs justify-end pb-1">
              <Link
                href={`/estimates/${entity.data.converted_from_estimate_id}`}
                className="text-sm text-blue-600 hover:underline"
              >
                From estimate ↗
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Void confirmation dialog */}
      <VoidConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        onConfirm={onVoid}
        entityLabel={entityLabel}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MetaField — one labeled date/text input in the dates row. Empty input maps
// to null so autosave clears the column instead of writing "".
// ─────────────────────────────────────────────────────────────────────────────

function MetaField({
  label,
  type,
  disabled,
  value,
  onChange,
}: {
  label: string;
  type: "date" | "text";
  disabled: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs min-w-[140px]">
      <span className="uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </span>
      <input
        type={type}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
      />
    </label>
  );
}

"use client";

import type { ReactNode } from "react";

// Shared destructive-confirm modal used by DeleteDraftDialog (#61) and
// PermanentlyDeleteDialog (#63). VoidContractDialog deliberately stays on
// its own chrome — it carries a reason textarea, not a binary confirm.
//
// The dialog is fully controlled: pass `open` to render, supply `onCancel`
// and `onConfirm`. Backdrop click and Cancel both invoke onCancel.

interface Props {
  open: boolean;
  ariaLabel: string;
  title: ReactNode;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  ariaLabel,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted-foreground">{body}</div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-border text-foreground hover:bg-accent transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-red-500/90 text-white hover:bg-red-500 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

// Shared destructive-confirm modal used by DeleteDraftDialog (#61),
// PermanentlyDeleteDialog (#63), and the Estimate Builder's line-item delete
// guard (#631). VoidContractDialog deliberately stays on its own chrome — it
// carries a reason textarea, not a binary confirm.
//
// The dialog is fully controlled: pass `open` to render, supply `onCancel`
// and `onConfirm`. Backdrop click and Cancel both invoke onCancel.
//
// Keyboard + focus contract (#631): when this was layered in front of the touch
// editor — which runs its own window-level Escape-to-close handler — a bare
// modal let Escape fall through and tear down the whole editor instead of just
// the confirm. So the dialog now owns its keyboard: Escape cancels via a
// CAPTURE-phase window listener that stops the event before any surrounding
// handler sees it, focus moves onto Cancel on open and is restored to the opener
// on close, and Tab is trapped between the two actions (aria-modal kept honest).

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
  const overlayRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Read onCancel through a ref so the capture listener binds once per open
  // rather than re-binding on every parent re-render.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    // Remember the opener so focus can return to it when the dialog closes.
    const opener = document.activeElement as HTMLElement | null;

    // Make the rest of the page inert (#746). aria-modal="true" is honored
    // inconsistently by assistive tech, so a virtual cursor could still reach the
    // editor fields and document behind us. Walk from the dialog up to <body>,
    // marking each ancestor's non-ancestor siblings `inert` — which removes them
    // from BOTH the tab order and the a11y tree. Track only what we set so we can
    // restore exactly that on close, leaving any app-set inert in place.
    const inerted: HTMLElement[] = [];
    let node: HTMLElement | null = overlayRef.current;
    while (node && node.parentElement && node !== document.body) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (
          sibling !== node &&
          sibling instanceof HTMLElement &&
          !sibling.hasAttribute("inert")
        ) {
          sibling.setAttribute("inert", "");
          inerted.push(sibling);
        }
      }
      node = node.parentElement;
    }

    // Park focus on the non-destructive action — safest default for a
    // destructive confirm, and it seats focus inside the dialog subtree.
    cancelRef.current?.focus();

    // Escape cancels. Capture-phase + stopPropagation so the event never reaches
    // a surrounding window listener (e.g. the editor panel's own Escape-to-close),
    // which would otherwise close the surface behind us.
    function onEscapeCapture(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onCancelRef.current();
      }
    }
    window.addEventListener("keydown", onEscapeCapture, true);
    return () => {
      window.removeEventListener("keydown", onEscapeCapture, true);
      // Lift inert BEFORE restoring focus: a still-inert opener (or the builder
      // document the Estimate Builder focuses after a delete, #745) cannot take
      // focus in a real browser, so order matters here.
      for (const el of inerted) el.removeAttribute("inert");
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // Keep Tab within the two actions so focus can't wander to the fields behind
  // the aria-modal dialog.
  function onKeyDownTrap(e: ReactKeyboardEvent) {
    if (e.key !== "Tab") return;
    const buttons = overlayRef.current?.querySelectorAll<HTMLElement>("button");
    if (!buttons || buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      onKeyDown={onKeyDownTrap}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted-foreground">{body}</div>
        {/* min-h-[44px]: finger-friendly tap targets for the touch surfaces this
            now backs (the iPad estimate builder), where a destructive mis-tap
            matters most (AC 3). */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 min-h-[44px] border border-border text-foreground hover:bg-accent transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 min-h-[44px] bg-red-500/90 text-white hover:bg-red-500 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

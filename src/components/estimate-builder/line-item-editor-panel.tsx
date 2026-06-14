"use client";

// LineItemEditorPanel (#544) — the editor surface for the currently selected
// line. Holds its own draft state for all seven fields and commits on blur
// through the shared change pathway (`onChange`), so auto-save behaves exactly
// as the inline row does. Renders docked on desktop (slides in from the right)
// and as a slide-up sheet on phone, both via tw-animate-css entrance classes.
// Escape closes it from anywhere (window-level), and on phone a tap-dismiss
// scrim sits behind the sheet. (Built up test-first — fields/behaviors per cycle.)

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import ConfirmDialog from "@/components/contracts/confirm-dialog";
import { MoneyInput } from "./money-input";
import type { BuilderLineItem } from "./line-item-row";
import type { BuilderMode } from "@/lib/types";

// Tailwind's `lg` breakpoint — the document/editor layout switches from a
// stacked phone sheet to a side-by-side desktop dock at 1024px (matching
// BuilderLayout's `lg:flex-row`).
const DESKTOP_QUERY = "(min-width: 1024px)";

// Shared field chrome — a small label above each control and a consistent input
// look. Kept module-level so they aren't rebuilt every render.
const LABEL_CLASS = "text-xs font-medium text-muted-foreground";
const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-default disabled:opacity-60";

// Tracks whether we're at desktop width via matchMedia. The initial value is
// read synchronously during render (lazy initializer) so the panel never
// flashes the wrong variant; an effect-registered listener keeps it current on
// resize/rotate. setState happens only inside the change callback — never
// synchronously in the effect body — so this stays clear of the repo-wide
// set-state-in-effect lint. jsdom/SSR (no matchMedia) falls back to desktop.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DESKTOP_QUERY).matches
      : true,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

export interface LineItemEditorPanelProps {
  /** The selected line being edited. */
  item: BuilderLineItem;
  /** Commit a field change — already bound to this line's id by the parent. */
  onChange: (partial: Partial<BuilderLineItem>) => void;
  /** Close the editor (clears selection). */
  onClose: () => void;
  /**
   * Delete the selected line (#630). Optional — callers that omit it (and the
   * isolated field tests) simply render no delete control. Already bound to this
   * line's id by the parent, which runs the optimistic-remove + persist +
   * rollback + toast pathway. After a successful delete the selection clears as
   * the line leaves the live id set, so the panel unmounts itself.
   */
  onDelete?: () => void;
  /** Voided / read-only entity — fields render disabled. */
  readOnly?: boolean;
  mode?: BuilderMode;
}

export function LineItemEditorPanel({
  item,
  onChange,
  onClose,
  onDelete,
  readOnly = false,
}: LineItemEditorPanelProps) {
  // Each field holds its own draft, seeded from the item, and commits on blur
  // through `onChange` — mirroring the inline row so auto-save behaves the same.
  const [name, setName] = useState(item.name ?? "");
  const [code, setCode] = useState(item.code ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [note, setNote] = useState(item.note ?? "");
  // Unit price lives inside MoneyInput, which owns its draft string. The panel
  // keeps a numeric mirror (fed via onValueChange) so the line total can tick
  // live while the user types — exactly as the inline row does.
  const [unitPriceDraft, setUnitPriceDraft] = useState(item.unit_price);

  // Selecting a different line swaps the panel onto it: reseed every draft when
  // the item id changes. Done during render (React's documented "reset all state
  // when a prop changes" pattern) rather than in an effect — synchronous (no
  // flash of the previous line's values) and clear of the set-state-in-effect
  // lint. Same-id field reconciles from the server are owned by MoneyInput's own
  // resync and are intentionally not clobbered mid-edit here.
  const [prevItemId, setPrevItemId] = useState(item.id);
  if (item.id !== prevItemId) {
    setPrevItemId(item.id);
    setName(item.name ?? "");
    setCode(item.code ?? "");
    setQuantity(String(item.quantity));
    setUnit(item.unit ?? "");
    setDescription(item.description ?? "");
    setNote(item.note ?? "");
    setUnitPriceDraft(item.unit_price);
  }

  const isDesktop = useIsDesktop();

  // #631: the delete button opens a confirmation rather than deleting on the
  // first tap, so an accidental touch can't silently remove work.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Opening the panel (and swapping to another line) drops the cursor into the
  // name field so the user can type immediately — required for the add-line flow
  // where a blank new line is auto-selected. Focus-only, no state, so it doesn't
  // trip the set-state-in-effect lint.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, [item.id]);

  // Escape closes the editor from anywhere — not only while focus is still
  // inside the panel. A single window-level listener (registered once) covers
  // the case where focus has moved to the document or the totals bar. It bows
  // out when the Escape originates inside a modal dialog layered above the panel
  // (e.g. the Add-item dialog) so it never steals that dialog's own Escape.
  // onClose is read through a ref so the listener is bound once, not re-bound on
  // every keystroke re-render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"]')) return;
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Live line total — computed from the local editing values. ──────────────
  const localQty = Number(quantity);
  const liveTotal =
    Number.isFinite(localQty) && Number.isFinite(unitPriceDraft)
      ? localQty * unitPriceDraft
      : item.quantity * item.unit_price;

  // ── Blur commit helpers — mirror the inline row so auto-save is identical. ──

  function commitName() {
    const trimmed = name.trim();
    const next: string | null = trimmed.length > 0 ? trimmed : null;
    if (next !== (item.name ?? null)) {
      onChange({ name: next });
    }
  }

  function commitDescription() {
    const trimmed = description.trim();
    if (!trimmed) {
      // Revert — description is required.
      setDescription(item.description ?? "");
      return;
    }
    if (trimmed !== item.description) {
      onChange({ description: trimmed });
    }
  }

  function commitQuantity() {
    const parsed = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(parsed)) {
      // Revert on empty or NaN.
      setQuantity(String(item.quantity));
      return;
    }
    if (parsed !== item.quantity) {
      onChange({ quantity: parsed });
    }
  }

  function commitCode() {
    const val = code.trim() || null;
    if (val !== item.code) {
      onChange({ code: val });
    }
  }

  function commitUnit() {
    const val = unit.trim() || null;
    if (val !== item.unit) {
      onChange({ unit: val });
    }
  }

  function commitNote() {
    const trimmed = note.trim();
    const next: string | null = trimmed.length > 0 ? trimmed : null;
    if (next !== (item.note ?? null)) {
      onChange({ note: next });
    }
  }

  return (
    <>
      {!isDesktop && (
        // Phone: a tap-to-dismiss scrim behind the slide-up sheet.
        <div
          data-testid="editor-scrim"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0 duration-200"
        />
      )}
      <div
        data-testid="line-item-editor-panel"
        data-variant={isDesktop ? "desktop" : "phone"}
        className={cn(
          "flex flex-col bg-card border-border animate-in fade-in-0 duration-200",
          isDesktop
            ? "sticky top-6 w-full shrink-0 lg:w-[22rem] max-h-[calc(100vh-3rem)] rounded-xl border shadow-sm slide-in-from-right-4"
            : "fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-2xl border-t shadow-2xl slide-in-from-bottom-8",
        )}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Edit line item
          </h2>
          <button
            type="button"
            aria-label="Close editor"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body (scrolls if the fields overflow) ───────────────────────── */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block">
            <span className={LABEL_CLASS}>Item name</span>
            <input
              ref={nameRef}
              data-testid="editor-field-name"
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              className={FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className={LABEL_CLASS}>Description</span>
            <textarea
              data-testid="editor-field-description"
              value={description}
              disabled={readOnly}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitDescription}
              className={cn(FIELD_CLASS, "resize-none")}
            />
          </label>

          <label className="block">
            <span className={LABEL_CLASS}>Note</span>
            <input
              data-testid="editor-field-note"
              value={note}
              disabled={readOnly}
              onChange={(e) => setNote(e.target.value)}
              onBlur={commitNote}
              className={FIELD_CLASS}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={LABEL_CLASS}>Code</span>
              <input
                data-testid="editor-field-code"
                value={code}
                disabled={readOnly}
                onChange={(e) => setCode(e.target.value)}
                onBlur={commitCode}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block">
              <span className={LABEL_CLASS}>Unit</span>
              <input
                data-testid="editor-field-unit"
                value={unit}
                disabled={readOnly}
                onChange={(e) => setUnit(e.target.value)}
                onBlur={commitUnit}
                className={FIELD_CLASS}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={LABEL_CLASS}>Quantity</span>
              <input
                data-testid="editor-field-quantity"
                value={quantity}
                disabled={readOnly}
                onChange={(e) => setQuantity(e.target.value)}
                onBlur={commitQuantity}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block">
              <span className={LABEL_CLASS}>Unit cost</span>
              <div data-testid="editor-field-unit-cost" className="mt-1">
                <MoneyInput
                  value={item.unit_price}
                  readOnly={readOnly}
                  onValueChange={(raw) => setUnitPriceDraft(Number(raw))}
                  onCommit={(n) => {
                    if (n !== item.unit_price) onChange({ unit_price: n });
                  }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
                />
              </div>
            </label>
          </div>

          {/* ── Live line total ───────────────────────────────────────────── */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className={LABEL_CLASS}>Line total</span>
            <span
              data-testid="editor-line-total"
              className="text-base font-semibold tabular-nums text-foreground"
            >
              {formatCurrency(liveTotal)}
            </span>
          </div>
        </div>

        {/* ── Footer: delete (#630) ─────────────────────────────────────────
            A pinned (shrink-0) footer outside the scrollable body so the
            destructive action stays visible in both the desktop dock and the
            phone slide-up sheet. A large, full-width finger target for touch.
            Hidden on read-only entities and when no onDelete is supplied. The
            #631 confirmation guard sits in front: a tap opens the confirm. */}
        {onDelete && !readOnly && (
          <div className="shrink-0 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              <Trash2 size={16} />
              Delete line item
            </button>
          </div>
        )}

        {/* ── Delete confirmation (#631) ──────────────────────────────────
            Rendered INSIDE the panel (not as a detached sibling) so it joins
            the panel's stacking context and paints above it in both the docked
            variant and the z-50 phone slide-up sheet. The fixed-overlay confirm
            still covers the viewport; nesting only governs which layer wins. */}
        <ConfirmDialog
          open={confirmOpen}
          ariaLabel="Delete line item"
          title="Delete line item?"
          body="This removes the line item. This can't be undone."
          confirmLabel="Delete"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onDelete?.();
          }}
        />
      </div>
    </>
  );
}

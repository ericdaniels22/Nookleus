"use client";

// LineItemRow — inline-editable line item with drag handle and live total.
//
// Plan deviation: `parentSectionId: string` added to props (the plan's literal
// interface omitted it, but it is required for dnd-kit sortable registration so
// that handleDragEnd in estimate-builder.tsx can enforce cross-context snap-back).
//
// Inputs commit on blur (spreadsheet pattern — NOT click-to-edit). Total cell
// updates live from local state during editing.

import { useState, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { BuilderMode, EstimateLineItem, InvoiceLineItem } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// LineItemRow only reads { id, description, code, quantity, unit, unit_price }
// — fields name-compatible across both entity-kind line items. The money field
// (estimate.total vs invoice.amount) is computed locally in the row, not read
// off the prop, so the widening is type-only.
export type BuilderLineItem = EstimateLineItem | InvoiceLineItem;

export interface LineItemRowProps {
  item: BuilderLineItem;
  /** Required for dnd-kit — the immediate container's id (section.id or subsection.id). */
  parentSectionId: string;
  onChange: (next: Partial<BuilderLineItem>) => void;
  onDelete: () => void;
  readOnly?: boolean;
  mode?: BuilderMode;
  /**
   * Task 36: optional DOM id for scroll-to-item helpers (broken-refs banner).
   * Format: `line-item-s${sIdx}-i${iIdx}` or `line-item-s${sIdx}-i${iIdx}-sub${subIdx}`.
   * Constructed by parents (section-card / subsection-card) which know the indices.
   */
  domId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LineItemRow
// ─────────────────────────────────────────────────────────────────────────────

export function LineItemRow({
  item,
  parentSectionId,
  onChange,
  onDelete,
  readOnly = false,
  mode = "estimate",
  domId,
}: LineItemRowProps) {
  // ── dnd-kit sortable ──────────────────────────────────────────────────────
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { type: "line-item", parentSectionId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // ── Local editing state ───────────────────────────────────────────────────
  // Strings for controlled inputs; numbers parsed on blur.
  const [name, setName] = useState(item.name ?? "");
  const [description, setDescription] = useState(item.description);
  const [code, setCode] = useState(item.code ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? "");
  const [unitPrice, setUnitPrice] = useState(String(item.unit_price));

  // Sync from props when item changes from outside (e.g. server reconcile)
  useEffect(() => {
    setName(item.name ?? "");
    setDescription(item.description);
    setCode(item.code ?? "");
    setQuantity(String(item.quantity));
    setUnit(item.unit ?? "");
    setUnitPrice(String(item.unit_price));
  }, [item.name, item.description, item.code, item.quantity, item.unit, item.unit_price]);

  // ── Live total (uses local editing values) ────────────────────────────────
  const localQty = Number(quantity);
  const localUnitPrice = Number(unitPrice);
  const liveTotal =
    Number.isFinite(localQty) && Number.isFinite(localUnitPrice)
      ? localQty * localUnitPrice
      : item.quantity * item.unit_price;

  // ── Blur commit helpers ───────────────────────────────────────────────────

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
      // Revert — description is required
      setDescription(item.description);
      return;
    }
    if (trimmed !== item.description) {
      onChange({ description: trimmed });
    }
  }

  function commitCode() {
    // Empty string → null (nullable in schema)
    const val = code.trim() || null;
    if (val !== item.code) {
      onChange({ code: val });
    }
  }

  function commitQuantity() {
    const parsed = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(parsed)) {
      // Revert on empty or NaN
      setQuantity(String(item.quantity));
      return;
    }
    if (parsed !== item.quantity) {
      onChange({ quantity: parsed });
    }
  }

  function commitUnit() {
    // Empty string → null (nullable in schema)
    const val = unit.trim() || null;
    if (val !== item.unit) {
      onChange({ unit: val });
    }
  }

  function commitUnitPrice() {
    const parsed = Number(unitPrice);
    if (!unitPrice.trim() || !Number.isFinite(parsed)) {
      // Revert on empty or NaN
      setUnitPrice(String(item.unit_price));
      return;
    }
    if (parsed !== item.unit_price) {
      onChange({ unit_price: parsed });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={setNodeRef}
      id={domId}
      style={style}
      className={cn(
        "group flex items-start gap-1 px-2 py-1.5 rounded-md border border-border bg-card text-sm",
        isDragging && "ring-2 ring-primary/30 shadow-md",
        readOnly && "opacity-75"
      )}
    >
      {/* Drag handle */}
      {!readOnly && (
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          <GripVertical size={14} />
        </button>
      )}
      {/* Spacer when readOnly to keep alignment consistent */}
      {readOnly && <span className="w-5 shrink-0" />}

      {/* Stacked name + description column */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <input
          type="text"
          value={name}
          maxLength={200}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Item name"
          className={cn(
            "w-full bg-transparent border-0 outline-none ring-0 font-semibold text-sm text-foreground placeholder:text-muted-foreground/60",
            "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
            "disabled:cursor-default disabled:opacity-60"
          )}
        />
        <input
          type="text"
          value={description}
          maxLength={2000}
          disabled={readOnly}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Description"
          className={cn(
            "w-full bg-transparent border-0 outline-none ring-0 text-sm text-muted-foreground placeholder:text-muted-foreground/50",
            "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
            "disabled:cursor-default disabled:opacity-60"
          )}
        />
      </div>

      {/* Code */}
      <input
        type="text"
        value={code}
        disabled={readOnly}
        onChange={(e) => setCode(e.target.value)}
        onBlur={commitCode}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Code"
        className={cn(
          "w-20 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-muted-foreground placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      {/* Quantity */}
      <input
        type="number"
        value={quantity}
        disabled={readOnly}
        onChange={(e) => setQuantity(e.target.value)}
        onBlur={commitQuantity}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Qty"
        className={cn(
          "w-16 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-foreground tabular-nums text-right placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      {/* Unit */}
      <input
        type="text"
        value={unit}
        disabled={readOnly}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={commitUnit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Unit"
        className={cn(
          "w-14 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-muted-foreground placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      {/* Unit price */}
      <input
        type="number"
        value={unitPrice}
        disabled={readOnly}
        onChange={(e) => setUnitPrice(e.target.value)}
        onBlur={commitUnitPrice}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="0.00"
        className={cn(
          "w-24 shrink-0 mt-0.5 bg-transparent border-0 outline-none ring-0 text-sm text-foreground tabular-nums text-right placeholder:text-muted-foreground/50",
          "focus:bg-muted/40 focus:rounded px-1 py-0.5 transition-colors",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          "disabled:cursor-default disabled:opacity-60"
        )}
      />

      {/* Live total — read-only, computed from local editing values */}
      <span className="w-24 shrink-0 mt-0.5 text-right font-mono tabular-nums text-sm text-foreground">
        {formatCurrency(liveTotal)}
      </span>

      {/* Delete button */}
      {!readOnly ? (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 mt-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
          aria-label="Delete line item"
        >
          <Trash2 size={13} />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
    </div>
  );
}

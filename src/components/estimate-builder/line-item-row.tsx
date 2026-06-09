"use client";

// LineItemRow — read-only display of a line item with a drag handle (#546).
//
// As of #546 rows are select-only: clicking a row opens the editor panel
// (see line-item-editor-panel.tsx) where every field is edited. The row no
// longer renders inline inputs — name, description, note, code, quantity,
// unit, unit price and total all render as static text.
//
// Plan deviation: `parentSectionId: string` added to props (the plan's literal
// interface omitted it, but it is required for dnd-kit sortable registration so
// that handleDragEnd in estimate-builder.tsx can enforce cross-context snap-back).

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
  /**
   * Retained for caller compatibility but no longer consumed: as of #546 the
   * row is display-only and all edits flow through the editor panel. Callers
   * still pass it harmlessly.
   */
  onChange?: (next: Partial<BuilderLineItem>) => void;
  onDelete: () => void;
  readOnly?: boolean;
  /** Retained for caller compatibility; no longer consumed by the row (#546). */
  mode?: BuilderMode;
  /**
   * Optional DOM id for scroll-to-item helpers.
   * Format: `line-item-s${sIdx}-i${iIdx}` or `line-item-s${sIdx}-i${iIdx}-sub${subIdx}`.
   * Constructed by parents which know the indices.
   */
  domId?: string;
  /** #544: whether this row is the line currently open in the editor panel. */
  selected?: boolean;
  /** #544: select this row (opens the editor panel on it). */
  onSelect?: () => void;
  /**
   * #568: derived positional number for this row (e.g. "2.3.1" for a subsection
   * item, "2.3" for a Section's direct item). A read-model projection computed
   * by numberSectionTree — never persisted. Omitted → no number is shown.
   */
  number?: string;
  /** #573: row checkbox affordance. Rendered only when onCheckedChange is given. */
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// LineItemRow
// ─────────────────────────────────────────────────────────────────────────────

export function LineItemRow({
  item,
  parentSectionId,
  onDelete,
  readOnly = false,
  domId,
  selected = false,
  onSelect,
  number,
  checked = false,
  onCheckedChange,
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

  // ── Line total — read-only, derived straight from props (#546). ────────────
  const lineTotal = item.quantity * item.unit_price;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={setNodeRef}
      id={domId}
      data-testid="line-item-row"
      data-selected={selected ? "true" : undefined}
      onClick={(e) => {
        // Clicking anywhere on the row selects it (opens the editor panel).
        // Stop here so the bubbling click doesn't reach the document
        // background handler, which clears the selection.
        if (onSelect) {
          e.stopPropagation();
          onSelect();
        }
      }}
      style={style}
      className={cn(
        "group flex items-start gap-1 px-2 py-1.5 rounded-md border border-border bg-card text-sm",
        "transition-shadow cursor-pointer",
        selected && "border-primary ring-2 ring-primary/50",
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

      {/* Row checkbox (#573) — checking is not selecting, so the click must
          not bubble to the row's select handler. */}
      {onCheckedChange && (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 shrink-0 size-3.5 accent-primary cursor-pointer"
          aria-label={`Select ${item.name}`}
        />
      )}

      {/* Derived positional number (#568) — read-model, never persisted. */}
      {number && (
        <span className="w-12 shrink-0 mt-0.5 px-1 py-0.5 text-xs font-mono tabular-nums text-muted-foreground">
          {number}
        </span>
      )}

      {/* Stacked name + description column */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="px-1 py-0.5 font-semibold text-sm text-foreground">
          {item.name}
        </span>
        <span className="px-1 py-0.5 text-sm text-muted-foreground">
          {item.description}
        </span>
        {/* Optional note — italic sub-line tucked under the item (#382).
            Display-only since #546; editing happens in the editor panel. */}
        {item.note && (
          <span className="px-1 py-0.5 text-xs italic text-muted-foreground">
            {item.note}
          </span>
        )}
      </div>

      {/* Code */}
      <span className="w-20 shrink-0 mt-0.5 px-1 py-0.5 text-sm text-muted-foreground">
        {item.code}
      </span>

      {/* Quantity */}
      <span className="w-16 shrink-0 mt-0.5 px-1 py-0.5 text-sm text-foreground tabular-nums text-right">
        {item.quantity}
      </span>

      {/* Unit */}
      <span className="w-14 shrink-0 mt-0.5 px-1 py-0.5 text-sm text-muted-foreground">
        {item.unit}
      </span>

      {/* Unit price — static currency since #546 (editing lives in the panel). */}
      <span className="w-24 shrink-0 mt-0.5 px-1 py-0.5 text-right font-mono tabular-nums text-sm text-foreground">
        {formatCurrency(item.unit_price)}
      </span>

      {/* Line total — read-only, derived from quantity × unit price. */}
      <span className="w-24 shrink-0 mt-0.5 text-right font-mono tabular-nums text-sm text-foreground">
        {formatCurrency(lineTotal)}
      </span>

      {/* Delete button */}
      {!readOnly ? (
        <button
          onClick={(e) => {
            // Don't let the delete bubble to the row's select handler — deleting
            // a non-selected line must not first select it (#544).
            e.stopPropagation();
            onDelete();
          }}
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

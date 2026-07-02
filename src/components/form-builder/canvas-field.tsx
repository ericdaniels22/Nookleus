"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Eye, EyeOff, Copy, Trash2, Lock, FileText, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/types";
import { useFieldUsage } from "./usage-context";

export function CanvasField({
  field,
  selected,
  onSelect,
  onToggleRequired,
  onToggleVisibility,
  onHide,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  selected: boolean;
  onSelect: () => void;
  onToggleRequired: () => void;
  onToggleVisibility: () => void;
  onHide: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const slug = field.merge_field_slug ?? field.id;
  const usage = useFieldUsage(slug);
  const usageCount = usage.length;
  const [showUsageList, setShowUsageList] = useState(false);
  const [showDeleteBlock, setShowDeleteBlock] = useState(false);
  const isVisible = field.visible !== false;

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (usageCount > 0) {
      setShowDeleteBlock(true);
      return;
    }
    onDelete();
  }
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id, data: { type: "field", fieldId: field.id } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : field.visible === false ? 0.5 : 1,
  };

  const isDefault = !!field.is_default;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-lg border bg-card px-3 py-2.5 cursor-pointer transition-colors",
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-primary/50"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <label className="text-sm font-medium text-foreground">{field.label}</label>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleRequired();
              }}
              className={cn(
                "text-[11px] font-medium px-1.5 py-0.5 rounded transition-colors",
                field.required
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground/60 opacity-0 group-hover:opacity-100"
              )}
              title={field.required ? "Required (click to make optional)" : "Optional (click to require)"}
            >
              {field.required ? "Required" : "Optional"}
            </button>
            {isDefault && <Lock size={10} className="text-muted-foreground/40" />}
            {usageCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowUsageList((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-accent-tint text-accent-text hover:bg-primary/20 transition-colors"
                title={`Used by ${usageCount} contract template${usageCount === 1 ? "" : "s"}`}
              >
                <FileText size={10} />
                Used by {usageCount}
              </button>
            )}
          </div>
          <FieldPreview field={field} />
          {field.help_text && (
            <p className="text-[11px] text-muted-foreground mt-1">{field.help_text}</p>
          )}
          {showUsageList && usageCount > 0 && (
            <ul
              onClick={(e) => e.stopPropagation()}
              className="mt-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] space-y-0.5"
            >
              {usage.map((t) => (
                <li key={t.id} className="text-foreground">
                  {t.name}
                  {!t.is_active && (
                    <span className="ml-1 text-muted-foreground italic">(inactive)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={field.visible === false ? "Show field" : "Hide field"}
          >
            {field.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Duplicate field"
          >
            <Copy size={13} />
          </button>
          {!isDefault && (
            <button
              onClick={handleDeleteClick}
              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              aria-label="Delete field"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {showDeleteBlock && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => {
            e.stopPropagation();
            setShowDeleteBlock(false);
          }}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle size={20} className="text-destructive shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  Can&apos;t delete &quot;{field.label}&quot;
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  This field is referenced by {usageCount} contract template
                  {usageCount === 1 ? "" : "s"}. Deleting it would break the
                  merge field on those templates.
                </p>
              </div>
            </div>
            <ul className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs space-y-1 max-h-40 overflow-y-auto mb-4">
              {usage.map((t) => (
                <li key={t.id} className="text-foreground">
                  {t.name}
                  {!t.is_active && (
                    <span className="ml-1 text-muted-foreground italic">(inactive)</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mb-3">
              Either remove this merge field from the templates above first, or
              hide the field instead. Hidden fields stay in the registry so
              existing contracts keep resolving.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteBlock(false)}
                className="px-3 h-9 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              {isVisible && (
                <button
                  onClick={() => {
                    onHide();
                    setShowDeleteBlock(false);
                  }}
                  className="px-3 h-9 rounded-lg text-sm font-medium border border-input bg-transparent text-text-secondary hover:bg-muted hover:text-foreground transition-all"
                >
                  Hide instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldPreview({ field }: { field: FormField }) {
  const baseInput =
    "w-full h-8 rounded-md border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground pointer-events-none";

  switch (field.type) {
    case "textarea":
      return (
        <div className={cn(baseInput, "h-14 py-1.5")}>
          {field.placeholder || "Long text"}
        </div>
      );
    case "select":
      return (
        <div className={cn(baseInput, "flex items-center justify-between")}>
          <span>{field.placeholder || "Select…"}</span>
          <span>▾</span>
        </div>
      );
    case "pill":
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).slice(0, 4).map((opt) => {
            const colored = !!(opt.bg_color || opt.text_color);
            return (
              <span
                key={opt.value}
                style={colored ? { backgroundColor: opt.bg_color, color: opt.text_color } : undefined}
                className={cn(
                  "text-[11px] px-2 py-1 rounded-full",
                  !colored && "bg-muted text-muted-foreground"
                )}
              >
                {opt.label}
              </span>
            );
          })}
          {(field.options?.length ?? 0) === 0 && (
            <span className="text-[11px] text-muted-foreground italic">No options yet</span>
          )}
        </div>
      );
    case "checkbox":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-3.5 h-3.5 rounded border border-border bg-muted/30" />
          <span>{field.placeholder || "Checkbox"}</span>
        </div>
      );
    case "date":
      return <div className={baseInput}>MM/DD/YYYY</div>;
    case "number":
      return <div className={baseInput}>{field.placeholder || "0"}</div>;
    case "phone":
      return <div className={baseInput}>{field.placeholder || "(555) 123-4567"}</div>;
    case "email":
      return <div className={baseInput}>{field.placeholder || "name@example.com"}</div>;
    default:
      return <div className={baseInput}>{field.placeholder || "Text"}</div>;
  }
}

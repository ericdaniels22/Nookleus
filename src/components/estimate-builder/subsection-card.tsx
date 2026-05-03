"use client";

// SubsectionCard — one-level deep, no recursive subsections.
// Mirrors SectionCard but:
//  • kebab menu has no "Add subsection" option
//  • internal SortableContext covers items only (no nested SubsectionCards)
//  • useSortable data carries type: "subsection" + parent_section_id so the
//    parent's drag-end handler can enforce cross-section snap-back.
//
// Plan deviation note: onRename / onDelete signatures unchanged from spec.
// onAddLineItem is `(sectionId: string) => void` — subsection passes its own id.

import { useState } from "react";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  MoreVertical,
  Trash2,
  Plus,
  Pencil,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LineItemRow, type BuilderLineItem } from "./line-item-row";
import type { BuilderMode, EstimateSection, InvoiceSection } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SubsectionCardProps {
  subsection:
    | (EstimateSection & { items: BuilderLineItem[] })
    | (InvoiceSection & { items: BuilderLineItem[] });
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onAddLineItem: (sectionId: string) => void;
  onLineItemDelete: (id: string) => void;
  /** Task 25: called when an inline cell is committed; parent updates local state. */
  onLineItemChange: (itemId: string, partial: Partial<BuilderLineItem>) => void;
  /** Task 25: when true, hides editing controls (voided estimate). */
  readOnly?: boolean;
  mode?: BuilderMode;
  /** Task 36: parent section index in the entity tree; used to build DOM ids for scroll-to-item. */
  sectionIdx?: number;
  /** Task 36: this subsection's index in the parent section's subsections array. */
  subsectionIdx?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DeleteSubsectionDialog
// ─────────────────────────────────────────────────────────────────────────────

function DeleteSubsectionDialog({
  open,
  onOpenChange,
  subsectionTitle,
  itemCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subsectionTitle: string;
  itemCount: number;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Delete subsection?</DialogTitle>
          <DialogDescription>
            &ldquo;{subsectionTitle}&rdquo; contains{" "}
            <strong>{itemCount}</strong>{" "}
            {itemCount === 1 ? "item" : "items"}. This will permanently delete
            the subsection and all its line items.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SubsectionCard
// ─────────────────────────────────────────────────────────────────────────────

export function SubsectionCard({
  subsection,
  onRename,
  onDelete,
  onAddLineItem,
  onLineItemDelete,
  onLineItemChange,
  readOnly = false,
  mode = "estimate",
  sectionIdx,
  subsectionIdx,
}: SubsectionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: subsection.id,
    data: {
      type: "subsection",
      // Carried in data so the parent's onDragEnd can detect cross-section drags
      // and snap back: if over.data.current?.parentSectionId !== active.data.current?.parentSectionId
      // → cancel the move.
      parentSectionId: subsection.parent_section_id,
    },
  });

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(subsection.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // ── Inline title edit ────────────────────────────────────────────────────

  function startEditing() {
    setDraftTitle(subsection.title);
    setEditingTitle(true);
  }

  function commitTitle() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== subsection.title) {
      onRename(subsection.id, trimmed);
    } else {
      setDraftTitle(subsection.title);
    }
    setEditingTitle(false);
  }

  // ── Sort items by sort_order ─────────────────────────────────────────────

  const sortedItems = [...subsection.items].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group rounded-lg border border-border bg-card/50 overflow-hidden ml-6",
        isDragging && "ring-2 ring-primary/30 shadow-lg"
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
        {!readOnly && (
          <button
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            aria-label="Drag subsection to reorder"
          >
            <GripVertical size={14} />
          </button>
        )}

        {!readOnly && editingTitle ? (
          <Input
            autoFocus
            value={draftTitle}
            maxLength={200}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setDraftTitle(subsection.title);
                setEditingTitle(false);
              }
            }}
            className="h-6 text-xs font-medium flex-1"
          />
        ) : readOnly ? (
          <div className="flex-1 text-left">
            <span className="text-xs font-medium text-foreground">
              {subsection.title}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {subsection.items.length} item{subsection.items.length !== 1 ? "s" : ""}
            </span>
          </div>
        ) : (
          <button
            onClick={startEditing}
            className="flex-1 text-left"
          >
            <span className="text-xs font-medium text-foreground">
              {subsection.title}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {subsection.items.length} item{subsection.items.length !== 1 ? "s" : ""}
            </span>
          </button>
        )}

        {/* Collapse toggle — always visible */}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          aria-label={isCollapsed ? "Expand subsection" : "Collapse subsection"}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        {/* Kebab menu — no "Add subsection" (one-level rule). Hidden when readOnly. */}
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Subsection actions"
            >
              <MoreVertical size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem onClick={startEditing}>
                <Pencil size={13} />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={13} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {/* ── Items list — hidden when collapsed ──────────────────────────── */}
      {!isCollapsed && (
      <div className="p-2 space-y-1">
        {/* SortableContext for this subsection's items — cross-subsection drags
            snap back because items in other subsections are in a different context. */}
        <SortableContext
          items={sortedItems.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {sortedItems.map((item, iIdx) => (
            <LineItemRow
              key={item.id}
              item={item}
              parentSectionId={subsection.id}
              onChange={(partial) => onLineItemChange(item.id, partial)}
              onDelete={() => onLineItemDelete(item.id)}
              readOnly={readOnly}
              mode={mode}
              domId={
                sectionIdx !== undefined && subsectionIdx !== undefined
                  ? `line-item-s${sectionIdx}-i${iIdx}-sub${subsectionIdx}`
                  : undefined
              }
            />
          ))}
        </SortableContext>

        {sortedItems.length === 0 && (
          <p className="text-xs text-muted-foreground italic px-2 py-1">
            No items yet.
          </p>
        )}
      </div>
      )}

      {/* ── Footer — hidden when readOnly OR collapsed ────────────────────── */}
      {!readOnly && !isCollapsed && (
        <div className="px-2 pb-2">
          <button
            onClick={() => {
              // TODO Task 26: replace with AddItemDialog
              onAddLineItem(subsection.id);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 w-full rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
          >
            <Plus size={12} />
            Add item
          </button>
        </div>
      )}

      {/* ── Delete confirmation dialog ───────────────────────────────────── */}
      <DeleteSubsectionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        subsectionTitle={subsection.title}
        itemCount={subsection.items.length}
        onConfirm={() => onDelete(subsection.id)}
      />
    </li>
  );
}

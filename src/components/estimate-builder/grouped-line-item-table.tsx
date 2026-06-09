"use client";

// GroupedLineItemTable (#573) — one continuous grouped table that replaces the
// per-section card stack. Sections and subsections are header rows inside the
// single table; line items render via LineItemRow (select-only). Numbering is
// derived from the positional-numbering module (#568) — a read-model recomputed
// every render, never persisted.
//
// dnd contracts carried over from the card era (handleDragEnd in
// estimate-builder.tsx depends on them):
//   • section headers   → useSortable data { type: "section" }
//   • subsection headers → data { type: "subsection", parentSectionId }
//   • line items (via LineItemRow) → data { type: "line-item", parentSectionId }
// SortableContexts are scoped per container — one for the section list, one per
// section's subsections, one per container's items — so cross-container drags
// snap back exactly as before.

import { useState } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronUp,
  FolderPlus,
  GripVertical,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildNumberIndex } from "./number-section-tree";
import { resolveLineItemDropTarget } from "./move-line-item";
import { LineItemRow, type BuilderLineItem } from "./line-item-row";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { sumLineItemsFromSections } from "@/lib/estimates-calc";
import type { EstimateSection, InvoiceSection } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GroupedSubsection =
  | (EstimateSection & { items: BuilderLineItem[] })
  | (InvoiceSection & { items: BuilderLineItem[] });

export type GroupedSection = GroupedSubsection & {
  subsections: GroupedSubsection[];
};

export interface GroupedLineItemTableProps {
  sections: GroupedSection[];
  /** Select-only rows: clicking a row reports its id; the side editor owns edits. */
  onSelectLineItem?: (id: string) => void;
  selectedLineItemId?: string | null;
  /** Row delete button → delete the line item (persistence is the caller's). */
  onDeleteLineItem?: (id: string) => void;
  /**
   * "+ Add" menu: open the add-item dialog for the given container on the
   * given tab. The table targets the LAST section — the predictable end of
   * the document.
   */
  onAddLineItem?: (sectionId: string, initialTab: "library" | "custom") => void;
  /** "+ Add" menu: create a new top-level section with the given title. */
  onAddSection?: (title: string) => void;
  /** Section kebab → Rename: inline title edit committed as (id, newTitle). */
  onRenameSection?: (id: string, title: string) => void;
  /** Section kebab → Add subsection: dialog-collected title, one-level nesting only. */
  onAddSubsection?: (parentId: string, title: string) => void;
  /** Section kebab → Delete: confirmed via a dialog spelling out the contents. */
  onDeleteSection?: (id: string) => void;
  /** Subsection kebab → Rename: inline title edit committed as (id, newTitle). */
  onRenameSubsection?: (id: string, title: string) => void;
  /** Subsection kebab → Delete: confirmed via a dialog naming the item count. */
  onDeleteSubsection?: (id: string) => void;
  /**
   * Voided/locked documents: hides every editing affordance (drag handles,
   * kebabs, checkboxes, row deletes, "+ Add"). Collapse stays available.
   */
  readOnly?: boolean;
}

function bySortOrder<T extends { sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

// Per-row callbacks shared by both item lists, threaded down from the table.
interface RowWiring {
  numbering: ReadonlyMap<string, string>;
  selectedLineItemId?: string | null;
  onSelectLineItem?: (id: string) => void;
  onDeleteLineItem?: (id: string) => void;
  checkedIds: ReadonlySet<string>;
  setItemChecked: (id: string, checked: boolean) => void;
  readOnly: boolean;
}

function ItemRows({
  items,
  parentSectionId,
  wiring,
}: {
  items: BuilderLineItem[];
  parentSectionId: string;
  wiring: RowWiring;
}) {
  const sorted = bySortOrder(items);
  return (
    <SortableContext
      items={sorted.map((i) => i.id)}
      strategy={verticalListSortingStrategy}
    >
      <div>
        {sorted.map((item) => (
          <LineItemRow
            key={item.id}
            item={item}
            parentSectionId={parentSectionId}
            onDelete={() => wiring.onDeleteLineItem?.(item.id)}
            readOnly={wiring.readOnly}
            number={wiring.numbering.get(item.id)}
            selected={item.id === wiring.selectedLineItemId}
            onSelect={
              wiring.onSelectLineItem
                ? () => wiring.onSelectLineItem!(item.id)
                : undefined
            }
            checked={wiring.checkedIds.has(item.id)}
            onCheckedChange={
              wiring.readOnly
                ? undefined
                : (c) => wiring.setItemChecked(item.id, c)
            }
          />
        ))}
      </div>
    </SortableContext>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddSubsectionDialog — collects a title then calls onConfirm(title).
// Carried over from the card era so onAddSubsection(parentId, title) keeps
// arriving in one shot.
// ─────────────────────────────────────────────────────────────────────────────

function AddSubsectionDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (title: string) => void;
}) {
  const [title, setTitle] = useState("");

  function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    setTitle("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTitle("");
        onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Add subsection</DialogTitle>
          <DialogDescription>
            Enter a name for the new subsection.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={title}
          maxLength={200}
          placeholder="Subsection name"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onOpenChange(false);
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            Add subsection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DeleteSectionDialog — confirms with the section's contents spelled out.
// Carried over from the card era verbatim.
// ─────────────────────────────────────────────────────────────────────────────

function DeleteSectionDialog({
  open,
  onOpenChange,
  sectionTitle,
  directItemCount,
  subsectionCount,
  subsectionItemCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sectionTitle: string;
  directItemCount: number;
  subsectionCount: number;
  subsectionItemCount: number;
  onConfirm: () => void;
}) {
  const totalItems = directItemCount + subsectionItemCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Delete section?</DialogTitle>
          <DialogDescription>
            &ldquo;{sectionTitle}&rdquo; contains{" "}
            <strong>{totalItems}</strong>{" "}
            {totalItems === 1 ? "item" : "items"}
            {subsectionCount > 0 && (
              <>
                {" "}across{" "}
                <strong>{subsectionCount}</strong>{" "}
                {subsectionCount === 1 ? "subsection" : "subsections"}
              </>
            )}
            . This will permanently delete the section and all its contents.
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
// DeleteSubsectionDialog — confirms with the subsection's item count.
// Carried over from the card era verbatim.
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
// SubsectionGroup — header row + its item rows
// ─────────────────────────────────────────────────────────────────────────────

function SubsectionGroup({
  subsection,
  collapsed,
  onToggleCollapsed,
  onRename,
  onDelete,
  wiring,
}: {
  subsection: GroupedSubsection;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  wiring: RowWiring;
}) {
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
      // parentSectionId lets the parent's onDragEnd detect cross-section drags
      // and snap back, exactly as the card-era SubsectionCard did.
      type: "subsection",
      parentSectionId: subsection.parent_section_id,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Inline title edit, entered via the kebab's Rename.
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(subsection.title);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function startEditing() {
    setDraftTitle(subsection.title);
    setEditingTitle(true);
  }

  function commitTitle() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== subsection.title) {
      onRename?.(subsection.id, trimmed);
    } else {
      setDraftTitle(subsection.title);
    }
    setEditingTitle(false);
  }

  return (
    <li ref={setNodeRef} style={style}>
      <div className="group/subheader flex items-center gap-2 px-4 py-2 bg-muted/10 border-t border-border">
        {!wiring.readOnly && (
          <button
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover/subheader:opacity-100 transition-opacity p-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Drag subsection to reorder"
            tabIndex={-1}
          >
            <GripVertical size={14} />
          </button>
        )}
        <span className="shrink-0 text-xs font-mono tabular-nums text-muted-foreground">
          {wiring.numbering.get(subsection.id)}
        </span>
        {editingTitle ? (
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
            className="h-6 text-xs font-medium w-56"
          />
        ) : (
          <span className="text-xs font-medium text-foreground">
            {subsection.title}
          </span>
        )}
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {entryCountLabel(subsection.items.length)}
        </span>
        {/* Collapsed → surface the subsection's $ total on the header, since
            the line totals it sums are hidden (#591). */}
        {collapsed && (
          <span className="ml-auto shrink-0 font-mono tabular-nums text-xs text-foreground">
            {formatCurrency(
              sumLineItemsFromSections([
                { items: subsection.items, subsections: [] },
              ]),
            )}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            "p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0",
            !collapsed && "ml-auto",
          )}
          aria-label={collapsed ? "Expand subsection" : "Collapse subsection"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        {/* Kebab — no "Add subsection" here (one-level nesting rule). */}
        {!wiring.readOnly && (onRename || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="opacity-0 group-hover/subheader:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
              aria-label="Subsection actions"
            >
              <MoreVertical size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              {onRename && (
                <DropdownMenuItem onClick={startEditing}>
                  <Pencil size={13} />
                  Rename
                </DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 size={13} />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {onDelete && (
        <DeleteSubsectionDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          subsectionTitle={subsection.title}
          itemCount={subsection.items.length}
          onConfirm={() => onDelete(subsection.id)}
        />
      )}
      {!collapsed && (
        <>
          <ItemRows
            items={subsection.items}
            parentSectionId={subsection.id}
            wiring={wiring}
          />
          {subsection.items.length === 0 && (
            // Exactly the card-era copy — the drag-end suites getByText it.
            <p className="px-4 py-1.5 text-xs text-muted-foreground italic">
              No items yet.
            </p>
          )}
        </>
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionGroup — header row + subsection groups + direct item rows
// ─────────────────────────────────────────────────────────────────────────────

function SectionGroup({
  section,
  collapsedIds,
  onToggleCollapsed,
  onRename,
  onAddSubsection,
  onDelete,
  onRenameSubsection,
  onDeleteSubsection,
  wiring,
}: {
  section: GroupedSection;
  collapsedIds: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onAddSubsection?: (parentId: string, title: string) => void;
  onDelete?: (id: string) => void;
  onRenameSubsection?: (id: string, title: string) => void;
  onDeleteSubsection?: (id: string) => void;
  wiring: RowWiring;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: section.id,
    data: { type: "section" },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Inline title edit, entered via the kebab's Rename.
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(section.title);
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function startEditing() {
    setDraftTitle(section.title);
    setEditingTitle(true);
  }

  function commitTitle() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== section.title) {
      onRename?.(section.id, trimmed);
    } else {
      setDraftTitle(section.title);
    }
    setEditingTitle(false);
  }

  const collapsed = collapsedIds.has(section.id);
  const sortedSubsections = bySortOrder(section.subsections);
  const subsectionItemCount = section.subsections.reduce(
    (acc, sub) => acc + sub.items.length,
    0,
  );

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="border-b border-border last:border-b-0"
    >
      {/* ── Section header row ── */}
      <div className="group/header flex items-center gap-2 px-4 py-3 bg-muted/30">
        {!wiring.readOnly && (
          <button
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover/header:opacity-100 transition-opacity p-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Drag section to reorder"
            tabIndex={-1}
          >
            <GripVertical size={16} />
          </button>
        )}
        <span className="shrink-0 text-sm font-mono font-semibold tabular-nums text-muted-foreground">
          {wiring.numbering.get(section.id)}
        </span>
        {editingTitle ? (
          <Input
            autoFocus
            value={draftTitle}
            maxLength={200}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setDraftTitle(section.title);
                setEditingTitle(false);
              }
            }}
            className="h-7 text-sm font-semibold w-56"
          />
        ) : (
          <span className="text-sm font-semibold text-foreground">
            {section.title}
          </span>
        )}
        {/* Entry count — every line item the section holds, including
            those inside its subsections. */}
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {entryCountLabel(section.items.length + subsectionItemCount)}
        </span>
        {/* Collapsed → surface the section's $ total (direct items plus every
            subsection's items) on the header, since the line totals it sums
            are hidden (#591). Same summation as the document subtotal. */}
        {collapsed && (
          <span className="ml-auto shrink-0 font-mono tabular-nums text-sm font-medium text-foreground">
            {formatCurrency(sumLineItemsFromSections([section]))}
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggleCollapsed(section.id)}
          className={cn(
            "p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0",
            !collapsed && "ml-auto",
          )}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {!wiring.readOnly && (onRename || onAddSubsection || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="opacity-0 group-hover/header:opacity-100 transition-opacity p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
              aria-label="Section actions"
            >
              <MoreVertical size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              {onRename && (
                <DropdownMenuItem onClick={startEditing}>
                  <Pencil size={13} />
                  Rename
                </DropdownMenuItem>
              )}
              {onAddSubsection && (
                <DropdownMenuItem onClick={() => setAddSubOpen(true)}>
                  <FolderPlus size={13} />
                  Add subsection
                </DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 size={13} />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {onAddSubsection && (
        <AddSubsectionDialog
          open={addSubOpen}
          onOpenChange={setAddSubOpen}
          onConfirm={(title) => onAddSubsection(section.id, title)}
        />
      )}
      {onDelete && (
        <DeleteSectionDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          sectionTitle={section.title}
          directItemCount={section.items.length}
          subsectionCount={section.subsections.length}
          subsectionItemCount={subsectionItemCount}
          onConfirm={() => onDelete(section.id)}
        />
      )}

      {!collapsed && (
        <>
          {/* ── Subsections — SortableContext scoped to THIS section ── */}
          <SortableContext
            items={sortedSubsections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {sortedSubsections.map((sub) => (
                <SubsectionGroup
                  key={sub.id}
                  subsection={sub}
                  collapsed={collapsedIds.has(sub.id)}
                  onToggleCollapsed={() => onToggleCollapsed(sub.id)}
                  onRename={onRenameSubsection}
                  onDelete={onDeleteSubsection}
                  wiring={wiring}
                />
              ))}
            </ul>
          </SortableContext>

          {/* ── Direct items — their own context, separate from subsections ── */}
          <ItemRows
            items={section.items}
            parentSectionId={section.id}
            wiring={wiring}
          />
          {section.items.length === 0 && section.subsections.length === 0 && (
            // Deliberately NOT "No items yet." — that exact string belongs to
            // empty subsections and must stay unique for the drag-end suites.
            <p className="px-4 py-1.5 text-xs text-muted-foreground italic">
              No items in this section yet.
            </p>
          )}
        </>
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupedLineItemTable
// ─────────────────────────────────────────────────────────────────────────────

export function GroupedLineItemTable({
  sections,
  onSelectLineItem,
  selectedLineItemId,
  onDeleteLineItem,
  onAddLineItem,
  onAddSection,
  onRenameSection,
  onAddSubsection,
  onDeleteSection,
  onRenameSubsection,
  onDeleteSubsection,
  readOnly = false,
}: GroupedLineItemTableProps) {
  // #568 read-model: id → positional number, recomputed from the live tree so
  // add / remove / drag-reorder renumber for free.
  const numbering = buildNumberIndex(sections);

  // Collapse state for sections and subsections, keyed by container id and
  // held in one place so "Collapse all" can sweep the whole document.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  function toggleCollapsed(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Dropping a line item onto a collapsed container auto-expands it so the
  // moved row is immediately visible (card-era contract, pinned by the
  // drag-end suites).
  useDndMonitor({
    onDragEnd(event) {
      const activeType = event.active.data.current?.type as string | undefined;
      if (activeType !== "line-item") return;
      const dest = resolveLineItemDropTarget(event.over ?? null);
      if (!dest) return;
      setCollapsedIds((prev) => {
        if (!prev.has(dest.destinationContainerId)) return prev;
        const next = new Set(prev);
        next.delete(dest.destinationContainerId);
        return next;
      });
    },
  });

  // Row checkboxes (#573) — a checking affordance local to the table. Bulk
  // actions are explicitly out of scope (PRD #564), so nothing consumes the
  // set yet beyond the checkboxes themselves.
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());

  function setItemChecked(id: string, checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // "Collapse all" sweeps sections and subsections alike; once every section
  // is closed the toggle flips to "Expand all", which clears the whole set.
  const allCollapsed =
    sections.length > 0 && sections.every((s) => collapsedIds.has(s.id));

  function toggleAllCollapsed() {
    if (allCollapsed) {
      setCollapsedIds(new Set());
    } else {
      setCollapsedIds(
        new Set(
          sections.flatMap((s) => [s.id, ...s.subsections.map((sub) => sub.id)]),
        ),
      );
    }
  }

  const sortedSections = bySortOrder(sections);

  // "+ Add" → New section: inline title input in the toolbar. The handoff is
  // fire-and-forget — persistence (and failure toasts) belong to the caller.
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  function commitNewSection() {
    const title = newSectionTitle.trim();
    if (!title) return;
    onAddSection?.(title);
    setAddingSection(false);
    setNewSectionTitle("");
  }

  // Item adds land in the last section — the predictable end of the document.
  const lastSectionId = sortedSections[sortedSections.length - 1]?.id;

  const wiring: RowWiring = {
    numbering,
    selectedLineItemId,
    onSelectLineItem,
    onDeleteLineItem,
    checkedIds,
    setItemChecked,
    readOnly,
  };

  return (
    <div
      data-testid="grouped-line-item-table"
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      {/* ── Table toolbar ── */}
      <div className="flex items-center justify-end gap-3 px-4 py-2 border-b border-border">
        {addingSection ? (
          <div className="flex items-center gap-2 mr-auto">
            <Input
              autoFocus
              value={newSectionTitle}
              onChange={(e) => setNewSectionTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewSection();
                if (e.key === "Escape") {
                  setAddingSection(false);
                  setNewSectionTitle("");
                }
              }}
              placeholder="Section name"
              className="h-7 w-56 text-sm"
            />
            <button
              type="button"
              onClick={commitNewSection}
              className="text-xs font-medium text-primary hover:underline"
            >
              Add section
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingSection(false);
                setNewSectionTitle("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          !readOnly &&
          (onAddLineItem || onAddSection) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Add"
                className="mr-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted transition-colors"
              >
                <Plus size={14} />
                Add
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="start">
                {onAddLineItem && lastSectionId && (
                  <>
                    <DropdownMenuItem
                      onClick={() => onAddLineItem(lastSectionId, "library")}
                    >
                      From price list
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onAddLineItem(lastSectionId, "custom")}
                    >
                      New item
                    </DropdownMenuItem>
                  </>
                )}
                {onAddSection && (
                  <DropdownMenuItem onClick={() => setAddingSection(true)}>
                    New section
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
        <button
          type="button"
          onClick={toggleAllCollapsed}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>
      <SortableContext
        items={sortedSections.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul>
          {sortedSections.map((section) => (
            <SectionGroup
              key={section.id}
              section={section}
              collapsedIds={collapsedIds}
              onToggleCollapsed={toggleCollapsed}
              onRename={onRenameSection}
              onAddSubsection={onAddSubsection}
              onDelete={onDeleteSection}
              onRenameSubsection={onRenameSubsection}
              onDeleteSubsection={onDeleteSubsection}
              wiring={wiring}
            />
          ))}
        </ul>
      </SortableContext>
    </div>
  );
}

"use client";

// SectionCard — top-level estimate section with drag, inline title edit,
// kebab menu (Rename / Add subsection / Delete), and two independent
// SortableContexts: one for subsections, one for direct line items.
//
// Spec interpretation (§5.1 + "Stop / escalate" note):
//   Items are scoped to a section_id (which can be a top-level section OR
//   a subsection). So the SectionCard has TWO inner lists:
//     1. Subsections list  → subsections SortableContext
//     2. Direct items list → items SortableContext
//   Each has its own context, preventing cross-context drags.
//
// Plan deviation: onAddSection / onAddSubsection extended from `() => void`
//   to include the new title. Specifically:
//     onAddSubsection(parentId: string, title: string) → void
//   The title is collected inside SectionCard via a small Dialog so the parent
//   only needs to handle the POST + state update, not the prompt UI.

import { useState } from "react";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDndMonitor } from "@dnd-kit/core";
import { resolveLineItemDropTarget } from "./move-line-item";
import {
  GripVertical,
  MoreVertical,
  Trash2,
  Plus,
  Pencil,
  FolderPlus,
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
import { SubsectionCard } from "./subsection-card";
import { LineItemRow, type BuilderLineItem } from "./line-item-row";
import type { BuilderMode, EstimateSection, InvoiceSection } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionCardProps {
  section:
    | (EstimateSection & {
        items: BuilderLineItem[];
        subsections: Array<EstimateSection & { items: BuilderLineItem[] }>;
      })
    | (InvoiceSection & {
        items: BuilderLineItem[];
        subsections: Array<InvoiceSection & { items: BuilderLineItem[] }>;
      });
  // Plan deviation: title added to onAddSubsection (was missing from spec signature)
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onAddSubsection: (parentId: string, title: string) => void;
  onAddLineItem: (sectionId: string) => void;
  onLineItemDelete: (id: string) => void;
  /** Task 25: called when an inline cell is committed; parent updates local state. */
  onLineItemChange: (itemId: string, partial: Partial<BuilderLineItem>) => void;
  onSubsectionRename: (id: string, title: string) => void;
  onSubsectionDelete: (id: string) => void;
  onSubsectionLineItemDelete: (id: string) => void;
  /** Task 25: when true, hides editing controls (voided estimate). */
  readOnly?: boolean;
  mode?: BuilderMode;
  /** Task 36: index of this section in the parent sections array; used to build DOM ids for scroll-to-item. */
  sectionIdx?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DeleteSectionDialog
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
// AddSubsectionDialog — collects title then calls onConfirm(title)
// Plan deviation: title collected here so onAddSubsection(parentId, title)
// can be called with both arguments in one shot.
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
// SectionCard
// ─────────────────────────────────────────────────────────────────────────────

export function SectionCard({
  section,
  onRename,
  onDelete,
  onAddSubsection,
  onAddLineItem,
  onLineItemDelete,
  onLineItemChange,
  onSubsectionRename,
  onSubsectionDelete,
  onSubsectionLineItemDelete,
  readOnly = false,
  mode = "estimate",
  sectionIdx,
}: SectionCardProps) {
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

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(section.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-expand on drop: if a Line item is dropped onto this Section
  // (either onto its chrome or onto one of its direct items) while it is
  // collapsed, expand so the user can see where the item landed.
  useDndMonitor({
    onDragEnd(event) {
      const activeType = event.active.data.current?.type as string | undefined;
      if (activeType !== "line-item") return;
      const dest = resolveLineItemDropTarget(event.over ?? null);
      if (dest && dest.destinationContainerId === section.id) {
        setIsCollapsed(false);
      }
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // ── Inline title edit ────────────────────────────────────────────────────

  function startEditing() {
    setDraftTitle(section.title);
    setEditingTitle(true);
  }

  function commitTitle() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== section.title) {
      onRename(section.id, trimmed);
    } else {
      setDraftTitle(section.title);
    }
    setEditingTitle(false);
  }

  // ── Sorted lists ─────────────────────────────────────────────────────────

  const sortedSubsections = [...section.subsections].sort(
    (a, b) => a.sort_order - b.sort_order
  );
  const sortedItems = [...section.items].sort(
    (a, b) => a.sort_order - b.sort_order
  );

  // ── Item counts for delete dialog ────────────────────────────────────────

  const subsectionItemCount = section.subsections.reduce(
    (acc, sub) => acc + sub.items.length,
    0
  );

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group rounded-xl border border-border bg-card overflow-hidden",
        isDragging && "ring-2 ring-primary/30 shadow-lg"
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
        {!readOnly && (
          <button
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            aria-label="Drag section to reorder"
          >
            <GripVertical size={16} />
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
                setDraftTitle(section.title);
                setEditingTitle(false);
              }
            }}
            className="h-7 text-sm font-semibold flex-1"
          />
        ) : readOnly ? (
          <div className="flex-1 text-left">
            <span className="text-sm font-semibold text-foreground">
              {section.title}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {section.items.length} direct item{section.items.length !== 1 ? "s" : ""}
              {section.subsections.length > 0 && (
                <> · {section.subsections.length} subsection{section.subsections.length !== 1 ? "s" : ""}</>
              )}
            </span>
          </div>
        ) : (
          <button onClick={startEditing} className="flex-1 text-left">
            <span className="text-sm font-semibold text-foreground">
              {section.title}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {section.items.length} direct item{section.items.length !== 1 ? "s" : ""}
              {section.subsections.length > 0 && (
                <> · {section.subsections.length} subsection{section.subsections.length !== 1 ? "s" : ""}</>
              )}
            </span>
          </button>
        )}

        {/* Collapse toggle — always visible */}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          aria-label={isCollapsed ? "Expand section" : "Collapse section"}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>

        {/* Kebab menu — hidden when readOnly */}
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Section actions"
            >
              <MoreVertical size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem onClick={startEditing}>
                <Pencil size={13} />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAddSubOpen(true)}>
                <FolderPlus size={13} />
                Add subsection
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

      {/* ── Body — hidden when collapsed ─────────────────────────────────── */}
      {!isCollapsed && (
      <div className="p-3 space-y-3">

        {/* ── Subsections list ──────────────────────────────────────────── */}
        {sortedSubsections.length > 0 && (
          <div className="space-y-2">
            {/* SortableContext scoped to THIS section's subsections.
                Cross-section drags snap back because the subsection's id
                won't exist in another section's context. */}
            <SortableContext
              items={sortedSubsections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {sortedSubsections.map((sub, subIdx) => (
                  <SubsectionCard
                    key={sub.id}
                    subsection={sub}
                    onRename={onSubsectionRename}
                    onDelete={onSubsectionDelete}
                    onAddLineItem={onAddLineItem}
                    onLineItemDelete={onSubsectionLineItemDelete}
                    onLineItemChange={onLineItemChange}
                    readOnly={readOnly}
                    mode={mode}
                    sectionIdx={sectionIdx}
                    subsectionIdx={subIdx}
                  />
                ))}
              </ul>
            </SortableContext>
          </div>
        )}

        {/* ── Direct items list ─────────────────────────────────────────── */}
        {/* SortableContext scoped to THIS section's direct items only.
            Items in subsections are in their own context (SubsectionCard),
            so they can't be dragged into this context. */}
        <SortableContext
          items={sortedItems.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {sortedItems.map((item, iIdx) => (
              <LineItemRow
                key={item.id}
                item={item}
                parentSectionId={section.id}
                onChange={(partial) => onLineItemChange(item.id, partial)}
                onDelete={() => onLineItemDelete(item.id)}
                readOnly={readOnly}
                mode={mode}
                domId={
                  sectionIdx !== undefined
                    ? `line-item-s${sectionIdx}-i${iIdx}`
                    : undefined
                }
              />
            ))}
          </div>
        </SortableContext>

        {sortedSubsections.length === 0 && sortedItems.length === 0 && (
          <p className="text-xs text-muted-foreground italic px-1">
            No subsections or items yet. Add items or subsections below.
          </p>
        )}
      </div>
      )}

      {/* ── Footer — hidden when readOnly OR collapsed ────────────────────── */}
      {!readOnly && !isCollapsed && (
        <div className="px-3 pb-3 flex items-center gap-2">
          <button
            onClick={() => {
              // TODO Task 26: replace with AddItemDialog
              onAddLineItem(section.id);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
          >
            <Plus size={12} />
            Add item
          </button>
          <button
            onClick={() => setAddSubOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
          >
            <FolderPlus size={12} />
            Add subsection
          </button>
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <DeleteSectionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        sectionTitle={section.title}
        directItemCount={section.items.length}
        subsectionCount={section.subsections.length}
        subsectionItemCount={subsectionItemCount}
        onConfirm={() => onDelete(section.id)}
      />

      <AddSubsectionDialog
        open={addSubOpen}
        onOpenChange={setAddSubOpen}
        onConfirm={(title) => onAddSubsection(section.id, title)}
      />
    </li>
  );
}

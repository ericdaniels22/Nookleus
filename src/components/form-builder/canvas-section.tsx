"use client";

import { useState } from "react";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Eye, EyeOff, Trash2, Lock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { CanvasField } from "./canvas-field";
import type { FormField, FormSection } from "@/lib/types";

export function CanvasSection({
  section,
  selectedFieldId,
  onSelectField,
  onUpdateSection,
  onToggleSectionVisibility,
  onDeleteSection,
  onUpdateField,
  onDuplicateField,
  onDeleteField,
  onAddBlankField,
}: {
  section: FormSection;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string | null) => void;
  onUpdateSection: (updates: Partial<FormSection>) => void;
  onToggleSectionVisibility: () => void;
  onDeleteSection: () => void;
  onUpdateField: (fieldId: string, updates: Partial<FormField>) => void;
  onDuplicateField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  onAddBlankField: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id, data: { type: "section", sectionId: section.id } });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${section.id}`,
    data: { type: "section-dropzone", sectionId: section.id },
  });

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(section.title);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : section.visible === false ? 0.6 : 1,
  };

  function commitTitle() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== section.title) {
      onUpdateSection({ title: trimmed });
    } else {
      setDraftTitle(section.title);
    }
    setEditingTitle(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group bg-card rounded-xl border border-border overflow-hidden"
    >
      <header className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          aria-label="Drag section"
        >
          <GripVertical size={16} />
        </button>

        {editingTitle ? (
          <Input
            autoFocus
            value={draftTitle}
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
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="flex-1 text-left"
          >
            <span className="text-sm font-semibold text-foreground">{section.title}</span>
            <span className="text-xs text-muted-foreground ml-2">
              {section.fields.filter((f) => f.visible !== false).length} field
              {section.fields.filter((f) => f.visible !== false).length !== 1 ? "s" : ""}
            </span>
          </button>
        )}

        <div className="flex items-center gap-1">
          {section.is_default && <Lock size={12} className="text-muted-foreground/40" />}
          <button
            onClick={onToggleSectionVisibility}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={section.visible === false ? "Show section" : "Hide section"}
          >
            {section.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {!section.is_default && (
            <button
              onClick={onDeleteSection}
              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              aria-label="Delete section"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <div
        ref={setDropRef}
        className={cn(
          "p-3 space-y-1.5 min-h-[60px] transition-colors",
          isOver && "bg-[var(--brand-primary)]/5"
        )}
      >
        <SortableContext
          items={section.fields.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          {section.fields.map((field) => (
            <CanvasField
              key={field.id}
              field={field}
              selected={selectedFieldId === field.id}
              onSelect={() =>
                onSelectField(selectedFieldId === field.id ? null : field.id)
              }
              onToggleRequired={() =>
                onUpdateField(field.id, { required: !field.required })
              }
              onToggleVisibility={() =>
                onUpdateField(field.id, { visible: field.visible === false })
              }
              onDuplicate={() => onDuplicateField(field.id)}
              onDelete={() => onDeleteField(field.id)}
            />
          ))}
        </SortableContext>

        <button
          onClick={onAddBlankField}
          className="flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
        >
          <Plus size={14} />
          Add field
        </button>
      </div>
    </div>
  );
}

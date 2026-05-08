"use client";

import { useState } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor,
  KeyboardSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Monitor, Smartphone, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { CanvasSection } from "./canvas-section";
import { TestMode } from "./test-mode";
import { FIELD_PRESETS } from "@/lib/intake-form-presets";
import type { FormConfig, FormField, FormSection } from "@/lib/types";

export type ViewMode = "edit" | "test";
type WidthMode = "desktop" | "mobile";

export function Canvas({
  config,
  setConfig,
  selectedFieldId,
  onSelectField,
  viewMode,
  setViewMode,
}: {
  config: FormConfig;
  setConfig: (c: FormConfig) => void;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string | null) => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
}) {
  const [widthMode, setWidthMode] = useState<WidthMode>("desktop");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  function addSection() {
    if (!newSectionTitle.trim()) return;
    const id = "custom_" + Date.now();
    const newSection: FormSection = {
      id,
      title: newSectionTitle.trim(),
      is_default: false,
      visible: true,
      fields: [],
    };
    setConfig({ sections: [...config.sections, newSection] });
    setNewSectionTitle("");
    setShowAddSection(false);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;

    const activeData = active.data.current as
      | { type: "section" | "field" | "palette-item"; sectionId?: string; fieldId?: string; paletteId?: string }
      | undefined;
    const overData = over.data.current as
      | { type: "section" | "field" | "section-dropzone"; sectionId?: string; fieldId?: string }
      | undefined;

    if (!activeData) return;

    if (activeData.type === "section" && overData?.type === "section") {
      const oldIndex = config.sections.findIndex((s) => s.id === active.id);
      const newIndex = config.sections.findIndex((s) => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        setConfig({ sections: arrayMove(config.sections, oldIndex, newIndex) });
      }
      return;
    }

    if (activeData.type === "field" && overData?.type === "field") {
      const fromSection = config.sections.find((s) =>
        s.fields.some((f) => f.id === active.id)
      );
      const toSection = config.sections.find((s) =>
        s.fields.some((f) => f.id === over.id)
      );
      if (fromSection && toSection && fromSection.id === toSection.id) {
        const oldIndex = fromSection.fields.findIndex((f) => f.id === active.id);
        const newIndex = fromSection.fields.findIndex((f) => f.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          setConfig({
            sections: config.sections.map((s) =>
              s.id === fromSection.id
                ? { ...s, fields: arrayMove(s.fields, oldIndex, newIndex) }
                : s
            ),
          });
        }
      }
      return;
    }

    if (activeData.type === "palette-item") {
      const targetSectionId =
        overData?.type === "section-dropzone"
          ? overData.sectionId
          : overData?.type === "field"
            ? config.sections.find((s) =>
                s.fields.some((f) => f.id === over.id)
              )?.id
            : undefined;
      if (!targetSectionId) return;

      const paletteId = activeData.paletteId ?? "";
      const newField = buildFieldFromPalette(paletteId);
      if (!newField) return;

      setConfig({
        sections: config.sections.map((s) =>
          s.id === targetSectionId ? { ...s, fields: [...s.fields, newField] } : s
        ),
      });
      onSelectField(newField.id);
    }
  }

  function buildFieldFromPalette(paletteId: string): FormField | null {
    const id = "custom_" + Date.now();
    if (paletteId.startsWith("type:")) {
      const type = paletteId.slice("type:".length) as FormField["type"];
      return {
        id,
        type,
        label: "New Field",
        required: false,
        is_default: false,
        visible: true,
      };
    }
    if (paletteId.startsWith("preset:")) {
      const key = paletteId.slice("preset:".length);
      const preset = FIELD_PRESETS.find((p) => p.key === key);
      if (!preset) return null;
      return { id, ...preset.makeField() };
    }
    return null;
  }

  function updateSection(sectionId: string, updates: Partial<FormSection>) {
    setConfig({
      sections: config.sections.map((s) => (s.id === sectionId ? { ...s, ...updates } : s)),
    });
  }
  function deleteSection(sectionId: string) {
    if (!confirm("Delete this section and all its fields?")) return;
    setConfig({ sections: config.sections.filter((s) => s.id !== sectionId) });
  }
  function toggleSectionVisibility(sectionId: string) {
    const section = config.sections.find((s) => s.id === sectionId);
    if (!section) return;
    updateSection(sectionId, { visible: section.visible === false });
  }

  function updateField(sectionId: string, fieldId: string, updates: Partial<FormField>) {
    setConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.id === fieldId ? { ...f, ...updates } : f
              ),
            }
          : s
      ),
    });
  }
  function duplicateField(sectionId: string, fieldId: string) {
    const section = config.sections.find((s) => s.id === sectionId);
    const original = section?.fields.find((f) => f.id === fieldId);
    if (!section || !original) return;
    const copy: FormField = {
      ...original,
      id: "custom_" + Date.now(),
      label: original.label + " (copy)",
      is_default: false,
    };
    const idx = section.fields.findIndex((f) => f.id === fieldId);
    const next = [...section.fields];
    next.splice(idx + 1, 0, copy);
    setConfig({
      sections: config.sections.map((s) => (s.id === sectionId ? { ...s, fields: next } : s)),
    });
    onSelectField(copy.id);
  }
  function deleteField(sectionId: string, fieldId: string) {
    setConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s
      ),
    });
    if (selectedFieldId === fieldId) onSelectField(null);
  }
  function addBlankField(sectionId: string) {
    const id = "custom_" + Date.now();
    const newField: FormField = {
      id,
      type: "text",
      label: "New Field",
      required: false,
      is_default: false,
      visible: true,
    };
    setConfig({
      sections: config.sections.map((s) =>
        s.id === sectionId ? { ...s, fields: [...s.fields, newField] } : s
      ),
    });
    onSelectField(id);
  }

  if (viewMode === "test") {
    return <TestMode onExit={() => setViewMode("edit")} />;
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setViewMode("edit")}
            className={cn(
              "px-3 py-1.5",
              viewMode === "edit" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            Edit
          </button>
          <button
            onClick={() => setViewMode("test")}
            className={cn(
              "px-3 py-1.5 border-l border-border text-muted-foreground hover:bg-muted/50"
            )}
          >
            Test
          </button>
        </div>

        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setWidthMode("desktop")}
            className={cn(
              "px-2.5 py-1.5",
              widthMode === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            )}
            aria-label="Desktop preview width"
          >
            <Monitor size={14} />
          </button>
          <button
            onClick={() => setWidthMode("mobile")}
            className={cn(
              "px-2.5 py-1.5 border-l border-border",
              widthMode === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            )}
            aria-label="Mobile preview width"
          >
            <Smartphone size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/20 p-6">
        <div
          className={cn(
            "mx-auto transition-[max-width]",
            widthMode === "desktop" ? "max-w-[720px]" : "max-w-[390px]"
          )}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={config.sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {config.sections.map((section) => (
                  <CanvasSection
                    key={section.id}
                    section={section}
                    selectedFieldId={selectedFieldId}
                    onSelectField={onSelectField}
                    onUpdateSection={(updates) => updateSection(section.id, updates)}
                    onToggleSectionVisibility={() => toggleSectionVisibility(section.id)}
                    onDeleteSection={() => deleteSection(section.id)}
                    onUpdateField={(fid, updates) => updateField(section.id, fid, updates)}
                    onDuplicateField={(fid) => duplicateField(section.id, fid)}
                    onDeleteField={(fid) => deleteField(section.id, fid)}
                    onAddBlankField={() => addBlankField(section.id)}
                  />
                ))}
                {showAddSection ? (
                  <div className="rounded-xl border border-dashed border-border bg-card p-3 flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Section title</label>
                      <Input
                        value={newSectionTitle}
                        onChange={(e) => setNewSectionTitle(e.target.value)}
                        placeholder="e.g. Equipment Needed"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addSection();
                          if (e.key === "Escape") {
                            setNewSectionTitle("");
                            setShowAddSection(false);
                          }
                        }}
                        className="h-9"
                      />
                    </div>
                    <button
                      onClick={addSection}
                      className="px-3 h-9 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setNewSectionTitle("");
                        setShowAddSection(false);
                      }}
                      className="px-3 h-9 rounded-lg text-sm font-medium border border-border text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddSection(true)}
                    className="flex items-center justify-center gap-1.5 w-full px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border border-dashed border-border"
                  >
                    <Plus size={14} />
                    Add section
                  </button>
                )}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDragId ? (
                <div className="rounded-lg border-2 border-[var(--brand-primary)] bg-card px-3 py-2 text-sm shadow-lg">
                  Dragging…
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  );
}

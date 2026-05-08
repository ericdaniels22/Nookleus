"use client";

import { useState } from "react";
import { Palette } from "@/components/form-builder/palette";
import { Canvas, type ViewMode } from "@/components/form-builder/canvas";
import { Inspector } from "@/components/form-builder/inspector";
import { VersionPill } from "@/components/form-builder/version-pill";
import { useFormConfig } from "@/components/form-builder/use-form-config";
import { FIELD_PRESETS } from "@/lib/intake-form-presets";
import type { FormField } from "@/lib/types";

export default function IntakeFormBuilderPage() {
  const { config, setConfig, loading, status, saveNow } = useFormConfig();
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const isTesting = viewMode === "test";

  function refresh() {
    window.location.reload();
  }

  function findField(fieldId: string): { sectionId: string; field: FormField } | null {
    for (const s of config.sections) {
      const f = s.fields.find((x) => x.id === fieldId);
      if (f) return { sectionId: s.id, field: f };
    }
    return null;
  }

  function updateSelectedField(updates: Partial<FormField>) {
    if (!selectedFieldId) return;
    const found = findField(selectedFieldId);
    if (!found) return;
    setConfig({
      sections: config.sections.map((s) =>
        s.id === found.sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.id === selectedFieldId
                  ? sanitizeFieldForUpdate({ ...f, ...updates })
                  : f
              ),
            }
          : s
      ),
    });
  }

  function insertTypeIntoLastSection(type: FormField["type"]) {
    const last = config.sections[config.sections.length - 1];
    if (!last) return;
    const id = "custom_" + Date.now();
    const newField: FormField = {
      id,
      type,
      label: "New Field",
      required: false,
      is_default: false,
      visible: true,
    };
    setConfig({
      sections: config.sections.map((s) =>
        s.id === last.id ? { ...s, fields: [...s.fields, newField] } : s
      ),
    });
    setSelectedFieldId(id);
  }

  function insertPresetIntoLastSection(presetKey: string) {
    const preset = FIELD_PRESETS.find((p) => p.key === presetKey);
    const last = config.sections[config.sections.length - 1];
    if (!preset || !last) return;
    const id = "custom_" + Date.now();
    const newField: FormField = { id, ...preset.makeField() };
    setConfig({
      sections: config.sections.map((s) =>
        s.id === last.id ? { ...s, fields: [...s.fields, newField] } : s
      ),
    });
    setSelectedFieldId(id);
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading…</div>;
  }

  const selected = selectedFieldId ? findField(selectedFieldId)?.field ?? null : null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Intake Form Builder</h2>
          <p className="text-xs text-muted-foreground">
            Drag a field from the left, click to edit. Changes save automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VersionPill status={status} onRetry={saveNow} onRestoreSuccess={refresh} />
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {!isTesting && (
          <Palette
            onInsertType={insertTypeIntoLastSection}
            onInsertPreset={insertPresetIntoLastSection}
          />
        )}
        <Canvas
          config={config}
          setConfig={setConfig}
          selectedFieldId={selectedFieldId}
          onSelectField={setSelectedFieldId}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />
        {selected && !isTesting && (
          <Inspector
            field={selected}
            onUpdate={updateSelectedField}
            onClose={() => setSelectedFieldId(null)}
          />
        )}
      </div>
    </div>
  );
}

function sanitizeFieldForUpdate(field: FormField): FormField {
  const supportsOptions = field.type === "select" || field.type === "pill";
  if (!supportsOptions && field.options) {
    const { options: _options, options_source: _optionsSource, ...rest } = field;
    return rest as FormField;
  }
  return field;
}

"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { X, Lock } from "lucide-react";
import type { FormField } from "@/lib/types";

const FIELD_TYPES: { value: FormField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text Area" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "select", label: "Dropdown" },
  { value: "pill", label: "Pill Selector" },
  { value: "checkbox", label: "Checkbox" },
];

const PILL_COLOR_PRESETS: { key: string; name: string; bg_color?: string; text_color?: string }[] = [
  { key: "default", name: "Default" },
  { key: "red", name: "Red", bg_color: "#ef4444", text_color: "#ffffff" },
  { key: "orange", name: "Orange", bg_color: "#f97316", text_color: "#ffffff" },
  { key: "amber", name: "Amber", bg_color: "#f59e0b", text_color: "#ffffff" },
  { key: "green", name: "Green", bg_color: "#10b981", text_color: "#ffffff" },
  { key: "blue", name: "Blue", bg_color: "#3b82f6", text_color: "#ffffff" },
  { key: "purple", name: "Purple", bg_color: "#8b5cf6", text_color: "#ffffff" },
  { key: "slate", name: "Slate", bg_color: "#64748b", text_color: "#ffffff" },
];

const MAPS_TO_GROUPS: { label: string; options: { value: string; label: string }[] }[] = [
  {
    label: "Contact",
    options: [
      { value: "contact.first_name", label: "First name" },
      { value: "contact.last_name", label: "Last name" },
      { value: "contact.phone", label: "Phone" },
      { value: "contact.email", label: "Email" },
      { value: "contact.role", label: "Role" },
      { value: "contact.notes", label: "Notes" },
    ],
  },
  {
    label: "Job",
    options: [
      { value: "job.damage_type", label: "Damage type" },
      { value: "job.damage_source", label: "Damage source" },
      { value: "job.affected_areas", label: "Affected areas" },
      { value: "job.property_address", label: "Property address" },
      { value: "job.property_type", label: "Property type" },
      { value: "job.property_sqft", label: "Property sqft" },
      { value: "job.property_stories", label: "Property stories" },
      { value: "job.access_notes", label: "Access notes" },
      { value: "job.urgency", label: "Urgency" },
      { value: "job.insurance_company", label: "Insurance company" },
      { value: "job.claim_number", label: "Claim number" },
    ],
  },
  {
    label: "Adjuster",
    options: [
      { value: "adjuster.full_name", label: "Adjuster name" },
      { value: "adjuster.phone", label: "Adjuster phone" },
      { value: "adjuster.title", label: "Adjuster title" },
    ],
  },
];

export function Inspector({
  field,
  onUpdate,
  onClose,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
  onClose: () => void;
}) {
  const isDefault = !!field.is_default;
  const hasOptions = field.type === "select" || field.type === "pill";
  const [newOption, setNewOption] = useState("");

  function addOption() {
    if (!newOption.trim()) return;
    const opts = field.options || [];
    onUpdate({
      options: [
        ...opts,
        {
          value: newOption.trim().toLowerCase().replace(/\s+/g, "_"),
          label: newOption.trim(),
        },
      ],
    });
    setNewOption("");
  }

  function removeOption(index: number) {
    const opts = [...(field.options || [])];
    opts.splice(index, 1);
    onUpdate({ options: opts });
  }

  function setOptionColor(index: number, preset: typeof PILL_COLOR_PRESETS[number]) {
    const opts = [...(field.options || [])];
    opts[index] = { ...opts[index], bg_color: preset.bg_color, text_color: preset.text_color };
    onUpdate({ options: opts });
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Field Settings</h3>
          {isDefault && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <Lock size={10} /> Built-in field — type and key are locked
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Close inspector"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
          <Input
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="h-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={field.required || false}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="w-4 h-4 rounded accent-[var(--brand-primary)]"
          />
          <span className="text-foreground">Required</span>
        </label>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
          <select
            value={field.type}
            onChange={(e) => onUpdate({ type: e.target.value as FormField["type"] })}
            disabled={isDefault}
            className="w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-50"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {!isDefault && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Changing type preserves label, placeholder, help text, and required status.
            </p>
          )}
        </div>

        {hasOptions && !field.options_source && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Options</label>
            <div className="space-y-2">
              {(field.options || []).map((opt, i) => (
                <div key={i} className="rounded bg-muted/40 px-2 py-1.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground flex-1">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{opt.value}</span>
                    {!isDefault && (
                      <button
                        onClick={() => removeOption(i)}
                        className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                        aria-label="Remove option"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {field.type === "pill" && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {PILL_COLOR_PRESETS.map((preset) => {
                        const selected = (preset.bg_color ?? null) === (opt.bg_color ?? null);
                        return (
                          <button
                            key={preset.key}
                            onClick={() => setOptionColor(i, preset)}
                            className={`w-5 h-5 rounded-full border transition-all ${selected ? "ring-2 ring-offset-1 ring-offset-card ring-foreground" : "border-border"}`}
                            style={{ backgroundColor: preset.bg_color ?? "transparent" }}
                            title={preset.name}
                            aria-label={`Set ${preset.name}`}
                          >
                            {!preset.bg_color && (
                              <span className="block w-full h-full rounded-full bg-card" aria-hidden />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!isDefault && (
              <div className="flex gap-2 mt-2">
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="New option"
                  className="h-8 text-sm flex-1"
                  onKeyDown={(e) => e.key === "Enter" && addOption()}
                />
                <button
                  onClick={addOption}
                  className="px-3 py-1 rounded text-xs font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}

        {field.options_source && (
          <p className="text-xs text-muted-foreground">
            Options loaded dynamically from <span className="font-mono">{field.options_source}</span>
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Placeholder</label>
          <Input
            value={field.placeholder || ""}
            onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })}
            placeholder="Optional"
            className="h-9"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Help Text</label>
          <Input
            value={field.help_text || ""}
            onChange={(e) => onUpdate({ help_text: e.target.value || undefined })}
            placeholder="Optional"
            className="h-9"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Maps to</label>
          <select
            value={field.maps_to || ""}
            onChange={(e) => onUpdate({ maps_to: e.target.value || undefined })}
            className="w-full h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          >
            <option value="">— Custom field —</option>
            {MAPS_TO_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Routes this field&apos;s value to a system column on submit. &quot;Custom field&quot; stores it in the job&apos;s extra-fields table.
          </p>
        </div>
      </div>
    </aside>
  );
}

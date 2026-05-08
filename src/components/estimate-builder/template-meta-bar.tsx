"use client";

import { useEffect, useState } from "react";
import type { DamageType, TemplateWithContents } from "@/lib/types";

export interface TemplateMetaBarProps {
  template: TemplateWithContents;
  onChange: (patch: Partial<TemplateWithContents>) => void;
}

export default function TemplateMetaBar({ template, onChange }: TemplateMetaBarProps) {
  const [editingName, setEditingName] = useState(false);

  return (
    // key={template.id} forces remount when template changes, keeping uncontrolled inputs fresh
    <div key={template.id} className="rounded-lg border border-border p-4 mb-4">
      {editingName ? (
        <input
          autoFocus
          className="text-2xl font-semibold w-full bg-transparent outline-none border-b border-border"
          defaultValue={template.name}
          onBlur={(e) => {
            onChange({ name: e.target.value });
            setEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingName(false);
          }}
        />
      ) : (
        <h2
          className="text-2xl font-semibold cursor-text hover:opacity-70 transition-opacity"
          onClick={() => setEditingName(true)}
        >
          {template.name || "Untitled template"}
        </h2>
      )}

      <textarea
        className="text-sm text-muted-foreground mt-2 w-full resize-none bg-transparent outline-none border border-transparent hover:border-border focus:border-border rounded px-1 transition-colors"
        placeholder="Description (internal notes)"
        defaultValue={template.description ?? ""}
        rows={2}
        onBlur={(e) => onChange({ description: e.target.value || null })}
      />

      <DamageTypeTagPicker
        value={template.damage_type_tags}
        onChange={(tags) => onChange({ damage_type_tags: tags })}
      />
    </div>
  );
}

function DamageTypeTagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);

  useEffect(() => {
    fetch("/api/settings/damage-types")
      .then((res) => {
        if (res.ok) return res.json() as Promise<DamageType[]>;
      })
      .then((data) => {
        if (data) setDamageTypes(data);
      })
      .catch(() => {
        // Non-fatal: chips just won't render. Toast is excessive on a sub-load.
      });
  }, []);

  if (damageTypes.length === 0) return null;

  function toggle(name: string) {
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name]);
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-muted-foreground mb-1.5">Damage types</p>
      <div className="flex flex-wrap gap-1.5">
        {damageTypes.map((dt) => {
          const selected = value.includes(dt.name);
          return (
            <button
              key={dt.id}
              type="button"
              onClick={() => toggle(dt.name)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                selected
                  ? "border-transparent shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              style={
                selected ? { backgroundColor: dt.bg_color, color: dt.text_color } : undefined
              }
              aria-pressed={selected}
            >
              {dt.display_label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

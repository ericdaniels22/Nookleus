"use client";

import { Trash2 } from "lucide-react";
import { MERGE_FIELD_CATEGORIES, mergeFieldsByCategory } from "@/lib/contracts/merge-fields";
import type { OverlayField } from "@/lib/contracts/types";

interface Props {
  field: OverlayField | null;
  signerCount: 1 | 2;
  onChange: (next: OverlayField) => void;
  onDelete: () => void;
}

export default function FieldInspector({ field, signerCount, onChange, onDelete }: Props) {
  if (!field) {
    return (
      <aside className="w-72 border-l border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Select a field to edit its properties.
      </aside>
    );
  }

  const grouped = mergeFieldsByCategory();

  return (
    <aside className="w-72 border-l border-border bg-muted/30 p-4 space-y-4 overflow-y-auto">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {field.type} field
        </h3>
        <p className="text-xs text-muted-foreground">
          Page {field.page} · {Math.round(field.x)}, {Math.round(field.y)} · {Math.round(field.width)} ×{" "}
          {Math.round(field.height)}pt
        </p>
      </div>

      {field.type === "merge" && (
        <div>
          <label className="text-xs text-muted-foreground">Merge field</label>
          <select
            value={field.mergeFieldName ?? ""}
            onChange={(e) => onChange({ ...field, mergeFieldName: e.target.value })}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          >
            <option value="">— select —</option>
            {MERGE_FIELD_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={cat}>
                {grouped[cat].map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label} — {`{{${f.name}}}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {field.type === "label" && (
        <div>
          <label className="text-xs text-muted-foreground">Label text</label>
          <textarea
            value={field.labelText ?? ""}
            onChange={(e) => onChange({ ...field, labelText: e.target.value })}
            rows={3}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
      )}

      {field.type === "signature" && signerCount === 2 && (
        <div>
          <label className="text-xs text-muted-foreground">Signer</label>
          <div className="mt-1 flex gap-2">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...field, signerOrder: n as 1 | 2 })}
                className={`flex-1 px-2 py-1.5 text-sm rounded border ${
                  field.signerOrder === n
                    ? "bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]"
                    : "border-border bg-background"
                }`}
              >
                Signer {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {(field.type === "input" || field.type === "checkbox") && (
        <>
          <div>
            <label className="text-xs text-muted-foreground">Field key (slug)</label>
            <input
              value={field.inputKey ?? ""}
              onChange={(e) =>
                onChange({
                  ...field,
                  inputKey: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"),
                })
              }
              placeholder="deductible_amount"
              className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Label shown to customer</label>
            <input
              value={field.inputLabel ?? ""}
              onChange={(e) => onChange({ ...field, inputLabel: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={field.required ?? false}
              onChange={(e) => onChange({ ...field, required: e.target.checked })}
            />
            Required
          </label>
        </>
      )}

      {(field.type === "merge" || field.type === "date" || field.type === "label" || field.type === "input") && (
        <div>
          <label className="text-xs text-muted-foreground">Font size (pt)</label>
          <input
            type="number"
            min={6}
            max={48}
            value={field.fontSize}
            onChange={(e) =>
              onChange({
                ...field,
                fontSize: Math.max(6, Math.min(48, Number(e.target.value) || 11)),
              })
            }
            className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
          />
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <button
          type="button"
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-700 border border-red-300 rounded hover:bg-red-50"
        >
          <Trash2 size={14} />
          Delete field
        </button>
      </div>
    </aside>
  );
}

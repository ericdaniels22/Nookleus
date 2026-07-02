"use client";

import { Trash2, AlertTriangle } from "lucide-react";
import type { MergeFieldDefinition } from "@/lib/contracts/merge-field-registry";
import type { OverlayField } from "@/lib/contracts/types";

interface Props {
  field: OverlayField | null;
  signerCount: 1 | 2;
  mergeRegistry: MergeFieldDefinition[];
  onChange: (next: OverlayField) => void;
  onDelete: () => void;
}

function groupBySection(
  registry: MergeFieldDefinition[],
): { section: string; entries: MergeFieldDefinition[] }[] {
  const sections: string[] = [];
  const map = new Map<string, MergeFieldDefinition[]>();
  for (const def of registry) {
    if (def.hidden) continue;
    if (!map.has(def.section)) {
      sections.push(def.section);
      map.set(def.section, []);
    }
    map.get(def.section)!.push(def);
  }
  return sections.map((s) => ({ section: s, entries: map.get(s)! }));
}

function generateAutoInputKey(): string {
  return `auto_${Math.random().toString(36).slice(2, 10)}`;
}

export default function FieldInspector({ field, signerCount, mergeRegistry, onChange, onDelete }: Props) {
  if (!field) {
    return (
      <aside className="w-72 border-l border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Select a field to edit its properties.
      </aside>
    );
  }

  const grouped = groupBySection(mergeRegistry);

  // For checkbox auto-fill: look up the bound merge field's option set.
  const boundMergeDef =
    field.type === "checkbox" && field.autoFillBinding
      ? mergeRegistry.find((r) => r.slug === field.autoFillBinding?.mergeFieldName) ?? null
      : null;

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
            {grouped.map((g) => (
              <optgroup key={g.section} label={g.section}>
                {g.entries.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.label} — {`{{${f.slug}}}`}
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
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-background"
                }`}
              >
                Signer {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {field.type === "checkbox" && (
        <CheckboxInspectorBody
          field={field}
          grouped={grouped}
          boundMergeDef={boundMergeDef}
          onChange={onChange}
        />
      )}

      {field.type === "input" && (
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
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-300 border border-red-500/30 rounded hover:bg-red-500/10"
        >
          <Trash2 size={14} />
          Delete field
        </button>
      </div>
    </aside>
  );
}

function CheckboxInspectorBody({
  field,
  grouped,
  boundMergeDef,
  onChange,
}: {
  field: OverlayField;
  grouped: { section: string; entries: MergeFieldDefinition[] }[];
  boundMergeDef: MergeFieldDefinition | null;
  onChange: (next: OverlayField) => void;
}) {
  const isAutoFill = !!field.autoFillBinding;

  function switchToAutoFill() {
    onChange({
      ...field,
      inputKey: field.inputKey || generateAutoInputKey(),
      inputLabel: undefined,
      required: false,
      autoFillBinding: { mergeFieldName: "", matchValues: [] },
    });
  }

  function switchToManual() {
    const next: OverlayField = { ...field };
    delete next.autoFillBinding;
    onChange(next);
  }

  function updateBinding(patch: Partial<NonNullable<OverlayField["autoFillBinding"]>>) {
    if (!field.autoFillBinding) return;
    onChange({
      ...field,
      autoFillBinding: { ...field.autoFillBinding, ...patch },
    });
  }

  return (
    <>
      <div>
        <label className="text-xs text-muted-foreground">Checkbox type</label>
        <div className="mt-1 flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`checkbox-type-${field.id}`}
              checked={!isAutoFill}
              onChange={switchToManual}
            />
            Customer ticks at signing
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`checkbox-type-${field.id}`}
              checked={isAutoFill}
              onChange={switchToAutoFill}
            />
            Auto-fill from intake data
          </label>
        </div>
      </div>

      {!isAutoFill ? (
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
              placeholder="agreed_to_terms"
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
      ) : (
        <AutoFillBindingEditor
          binding={field.autoFillBinding!}
          grouped={grouped}
          boundMergeDef={boundMergeDef}
          onChange={updateBinding}
        />
      )}
    </>
  );
}

function AutoFillBindingEditor({
  binding,
  grouped,
  boundMergeDef,
  onChange,
}: {
  binding: NonNullable<OverlayField["autoFillBinding"]>;
  grouped: { section: string; entries: MergeFieldDefinition[] }[];
  boundMergeDef: MergeFieldDefinition | null;
  onChange: (patch: Partial<NonNullable<OverlayField["autoFillBinding"]>>) => void;
}) {
  const options = boundMergeDef?.options ?? null;

  // Unknown-option warning: any matchValue that isn't in the pill's option set.
  const unknownMatches =
    options && binding.matchValues.length
      ? binding.matchValues.filter((v) => !options.some((o) => o.value === v))
      : [];

  function toggleMatchValue(v: string) {
    const has = binding.matchValues.includes(v);
    const next = has
      ? binding.matchValues.filter((x) => x !== v)
      : [...binding.matchValues, v];
    onChange({ matchValues: next });
  }

  return (
    <>
      <div>
        <label className="text-xs text-muted-foreground">Bound merge field</label>
        <select
          value={binding.mergeFieldName}
          onChange={(e) => onChange({ mergeFieldName: e.target.value, matchValues: [] })}
          className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
        >
          <option value="">— select —</option>
          {grouped.map((g) => (
            <optgroup key={g.section} label={g.section}>
              {g.entries.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.label} — {`{{${f.slug}}}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {binding.mergeFieldName && (
        <div>
          <label className="text-xs text-muted-foreground">
            Tick checkbox when value is one of
          </label>
          {options ? (
            <div className="mt-1 flex flex-col gap-1 max-h-48 overflow-y-auto border border-border rounded bg-background p-2">
              {options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={binding.matchValues.includes(o.value)}
                    onChange={() => toggleMatchValue(o.value)}
                  />
                  <span>{o.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">{o.value}</span>
                </label>
              ))}
            </div>
          ) : (
            <input
              value={binding.matchValues.join(", ")}
              onChange={(e) =>
                onChange({
                  matchValues: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                })
              }
              placeholder="value1, value2, value3"
              className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-border bg-background"
            />
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Equality match. If the intake value is in this list, the checkbox is ticked.
          </p>
        </div>
      )}

      {unknownMatches.length > 0 && (
        <div className="flex items-start gap-2 p-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            {unknownMatches.length === 1
              ? `Value "${unknownMatches[0]}" is not in this field's option set.`
              : `${unknownMatches.length} values are not in this field's option set.`}
          </span>
        </div>
      )}
    </>
  );
}

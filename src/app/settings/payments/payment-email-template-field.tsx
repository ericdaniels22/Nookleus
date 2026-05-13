"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import TiptapEditor from "@/components/tiptap-editor";
import { ChevronDown, Plus } from "lucide-react";
import { SYSTEM_MERGE_FIELDS } from "@/lib/contracts/merge-fields";
import {
  buildMergeFieldRegistry,
  type MergeFieldDefinition,
} from "@/lib/contracts/merge-field-registry";
import {
  PAYMENT_MERGE_FIELDS,
  PAYMENT_MERGE_FIELD_CATEGORIES,
  paymentMergeFieldsByCategory,
} from "@/lib/payments/merge-fields";
import { MergeFieldNode } from "@/components/contracts/merge-field-node";
import MergeFieldInput, {
  type MergeFieldInputHandle,
} from "@/components/contracts/merge-field-input";
import type { FormConfig } from "@/lib/types";

export interface PaymentEmailTemplateFieldProps {
  label: string;
  description?: string;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}

const PAYMENT_NAMES: Set<string> = new Set(
  PAYMENT_MERGE_FIELDS.map((f) => f.name),
);

export default function PaymentEmailTemplateField({
  label,
  description,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: PaymentEmailTemplateFieldProps) {
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [bodyMenuOpen, setBodyMenuOpen] = useState(false);
  const subjectInputRef = useRef<MergeFieldInputHandle | null>(null);
  const bodyEditorRef = useRef<Editor | null>(null);

  const [registry, setRegistry] = useState<MergeFieldDefinition[]>(
    () => buildMergeFieldRegistry({ sections: [] }, SYSTEM_MERGE_FIELDS),
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/intake-form")
      .then((r) => r.json())
      .then((j: { config?: FormConfig }) => {
        if (cancelled) return;
        const cfg: FormConfig = j?.config ?? { sections: [] };
        setRegistry(buildMergeFieldRegistry(cfg, SYSTEM_MERGE_FIELDS));
      })
      .catch(() => {
        // System-only fallback already set.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvableNames = useMemo(() => {
    const set = new Set<string>(PAYMENT_NAMES);
    for (const f of registry) set.add(f.slug);
    return set;
  }, [registry]);

  const grouped = useMemo(() => groupBySection(registry), [registry]);
  const paymentGrouped = paymentMergeFieldsByCategory();

  function insertIntoSubject(fieldName: string) {
    subjectInputRef.current?.insertMergeField(fieldName);
    setSubjectMenuOpen(false);
  }

  function insertIntoBody(fieldName: string) {
    const editor = bodyEditorRef.current;
    if (!editor) return;
    // Payment templates have no signing_link — always insert a pill node.
    editor
      .chain()
      .focus()
      .insertContent({ type: "mergeField", attrs: { fieldName } })
      .insertContent(" ")
      .run();
    setBodyMenuOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <MergeFieldDropdown
            open={subjectMenuOpen}
            setOpen={setSubjectMenuOpen}
            paymentGrouped={paymentGrouped}
            grouped={grouped}
            onPick={insertIntoSubject}
          />
        </div>
        <MergeFieldInput
          ref={subjectInputRef}
          value={subject}
          onChange={onSubjectChange}
          placeholder="Subject line"
          extraResolvableNames={resolvableNames}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Body</label>
          <MergeFieldDropdown
            open={bodyMenuOpen}
            setOpen={setBodyMenuOpen}
            paymentGrouped={paymentGrouped}
            grouped={grouped}
            onPick={insertIntoBody}
          />
        </div>
        <TiptapEditor
          content={body}
          onChange={onBodyChange}
          placeholder="Email body. Use merge fields to insert data at send time."
          extraExtensions={[
            MergeFieldNode.configure({ extraResolvableNames: resolvableNames }),
          ]}
          onReady={(editor) => {
            bodyEditorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}

interface SectionGroup {
  section: string;
  fields: { name: string; label: string }[];
}

function groupBySection(registry: MergeFieldDefinition[]): SectionGroup[] {
  const order: string[] = [];
  const byName = new Map<string, { name: string; label: string }[]>();
  for (const f of registry) {
    if (!byName.has(f.section)) {
      order.push(f.section);
      byName.set(f.section, []);
    }
    byName.get(f.section)!.push({ name: f.slug, label: f.label });
  }
  return order.map((section) => ({ section, fields: byName.get(section)! }));
}

function MergeFieldDropdown({
  open,
  setOpen,
  paymentGrouped,
  grouped,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  paymentGrouped: ReturnType<typeof paymentMergeFieldsByCategory>;
  grouped: SectionGroup[];
  onPick: (fieldName: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 transition-colors"
      >
        <Plus size={12} /> Merge Field <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 max-h-80 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl z-40 p-2">
          {PAYMENT_MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {paymentGrouped[cat].map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    title={`{{${f.name}}}`}
                    onClick={() => onPick(f.name)}
                    className="merge-field-pill cursor-pointer hover:brightness-110"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {grouped.map((group) => (
            <div key={group.section} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.section}
              </div>
              <div className="flex flex-wrap gap-1">
                {group.fields.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    title={`{{${f.name}}}`}
                    onClick={() => onPick(f.name)}
                    className="merge-field-pill cursor-pointer hover:brightness-110"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

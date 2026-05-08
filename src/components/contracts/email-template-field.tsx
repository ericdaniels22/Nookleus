"use client";

import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import TiptapEditor from "@/components/tiptap-editor";
import { ChevronDown, Plus } from "lucide-react";
import { MERGE_FIELD_CATEGORIES, mergeFieldsByCategory } from "@/lib/contracts/merge-fields";
import { EMAIL_EXTRA_MERGE_FIELDS } from "@/lib/contracts/email-merge-fields";
import { MergeFieldNode } from "@/components/contracts/merge-field-node";
import MergeFieldInput, {
  type MergeFieldInputHandle,
} from "@/components/contracts/merge-field-input";

export interface EmailTemplateFieldProps {
  label: string;
  description?: string;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}

const SIGNING_LINK_HTML = `<a href="{{signing_link}}">Open document</a>`;

export default function EmailTemplateField({
  label,
  description,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: EmailTemplateFieldProps) {
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [bodyMenuOpen, setBodyMenuOpen] = useState(false);
  const subjectInputRef = useRef<MergeFieldInputHandle | null>(null);
  const bodyEditorRef = useRef<Editor | null>(null);

  const grouped = mergeFieldsByCategory();

  function insertIntoSubject(fieldName: string) {
    // Subject is single-line plain text — even signing_link goes in as a
    // pill here. (Recipients rarely click a subject anyway; the body is
    // where the clickable link belongs.)
    subjectInputRef.current?.insertMergeField(fieldName);
    setSubjectMenuOpen(false);
  }

  function insertIntoBody(fieldName: string) {
    const editor = bodyEditorRef.current;
    if (!editor) return;
    if (fieldName === "signing_link") {
      // Special case: insert a clickable anchor whose href contains the
      // token. Resolver swaps `{{signing_link}}` in the href at send time.
      editor.chain().focus().insertContent(SIGNING_LINK_HTML).insertContent(" ").run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent({ type: "mergeField", attrs: { fieldName } })
        .insertContent(" ")
        .run();
    }
    setBodyMenuOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Subject</label>
          <MergeFieldDropdown
            open={subjectMenuOpen}
            setOpen={setSubjectMenuOpen}
            grouped={grouped}
            onPick={insertIntoSubject}
          />
        </div>
        <MergeFieldInput
          ref={subjectInputRef}
          value={subject}
          onChange={onSubjectChange}
          placeholder="Subject line"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Body</label>
          <MergeFieldDropdown
            open={bodyMenuOpen}
            setOpen={setBodyMenuOpen}
            grouped={grouped}
            onPick={insertIntoBody}
          />
        </div>
        <TiptapEditor
          content={body}
          onChange={onBodyChange}
          placeholder="Email body. Use merge fields to insert data at send time."
          extraExtensions={[MergeFieldNode]}
          onReady={(editor) => {
            bodyEditorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}

function MergeFieldDropdown({
  open,
  setOpen,
  grouped,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  grouped: ReturnType<typeof mergeFieldsByCategory>;
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
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Email Context
            </div>
            <div className="flex flex-wrap gap-1">
              {EMAIL_EXTRA_MERGE_FIELDS.map((f) => (
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
          {MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {grouped[cat].map((f) => (
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

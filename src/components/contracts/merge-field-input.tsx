"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import { MergeFieldNode } from "./merge-field-node";
import { tokenizeForEditor } from "./tokenize-for-editor";

export interface MergeFieldInputHandle {
  insertMergeField: (fieldName: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  extraResolvableNames?: Set<string>;
}

const MergeFieldInput = forwardRef<MergeFieldInputHandle, Props>(function MergeFieldInput(
  { value, onChange, placeholder, className, extraResolvableNames },
  ref,
) {
  const lastEmittedRef = useRef<string>("");

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      MergeFieldNode.configure({ extraResolvableNames }),
    ],
    content: tokenizeForEditor(escapeForSingleLine(value)),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          (className ??
            "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]") +
          " merge-field-input-line",
      },
      handleKeyDown(_view, event) {
        // Single-line: swallow Enter so the user can't create a new paragraph.
        if (event.key === "Enter") {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const next = serializeToTokenString(editor.getJSON());
      if (next === lastEmittedRef.current) return;
      lastEmittedRef.current = next;
      onChange(next);
    },
  });

  // Sync external value changes (e.g. parent reset) without losing focus.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(tokenizeForEditor(escapeForSingleLine(value)), {
      emitUpdate: false,
    });
  }, [value, editor]);

  useImperativeHandle(
    ref,
    () => ({
      insertMergeField: (fieldName: string) => {
        if (!editor) return;
        editor
          .chain()
          .focus()
          .insertContent({ type: "mergeField", attrs: { fieldName } })
          .insertContent(" ")
          .run();
      },
      focus: () => {
        editor?.commands.focus();
      },
    }),
    [editor],
  );

  if (!editor) return null;
  return <EditorContent editor={editor} />;
});

export default MergeFieldInput;

// Tiptap's Document/Paragraph wraps content in a single <p>. We need a string
// of the visible text + pills, with `{{token}}` standing in for each pill.
function serializeToTokenString(json: ReturnType<typeof JSON.parse>): string {
  type N = { type: string; text?: string; attrs?: { fieldName?: string }; content?: N[] };
  const out: string[] = [];
  function walk(n: N) {
    if (n.type === "text" && typeof n.text === "string") {
      out.push(n.text);
      return;
    }
    if (n.type === "mergeField" && n.attrs?.fieldName) {
      out.push(`{{${n.attrs.fieldName}}}`);
      return;
    }
    if (n.content) {
      for (const c of n.content) walk(c);
    }
  }
  walk(json as N);
  return out.join("");
}

// HTML-escape characters that would otherwise be parsed as markup when
// passed through tokenizeForEditor, since the saved value is a plain string.
function escapeForSingleLine(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

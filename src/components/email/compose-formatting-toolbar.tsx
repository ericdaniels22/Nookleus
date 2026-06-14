"use client";

import { useEffect, useReducer } from "react";
import { type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Highlighter,
  IndentIncrease,
  IndentDecrease,
  RemoveFormatting,
  Undo,
  Redo,
  Type,
  Baseline,
} from "lucide-react";

const FONT_SIZES = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "16px" },
  { label: "Large", value: "20px" },
  { label: "Huge", value: "28px" },
];

const HIGHLIGHT_COLOR = "#fde68a"; // amber-200

interface ComposeFormattingToolbarProps {
  editor: Editor | null;
  /** Whether the formatting controls are shown (toggled by the "T" button). */
  visible: boolean;
  onToggleVisible: () => void;
}

/**
 * The compose window's bottom formatting toolbar (issue #642). Sits below the
 * message body and above the send bar, driving the shared TiptapEditor through
 * the editor instance handed back via its `onReady` callback. The "T" button
 * collapses the controls to a clean writing surface. This toolbar is compose-
 * only; the shared editor's other consumers keep their own top toolbar.
 */
export default function ComposeFormattingToolbar({
  editor,
  visible,
  onToggleVisible,
}: ComposeFormattingToolbarProps) {
  // Re-render the toolbar on every editor transaction / selection change so the
  // active-state highlighting (bold on, current font size, …) stays in sync.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", bump);
    editor.on("selectionUpdate", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("selectionUpdate", bump);
    };
  }, [editor]);

  function promptLink() {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = prompt("Enter URL:");
    if (url) editor.chain().focus().setLink({ href: url }).run();
  }

  function promptImage() {
    if (!editor) return;
    const url = prompt("Image URL:");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }

  return (
    <div className="shrink-0 border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-0.5 overflow-x-auto px-2 py-1.5">
        <ToolbarButton
          active={visible}
          onClick={onToggleVisible}
          title={visible ? "Hide formatting toolbar" : "Show formatting toolbar"}
        >
          <Type size={15} />
        </ToolbarButton>

        {visible && editor && (
          <>
            <Sep />
            <ToolbarButton
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              <Bold size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <Italic size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive("underline")}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title="Underline"
            >
              <UnderlineIcon size={15} />
            </ToolbarButton>

            <Sep />
            <select
              aria-label="Font size"
              title="Font size"
              value={editor.getAttributes("textStyle").fontSize ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) editor.chain().focus().unsetFontSize().run();
                else editor.chain().focus().setFontSize(v).run();
              }}
              className="h-7 rounded border border-gray-200 bg-white px-1 text-xs text-[#333] outline-none"
            >
              <option value="">Size</option>
              {FONT_SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <label
              title="Font color"
              className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Baseline size={15} />
              <input
                type="color"
                aria-label="Font color"
                value={editor.getAttributes("textStyle").color ?? "#000000"}
                onChange={(e) =>
                  editor.chain().focus().setColor(e.target.value).run()
                }
                className="ml-0.5 h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
            <ToolbarButton
              active={editor.isActive("highlight")}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .toggleHighlight({ color: HIGHLIGHT_COLOR })
                  .run()
              }
              title="Highlight"
            >
              <Highlighter size={15} />
            </ToolbarButton>

            <Sep />
            <ToolbarButton
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Bullet list"
            >
              <List size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="Numbered list"
            >
              <ListOrdered size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() => editor.chain().focus().outdent().run()}
              title="Decrease indent"
            >
              <IndentDecrease size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() => editor.chain().focus().indent().run()}
              title="Increase indent"
            >
              <IndentIncrease size={15} />
            </ToolbarButton>

            <Sep />
            <ToolbarButton
              active={editor.isActive("link")}
              onClick={promptLink}
              title="Link"
            >
              <LinkIcon size={15} />
            </ToolbarButton>
            <ToolbarButton active={false} onClick={promptImage} title="Insert image">
              <ImageIcon size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() =>
                editor.chain().focus().unsetAllMarks().clearNodes().run()
              }
              title="Clear formatting"
            >
              <RemoveFormatting size={15} />
            </ToolbarButton>

            <Sep />
            <ToolbarButton
              active={false}
              onClick={() => editor.chain().focus().undo().run()}
              title="Undo"
            >
              <Undo size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={false}
              onClick={() => editor.chain().focus().redo().run()}
              title="Redo"
            >
              <Redo size={15} />
            </ToolbarButton>
          </>
        )}
      </div>
    </div>
  );
}

function Sep() {
  return <div className="mx-1 h-4 w-px bg-gray-200" />;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded p-1.5 transition-colors ${
        active
          ? "bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

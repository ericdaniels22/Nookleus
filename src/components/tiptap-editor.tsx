"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo,
  Redo,
} from "lucide-react";
import { tokenizeForEditor } from "@/components/contracts/tokenize-for-editor";

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  extraExtensions?: Array<unknown>;
  onReady?: (editor: Editor) => void;
  /**
   * Hide the built-in top toolbar. Opt-in for consumers (e.g. the compose
   * window) that render their own toolbar elsewhere; defaults to false so every
   * existing consumer keeps the top toolbar unchanged.
   */
  hideToolbar?: boolean;
  /**
   * Render content for a fixed light surface instead of following the app
   * theme. Opt-in for consumers (e.g. the compose window) that draw their own
   * always-white canvas: in dark mode the themed `text-foreground` +
   * `dark:prose-invert` would paint light text onto that white canvas, leaving
   * it unreadable. Defaults to false so every existing consumer keeps the
   * theme-aware colors unchanged.
   */
  lightSurface?: boolean;
}

export default function TiptapEditor({
  content,
  onChange,
  placeholder = "Type your message...",
  extraExtensions,
  onReady,
  hideToolbar = false,
  lightSurface = false,
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((extraExtensions ?? []) as any[]),
    ],
    content: tokenizeForEditor(content),
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: [
          "prose prose-sm max-w-none min-h-[160px] px-3 py-2 focus:outline-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1",
          // A fixed light surface keeps the light-mode prose palette (dark text)
          // and pins an explicit dark color; otherwise follow the app theme.
          lightSurface
            ? "text-[#333]"
            : "dark:prose-invert text-foreground",
        ].join(" "),
      },
    },
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  if (!editor) return null;

  function toggleLink() {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
    } else {
      const url = prompt("Enter URL:");
      if (url) {
        editor.chain().focus().setLink({ href: url }).run();
      }
    }
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-[var(--brand-primary)]/30 focus-within:border-[var(--brand-primary)]">
      {/* Toolbar */}
      {!hideToolbar && (
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/50">
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
        <div className="w-px h-4 bg-border mx-1" />
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
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton
          active={editor.isActive("link")}
          onClick={toggleLink}
          title="Link"
        >
          <LinkIcon size={15} />
        </ToolbarButton>
        <div className="w-px h-4 bg-border mx-1" />
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
      </div>
      )}

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
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
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

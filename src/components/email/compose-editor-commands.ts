import type { Editor } from "@tiptap/core";
import { insertTemplateBody } from "@/lib/email/insert-template";

/**
 * Every Tiptap command the compose window wires through a fluent chain — from the
 * bottom formatting toolbar and from this module's own helpers (issue #660). The
 * toolbar reaches these via `editor.chain().focus().<cmd>()`, so a Tiptap upgrade
 * that renames or drops one would only surface when a user clicks the button.
 * compose-editor-commands.test.ts asserts the real compose editor still provides
 * every name here, turning that silent runtime drift into a failing test.
 */
export const COMPOSE_EDITOR_COMMANDS = [
  // Chain entry point.
  "focus",
  // StarterKit marks/nodes the toolbar toggles.
  "toggleBold",
  "toggleItalic",
  "toggleUnderline",
  "toggleBulletList",
  "toggleOrderedList",
  "unsetAllMarks",
  "clearNodes",
  "undo",
  "redo",
  // FontSize (compose rich extensions).
  "setFontSize",
  "unsetFontSize",
  // Color (compose rich extensions).
  "setColor",
  "unsetColor",
  // Highlight (compose rich extensions, multicolor).
  "toggleHighlight",
  "setHighlight",
  // IndentExtension (compose rich extensions).
  "indent",
  "outdent",
  // Image (compose rich extensions).
  "setImage",
  // Link (shared TiptapEditor base).
  "setLink",
  "unsetLink",
  // Document-level commands used by the template/signature helpers below.
  "setContent",
  "insertContent",
] as const;

/**
 * Drop a template's body into the live compose editor at the user's cursor
 * (issue #660: AC #644 wanted at-cursor insertion, not a whole-doc replace).
 *
 * A fresh editor is the one exception: its document is the empty placeholder
 * paragraph, and inserting a block there leaves a stray leading empty paragraph.
 * For that case we replace the whole document via the pure splice helper, which
 * collapses the placeholder (and still tucks the template above a signature
 * region if one is already present). Once the user has typed anything, the
 * template lands exactly where the cursor sits.
 */
export function insertTemplateAtCursor(
  editor: Editor,
  templateHtml: string,
): void {
  if (editor.isEmpty) {
    editor.commands.setContent(
      insertTemplateBody(editor.getHTML(), templateHtml),
      { emitUpdate: false },
    );
    return;
  }
  editor.chain().focus().insertContent(templateHtml).run();
}

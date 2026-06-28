import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { composeRichExtensions } from "./compose-editor-extensions";

// Drives the real IndentExtension through a headless ProseMirror editor wired
// like the compose window, so the node-walk in applyIndent is exercised against
// actual document shapes (issue #660).
function makeEditor(content: string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, ...composeRichExtensions()],
    content,
  });
}

describe("IndentExtension — indent command", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("indents a plain paragraph (renders an inline margin-left)", () => {
    editor = makeEditor("<p>Hello</p>");
    editor.commands.selectAll();
    const applied = editor.commands.indent();
    expect(applied).toBe(true);
    expect(editor.getHTML()).toContain("margin-left");
  });

  it("does not indent a paragraph inside a list item — the list owns its nesting", () => {
    // A bullet item is `listItem > paragraph`; the list already provides the
    // visual indent. Stamping margin-left on the inner paragraph double-indents
    // it (issue #660), so indent must skip list-item children. Collapse the
    // cursor inside the item so only its paragraph is in range.
    editor = makeEditor("<ul><li>Item</li></ul>");
    editor.commands.setTextSelection(4);
    const before = editor.getHTML();
    const applied = editor.commands.indent();
    expect(applied).toBe(false);
    expect(editor.getHTML()).toBe(before);
    expect(editor.getHTML()).not.toContain("margin-left");
  });
});

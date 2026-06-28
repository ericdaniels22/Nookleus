import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { composeRichExtensions } from "./compose-editor-extensions";
import {
  insertTemplateAtCursor,
  COMPOSE_EDITOR_COMMANDS,
} from "./compose-editor-commands";

// A real editor wired exactly like the compose window: the shared TiptapEditor's
// StarterKit + Link base (tiptap-editor.tsx) plus the compose-only rich
// extensions. Instantiating ProseMirror headlessly lets these tests catch
// insertion/command-wiring regressions that the pure string helpers can't — a
// Tiptap command-name drift would otherwise only surface at click time (#660).
function makeEditor(content = "") {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, Link, ...composeRichExtensions()],
    content,
  });
}

describe("insertTemplateAtCursor", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("drops the template into a fresh editor with no stray leading empty paragraph", () => {
    editor = makeEditor("");
    insertTemplateAtCursor(editor, "<p>Template body</p>");
    expect(editor.getHTML()).toBe("<p>Template body</p>");
  });

  it("inserts the template at the cursor, not appended at a fixed end position", () => {
    editor = makeEditor("<p>Hello</p><p>World</p>");
    // Cursor at the very start of the document, before "Hello".
    editor.commands.setTextSelection(1);
    insertTemplateAtCursor(editor, "<p>TPL</p>");
    const html = editor.getHTML();
    expect(html).toContain("TPL");
    expect(html.indexOf("TPL")).toBeLessThan(html.indexOf("Hello"));
  });
});

describe("compose editor command wiring", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("exposes every command the compose toolbar and helpers chain", () => {
    // Guards against a Tiptap upgrade silently renaming/dropping a command the
    // toolbar reaches through chains. If any name in the contract is no longer a
    // callable command on the real editor, this fails instead of the button
    // no-opping in production (issue #660).
    editor = makeEditor("<p>Hello</p>");
    const missing = COMPOSE_EDITOR_COMMANDS.filter(
      (name) => typeof editor.commands[name] !== "function",
    );
    expect(missing).toEqual([]);
  });
});

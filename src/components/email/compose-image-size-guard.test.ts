import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { composeRichExtensions } from "./compose-editor-extensions";
import { ImageSizeGuardExtension } from "./compose-image-size-guard";
import { MAX_INLINE_IMAGE_BYTES } from "@/lib/email/inline-image-limit";

function bigDataUrl() {
  const payload = "A".repeat(Math.ceil((MAX_INLINE_IMAGE_BYTES + 1) * (4 / 3)));
  return `data:image/png;base64,${payload}`;
}
const SMALL_DATA_URL = `data:image/png;base64,${"A".repeat(8)}`;

// Drives the guard through a headless ProseMirror editor wired like the compose
// window — so every image-insertion vector (paste, toolbar button, drop) that
// lands an oversized base64 image in the document is exercised at one chokepoint.
function makeEditor(onReject: () => void) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit,
      ...composeRichExtensions(),
      ImageSizeGuardExtension.configure({ onReject }),
    ],
    content: "<p>Hello</p>",
  });
}

describe("ImageSizeGuardExtension", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("strips an oversized inline base64 image and reports the rejection", () => {
    const onReject = vi.fn();
    editor = makeEditor(onReject);
    editor.chain().focus().setImage({ src: bigDataUrl() }).run();
    expect(editor.getHTML()).not.toContain("<img");
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("keeps a small inline base64 image and reports nothing", () => {
    const onReject = vi.fn();
    editor = makeEditor(onReject);
    editor.chain().focus().setImage({ src: SMALL_DATA_URL }).run();
    expect(editor.getHTML()).toContain("<img");
    expect(onReject).not.toHaveBeenCalled();
  });
});

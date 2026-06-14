import { TextStyle, FontSize, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { IndentExtension } from "./compose-indent-extension";

/**
 * The opt-in rich-formatting extensions for the compose editor's bottom toolbar
 * (issue #642 / PRD #634). Only the compose window passes these into the shared
 * TiptapEditor via its `extraExtensions` prop, so every other consumer of the
 * shared editor (contracts, estimates, signatures, templates, …) is untouched.
 *
 * Underline is intentionally NOT here: StarterKit already enables it in the
 * shared editor, so adding @tiptap/extension-underline would register a
 * duplicate "underline" extension. The bottom toolbar simply wires a button to
 * the toggleUnderline command StarterKit already provides.
 *
 * FontSize and Color both decorate the `textStyle` mark, so TextStyle must be
 * present for them to attach.
 */
export function composeRichExtensions() {
  return [
    TextStyle,
    FontSize,
    Color,
    Highlight.configure({ multicolor: true }),
    Image.configure({ allowBase64: true }),
    IndentExtension,
  ];
}

import { Node, mergeAttributes } from "@tiptap/core";
import {
  SIGNATURE_BLOCK_ATTR,
  SIGNATURE_BLOCK_STYLE,
} from "@/lib/email/signature-swap";

/**
 * A block node that wraps the compose signature in a delimited, marked region
 * (issue #643 / PRD #634). Its only job is to make the `data-signature-block`
 * marker survive Tiptap round-trips: StarterKit has no generic `div` node, so an
 * unmarked wrapper `<div>` (and its attributes) is dropped on parse — which would
 * lose the marker the moment the user edits, leaving the signature impossible to
 * locate and swap. Registering the marked div as a real node preserves it through
 * getHTML(), so the pure signature-swap module can always find the block.
 *
 * Opt-in: only the compose editor loads this via TiptapEditor's extraExtensions
 * (composeRichExtensions), so the shared editor's other consumers are untouched.
 * All locate-and-replace logic lives in the pure, unit-tested signature-swap
 * module; this node is the thin Tiptap shell that guarantees the marker round-
 * trips, mirroring the IndentExtension split.
 */
export const SignatureBlockExtension = Node.create({
  name: "signatureBlock",
  group: "block",
  // Holds the signature's own block content (paragraphs, images, lists, …).
  content: "block+",
  // Keep the signature contained as a unit so edits to the message above don't
  // bleed into or merge with the block.
  defining: true,

  parseHTML() {
    return [{ tag: `div[${SIGNATURE_BLOCK_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        [SIGNATURE_BLOCK_ATTR]: "true",
        style: SIGNATURE_BLOCK_STYLE,
      }),
      0,
    ];
  },
});

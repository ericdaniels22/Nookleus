import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isOversizedInlineImage } from "@/lib/email/inline-image-limit";

export interface ImageSizeGuardOptions {
  /** Called once per transaction in which one or more oversized inline images
   *  were stripped, so the compose window can surface a rejection toast. */
  onReject: (() => void) | null;
}

/**
 * Rejects oversized inline base64 images from the compose body (issue #660). The
 * user chose to reject (not downscale) outsized images, so this guards the one
 * place every insertion vector converges — the document — rather than patching
 * each of paste, the toolbar image button, and drag-drop separately. After any
 * doc-changing transaction it scans for image nodes carrying an over-limit base64
 * payload, removes them, and fires `onReject` so the window can toast. The size
 * decision lives in the pure, unit-tested inline-image-limit module; this is the
 * thin Tiptap shell, mirroring the IndentExtension split.
 *
 * Opt-in: only the compose editor loads this (alongside composeRichExtensions),
 * so the shared editor's other consumers are untouched.
 */
export const ImageSizeGuardExtension = Extension.create<ImageSizeGuardOptions>({
  name: "composeImageSizeGuard",

  addOptions() {
    return { onReject: null };
  },

  addProseMirrorPlugins() {
    const onReject = this.options.onReject;
    return [
      new Plugin({
        key: new PluginKey("composeImageSizeGuard"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const offenders: { from: number; to: number }[] = [];
          newState.doc.descendants((node, pos) => {
            if (
              node.type.name === "image" &&
              isOversizedInlineImage(node.attrs.src as string)
            ) {
              offenders.push({ from: pos, to: pos + node.nodeSize });
            }
          });
          if (offenders.length === 0) return null;
          const tr = newState.tr;
          // Delete back-to-front so earlier positions stay valid as we splice.
          for (const { from, to } of offenders.reverse()) {
            tr.delete(from, to);
          }
          onReject?.();
          return tr;
        },
      }),
    ];
  },
});

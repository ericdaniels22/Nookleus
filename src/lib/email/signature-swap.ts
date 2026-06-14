// Signature-swap math for the compose editor (issue #643 / PRD #634). Switching
// the From account — or picking a different signature — must replace ONLY the
// signature block and leave the user's typed message intact. Kept pure and free
// of React/Tiptap so the locate-and-replace logic can be unit-tested in
// isolation. The Tiptap SignatureBlock node is the thin shell: it preserves the
// delimited region's marker across editor round-trips so this module can always
// find the block to swap.

/** Attribute that marks the delimited signature region in the body HTML. */
export const SIGNATURE_BLOCK_ATTR = "data-signature-block";

/** Inline styling for the signature region. Inlined as a style so the visual
 *  separator survives into the sent email's HTML, not just the editor view. */
export const SIGNATURE_BLOCK_STYLE =
  "border-top: 1px solid #ccc; padding-top: 8px; margin-top: 16px; color: #666;";

/** Wrap raw signature HTML in the delimited region the compose body uses, so it
 *  can be located and swapped without touching the user's typed content. */
export function renderSignatureRegion(signatureHtml: string): string {
  return `<div ${SIGNATURE_BLOCK_ATTR}="true" style="${SIGNATURE_BLOCK_STYLE}">${signatureHtml}</div>`;
}

const REGION_OPEN_RE = new RegExp(
  `<div\\b[^>]*\\b${SIGNATURE_BLOCK_ATTR}\\b[^>]*>`,
  "i",
);

const DIV_TAG_RE = /<\/?div\b[^>]*>/gi;

/** Locate the signature region in `bodyHtml`. Returns the char range of the
 *  whole `<div data-signature-block …>…</div>`, or null when there is none.
 *  Depth-aware so nested `<div>`s inside the signature (e.g. a logo block) do
 *  not end the region early, and a quoted reply below it is never consumed. */
function findRegion(bodyHtml: string): { start: number; end: number } | null {
  const open = REGION_OPEN_RE.exec(bodyHtml);
  if (!open) return null;
  const start = open.index;
  let depth = 1;
  DIV_TAG_RE.lastIndex = start + open[0].length;
  let tag: RegExpExecArray | null;
  while ((tag = DIV_TAG_RE.exec(bodyHtml)) !== null) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return { start, end: tag.index + tag[0].length };
  }
  return null;
}

/** Return body HTML with its signature region replaced by `nextSignatureHtml`
 *  (or removed when null/empty), preserving all other content. */
export function swapSignature(
  bodyHtml: string,
  nextSignatureHtml: string | null,
): string {
  const hasSig = nextSignatureHtml != null && nextSignatureHtml.trim() !== "";
  const region = findRegion(bodyHtml);
  if (region) {
    const before = bodyHtml.slice(0, region.start);
    const after = bodyHtml.slice(region.end);
    return hasSig ? before + renderSignatureRegion(nextSignatureHtml!) + after : before + after;
  }
  return hasSig ? bodyHtml + renderSignatureRegion(nextSignatureHtml!) : bodyHtml;
}

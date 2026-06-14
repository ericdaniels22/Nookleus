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

// Match a single `<div …>` opening tag and capture its raw attribute list.
const DIV_OPEN_RE = /<div\b([^>]*)>/gi;
const DIV_TAG_RE = /<\/?div\b[^>]*>/gi;

// Walk the attribute LIST of one tag, capturing each attribute name (group 1)
// while consuming any quoted/unquoted value so a marker substring buried inside
// a value is never mistaken for an attribute name. `[^\s=/>]+` requires at
// least one char, so the global scan always advances and never loops.
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

/** True when the tag's attribute list contains the `data-signature-block`
 *  marker as an attribute NAME — not as a substring inside another attribute's
 *  value, and not as a hyphenated suffix like `data-signature-block-foo`. HTML
 *  attribute names are case-insensitive; the marker we emit is lowercase. */
function attrsHaveMarker(attrs: string): boolean {
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrs)) !== null) {
    if (m[1].toLowerCase() === SIGNATURE_BLOCK_ATTR) return true;
  }
  return false;
}

/** Locate the opening `<div …>` tag of the signature region: the first div
 *  whose attributes include the real marker. Keying on the marker as an
 *  attribute name (not a loose substring) is what keeps pasted/quoted email
 *  HTML that merely contains the substring from being treated as the region. */
function findRegionOpen(
  bodyHtml: string,
): { index: number; length: number } | null {
  DIV_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIV_OPEN_RE.exec(bodyHtml)) !== null) {
    if (attrsHaveMarker(m[1])) return { index: m.index, length: m[0].length };
  }
  return null;
}

/** Locate the signature region in `bodyHtml`. Returns the char range of the
 *  whole `<div data-signature-block …>…</div>`, or null when there is none.
 *  Depth-aware so nested `<div>`s inside the signature (e.g. a logo block) do
 *  not end the region early, and a quoted reply below it is never consumed.
 *  Shared by the signature-swap and template-insert paths so a single matcher
 *  decides where the region is (issue #656). */
export function findSignatureRegion(
  bodyHtml: string,
): { start: number; end: number } | null {
  const open = findRegionOpen(bodyHtml);
  if (!open) return null;
  const start = open.index;
  let depth = 1;
  DIV_TAG_RE.lastIndex = start + open.length;
  let tag: RegExpExecArray | null;
  while ((tag = DIV_TAG_RE.exec(bodyHtml)) !== null) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return { start, end: tag.index + tag[0].length };
  }
  return null;
}

/** True when `bodyHtml` already contains a signature region. Lets the compose
 *  shell treat a resumed draft as authoritative instead of prepending a second
 *  region (issue #656). */
export function hasSignatureRegion(bodyHtml: string): boolean {
  return findSignatureRegion(bodyHtml) !== null;
}

/** Remove every signature region from `html`, leaving all other content. */
function stripRegions(html: string): string {
  let out = html;
  let region = findSignatureRegion(out);
  while (region) {
    out = out.slice(0, region.start) + out.slice(region.end);
    region = findSignatureRegion(out);
  }
  return out;
}

/** Return body HTML with its signature region replaced by `nextSignatureHtml`
 *  (or removed when null/empty), preserving all other content. Always yields AT
 *  MOST ONE region: the first region is replaced and any further regions are
 *  stripped, so an orphaned or duplicated region (e.g. from a deleted node or a
 *  legacy double-inserted draft) can never accumulate or ship (issue #656). */
export function swapSignature(
  bodyHtml: string,
  nextSignatureHtml: string | null,
): string {
  const hasSig = nextSignatureHtml != null && nextSignatureHtml.trim() !== "";
  const region = findSignatureRegion(bodyHtml);
  if (region) {
    const before = bodyHtml.slice(0, region.start);
    const after = stripRegions(bodyHtml.slice(region.end));
    return hasSig
      ? before + renderSignatureRegion(nextSignatureHtml!) + after
      : before + after;
  }
  return hasSig ? bodyHtml + renderSignatureRegion(nextSignatureHtml!) : bodyHtml;
}

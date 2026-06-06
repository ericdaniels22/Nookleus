/**
 * A Photo Report Section's write-up is the one-page rich-text narrative stored
 * in the Section's `description` field (see CONTEXT.md and ADR 0009). The field
 * predates rich text, so what is actually on disk varies:
 *
 *   - a missing value (legacy rows, or a never-edited Section)
 *   - a legacy one-line plain-text subtitle (pre-rework reports)
 *   - new rich-text HTML authored in the TipTap editor (post-rework)
 *
 * `normalizeSectionWriteup` is the single, tested boundary that reads that messy
 * field and returns one canonical shape: HTML in the subset
 * `src/lib/pdf-renderer/html-to-pdf.tsx` understands (so a later slice can feed
 * the result straight to `htmlToPdfNodes`). Nothing renders this yet — it is the
 * read-tolerance foundation the narrative slices build on.
 */

// A value is treated as already-rich-text only when it OPENS one of the tags the
// bare-StarterKit editor actually emits. Genuine editor output always opens a
// block first, so an opening tag from this set is a reliable "this is HTML"
// signal. Folded-to-plain tags (a heading, a code block) are included so they
// still reach `htmlToPdfNodes` as HTML rather than be shown to the customer as
// literal `<h2>…</h2>` source. Everything else is legacy plain text and gets
// escaped and wrapped as a single paragraph — crucially, an unrecognized
// `<…>` (a bracketed email `<john@x.com>`, prose like `use <div>`) or a stray
// CLOSING tag (`</p>`) no longer masquerades as markup, so the PDF tokenizer
// can never silently drop it (issue #445). Matching openers only — no leading
// `/` — is what keeps `</p>` on the plain-text branch.
const HTML_TAG =
  /<(?:p|ul|ol|li|h[1-6]|strong|b|em|i|br|pre|code|blockquote|hr)\b[^>]*>/i;

export function normalizeSectionWriteup(
  description: string | null | undefined,
): string {
  const trimmed = description?.trim();
  if (!trimmed) return "";
  if (HTML_TAG.test(trimmed)) return trimmed;
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped}</p>`;
}

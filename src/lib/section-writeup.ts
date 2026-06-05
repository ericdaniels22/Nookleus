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

// A value is treated as already-rich-text when it contains ANY HTML tag — not
// just the subset we render richly. The editor is bare StarterKit, so a write-up
// can be made entirely of tags we fold to plain text downstream (a heading, a
// code block); those must still reach `htmlToPdfNodes` as HTML rather than be
// escaped and shown to the customer as literal `<h2>…</h2>` source. Anything with
// no tag is a legacy plain-text line that gets escaped and wrapped as a single
// paragraph. The `[a-z]` after `<` keeps stray prose like "a < b" from matching.
const HTML_TAG = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;

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

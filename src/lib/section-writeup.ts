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

// A value is treated as already-rich-text when it contains any tag from the
// subset `htmlToPdfNodes` understands. Anything else is a legacy plain-text
// line that gets escaped and wrapped as a single paragraph. The `\b` keeps
// stray prose like "a < b" from looking like a tag.
const RICH_TEXT_TAG = /<\/?(p|ul|ol|li|strong|b|em|i|br)\b[^>]*>/i;

export function normalizeSectionWriteup(
  description: string | null | undefined,
): string {
  const trimmed = description?.trim();
  if (!trimmed) return "";
  if (RICH_TEXT_TAG.test(trimmed)) return trimmed;
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped}</p>`;
}

/**
 * The one-page fit check for a Photo Report Section write-up.
 *
 * A Section's write-up renders as a single PDF intro page (see ADR 0009 and
 * `src/components/report-pdf/section-divider-page.tsx`). Rather than measure the
 * PDF live — the on-screen editor and `@react-pdf` lay text out differently — the
 * cap is a conservatively tuned character budget over the write-up's *visible*
 * text. This module is the single source of truth for that budget: the builder's
 * live per-Section counter and its save-time guard both read it.
 *
 * It measures the SAME string the PDF renders — `normalizeSectionWriteup(html)`,
 * the exact value `section-divider-page` feeds `htmlToPdfNodes` — so a legacy
 * one-line plain-text subtitle (which the normalizer escapes and wraps) is
 * counted as the characters it actually renders, not mistaken for markup. Tags
 * are dropped with the same pattern the renderer's tokenizer recognizes (a bare
 * "<" that is not a real tag is kept, as the PDF keeps it), and entities decode
 * to the single glyph they render.
 *
 * Deliberate imprecision (accepted per ADR 0009, "a conservatively tuned
 * character limit … not pixel-exact"):
 *   - It counts characters, not lines. A write-up made of many short bullets or
 *     hard breaks can still spill onto a second page well under the character
 *     cap; the budget errs lax (it never wrongly blocks content that fits)
 *     rather than risk blocking a write-up that would actually fit.
 *   - Whitespace runs collapse to one space (mirroring HTML layout), whereas
 *     @react-pdf keeps them verbatim. This only ever under-counts, so it cannot
 *     wrongly block, and intra-line whitespace wraps rather than adding height.
 */

import { normalizeSectionWriteup } from "./section-writeup";

/** Visible characters that comfortably fit on one Section intro page. */
export const WRITEUP_CHARACTER_LIMIT = 1500;

// Match real tags the same way `html-to-pdf`'s tokenizer does: "<" (optionally
// "/") immediately followed by a letter. A stray "<" in prose ("gap was < 2in")
// is left intact, exactly as the renderer leaves it, so the count never eats
// visible text the way a greedy `/<[^>]+>/` would.
const HTML_TAG = /<\/?[a-z][a-z0-9]*\b[^>]*>/gi;

export interface WriteupFit {
  /** Visible characters the write-up uses (markup and entities excluded). */
  used: number;
  /** The one-page budget the write-up is measured against. */
  limit: number;
  /** True while the write-up fits within the budget (`used <= limit`). */
  fits: boolean;
  /** Characters left before the cap; goes negative once over. */
  remaining: number;
}

/** Count the visible text characters of normalized write-up HTML. */
function visibleLength(html: string): number {
  const text = html
    .replace(HTML_TAG, "") // drop real tags; a stray "<" is kept, as the PDF keeps it
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ") // HTML collapses whitespace runs to one space
    .trim();
  return text.length;
}

/**
 * Measure how full a Section write-up is against the one-page character budget.
 * `limit` defaults to {@link WRITEUP_CHARACTER_LIMIT} but is overridable so the
 * counter, the guard, and tests all share one calculation. The write-up is run
 * through {@link normalizeSectionWriteup} first, so it is measured as exactly the
 * string the PDF renderer receives.
 */
export function measureWriteupFit(
  writeup: string | null | undefined,
  limit: number = WRITEUP_CHARACTER_LIMIT,
): WriteupFit {
  const used = visibleLength(normalizeSectionWriteup(writeup));
  return { used, limit, fits: used <= limit, remaining: limit - used };
}

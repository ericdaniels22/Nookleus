// Font-color control model for the compose toolbar (issue #660). Kept pure and
// free of React/Tiptap so the "automatic vs. explicit color" logic is unit-
// testable in isolation.

/** Neutral swatch shown when no text color is set. Matches the compose body's
 *  default ink (#333) rather than pure black, so the picker doesn't imply black
 *  is already applied — and a stray pick is a deliberate dark grey, not a
 *  surprise #000000 stamp. */
export const AUTOMATIC_FONT_COLOR_SWATCH = "#333333";

/**
 * Build the font-color control's `{ value, isSet }` for the current selection.
 *
 * A native `<input type="color">` always carries a value and can't express "no
 * color", so an unset selection reads as #000000 and a stray click stamps pure
 * black onto text meant to stay the document default. We surface the real state:
 * `isSet` tells the UI whether an explicit color is applied (so it can show a
 * clear/automatic affordance), and `value` falls back to a neutral swatch — never
 * #000000 — when nothing is set.
 */
export function fontColorControlModel(
  currentColor: string | null | undefined,
): { value: string; isSet: boolean } {
  if (!currentColor) {
    return { value: AUTOMATIC_FONT_COLOR_SWATCH, isSet: false };
  }
  return { value: currentColor, isSet: true };
}

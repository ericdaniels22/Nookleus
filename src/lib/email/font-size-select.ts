// Font-size <select> model for the compose toolbar (issue #660). Kept pure and
// free of React/Tiptap so the desync logic can be unit-tested in isolation.

export interface FontSizeOption {
  label: string;
  value: string;
}

/**
 * Build the font-size control's `{ value, options }` for the current selection.
 *
 * A controlled `<select>` whose bound value isn't among its options desyncs: the
 * browser snaps the display to the first option, so a custom size (pasted HTML,
 * a size set in another editor) reads as a preset — and the next change silently
 * rewrites the real size to one the user never picked. When the current size
 * isn't a preset we append it as its own option so the control reflects it
 * honestly. An unset size selects the empty (placeholder) value.
 */
export function fontSizeSelectModel(
  currentFontSize: string | undefined | null,
  presets: FontSizeOption[],
): { value: string; options: FontSizeOption[] } {
  const size = currentFontSize ?? "";
  if (!size || presets.some((p) => p.value === size)) {
    return { value: size, options: presets };
  }
  return { value: size, options: [...presets, { label: size, value: size }] };
}

// Alpha for the full-row account-color wash in the mixed All-Inboxes list
// (#955). Kept low so a saturated stored account color reads as a subtle tint
// over the dark row rather than a solid fill (design-system §2.6 tint spirit).
const WASH_ALPHA = 0.1;

/**
 * Soften a stored account hex color into a low-alpha `rgba(...)` wash string,
 * suitable for an inline `background-color`. Returns `undefined` when there is
 * no usable hex so callers can simply omit the wash (e.g. filtered to a single
 * account, or a color that isn't a plain hex).
 *
 * Accepts `#RGB` and `#RRGGBB` (any case). Anything else → `undefined`.
 */
export function accountRowWash(
  color: string | null | undefined,
): string | undefined {
  if (!color) return undefined;

  let hex = color.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${WASH_ALPHA})`;
}

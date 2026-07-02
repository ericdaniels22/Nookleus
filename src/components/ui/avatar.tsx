import { initials } from "@/lib/contact-name";
import { cn } from "@/lib/utils";

/**
 * Initials avatar (design-system §5): a monogram on the `--popover` overlay-
 * surface circle with `--accent-text` letters. `size` picks the two documented
 * footprints — `row` (28px, in list rows) and `header` (36px, in page/detail
 * headers). The full name is the element's accessible label so it reads as an
 * image to assistive tech; the visible glyphs come from `initials()`.
 *
 * `decorative` drops the `img` role and label and marks the circle
 * `aria-hidden` — use it when the name is already spelled out in adjacent
 * visible text (e.g. a conversation row), so the avatar doesn't duplicate that
 * text in the accessible name of a wrapping control.
 */
export function Avatar({
  name,
  size = "row",
  decorative = false,
  className,
}: {
  name: string;
  size?: "row" | "header";
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      data-size={size}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-popover font-medium text-accent-text select-none",
        size === "header" ? "size-9 text-sm" : "size-7 text-xs",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

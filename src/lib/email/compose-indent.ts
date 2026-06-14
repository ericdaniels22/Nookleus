// Indent-level math for the compose editor's indent/outdent commands
// (issue #642 / PRD #634 — bottom formatting toolbar). Kept pure and free of
// React/Tiptap so the level transitions and their clamping can be unit-tested
// in isolation. The Tiptap IndentExtension is a thin shell: it stores an integer
// `indent` level on block nodes, delegates each step to nextIndentLevel(), and
// renders the level into an inline margin-left (indentToMarginPx) so the
// indentation survives into the sent email's HTML — not just the editor view.

export type IndentDirection = "indent" | "outdent";

/** Deepest indent the compose editor allows (8 steps ≈ a sane Outlook-style cap). */
export const MAX_INDENT_LEVEL = 8;

/** Left margin (px) added per indent level. Inlined as a style so the
 *  indentation survives into the sent email's HTML, not just the editor view. */
export const INDENT_STEP_PX = 24;

export function nextIndentLevel(
  current: number,
  direction: IndentDirection,
): number {
  const base = Number.isFinite(current) ? current : 0;
  const raw = direction === "indent" ? base + 1 : base - 1;
  return Math.min(MAX_INDENT_LEVEL, Math.max(0, raw));
}

/** Left margin in px for a given indent level (0 at level 0). */
export function indentToMarginPx(level: number): number {
  const safe = Number.isFinite(level) ? Math.max(0, level) : 0;
  return safe * INDENT_STEP_PX;
}

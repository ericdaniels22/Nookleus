// Keyboard + initial-focus chrome for the floating compose window (issue #660).
//
// Compose used to be a Base UI Dialog, which handed us Escape-to-close and
// initial focus for free. The move to a bespoke floating window (issue #638)
// dropped both. These pure helpers restore the decisions — where focus lands on
// open, and what Escape should do — so they can be unit-tested apart from the
// React wiring, mirroring the compose-window-state reducer next door.

export type ComposeMode = "compose" | "reply" | "forward";

/** Where keyboard focus should land when the compose window opens. */
export type InitialFocusTarget = "body" | "to";

/**
 * Decide the initial focus target. A reply or forward already carries its
 * recipients, so the user wants to start typing the message — focus the body.
 * A fresh compose with no recipient should start in the first field (To); but if
 * it was opened with a recipient prefilled (e.g. "email this contact"), the body
 * is the natural starting point there too.
 */
export function initialFocusTarget({
  mode,
  hasPrefilledRecipient,
}: {
  mode: ComposeMode;
  hasPrefilledRecipient: boolean;
}): InitialFocusTarget {
  if (mode === "reply" || mode === "forward") return "body";
  return hasPrefilledRecipient ? "body" : "to";
}

/** What an Escape keypress inside the compose window should do. */
export type ComposeEscapeIntent = "dismiss-overlay" | "close-window";

/**
 * Decide how Escape resolves. The inner pickers (contact / signature / template)
 * render inline, so their Escape bubbles to the window. Peel an open overlay off
 * first; only close the whole window once nothing is layered on top — the
 * layered dismissal the Base UI Dialog used to provide.
 */
export function composeEscapeIntent({
  anyOverlayOpen,
}: {
  anyOverlayOpen: boolean;
}): ComposeEscapeIntent {
  return anyOverlayOpen ? "dismiss-overlay" : "close-window";
}

// Issue #520 — the pure rule for which PhotoViewer layout a viewport gets.
//
// Below this width the viewer switches to its phone layout (a full-bleed Photo
// with slide-up action panels); at or above it, the desktop side-panel layout.
// A non-positive width — server render or an unmeasured viewport — is treated as
// desktop so the richer layout is the default until a real width is known (and
// so jsdom's default 1024 keeps component tests on the desktop layout). Kept
// free of React/DOM so the rule lives in one tested place, mirroring the other
// pure viewer modules (navigation, media-capabilities, zoom-transform).

/** Widths narrower than this (in CSS px) get the phone layout — Tailwind's md. */
export const PHONE_MAX_WIDTH = 768;

/** Whether a viewport of `width` CSS px should render the viewer's phone layout. */
export function isPhoneViewport(width: number): boolean {
  return width > 0 && width < PHONE_MAX_WIDTH;
}

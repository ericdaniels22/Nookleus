// Issue #812 — the one pure place that knows where a Label pill sits relative to
// its host Annotation and what text colour stays legible on the pill fill. Any
// Annotation (Arrow, shape, polyline, freehand, text) can carry a single Label;
// the annotator's `after:render` hook recomputes the anchor every frame so the
// pill stays glued beneath the host as it moves, scales, or rotates, and burns
// the pill into the flattened Annotated Photo. Kept free of Fabric/React/DOM so
// the positioning math lives in exactly one tested place.

/**
 * The gap, in canvas pixels, between the host object's (post-transform) bottom
 * edge and the top of the Label pill. A small constant so the pill reads as
 * attached without crowding the Annotation.
 */
export const LABEL_GAP = 12;

/**
 * The host Annotation's transform, as Fabric reports it: the object's centre
 * point, its unscaled width/height, its per-axis scale, and its rotation in
 * degrees (Fabric's convention — clockwise, since canvas Y points down).
 */
export interface LabelHostBox {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angle: number;
}

/**
 * The anchor point a Label pill hangs from: the top-centre of the pill, placed
 * just below the host's bounding box and horizontally centred on it. The offset
 * is the host's scaled half-height plus a constant gap, taken straight down in
 * the host's own frame and then rotated by the host's angle — so for a rotated
 * object the pill swings around to stay beneath the object rather than the
 * screen. Mirrors Fabric's own rotation matrix ([cos, sin, -sin, cos]) so the
 * anchor lands exactly where Fabric draws the object.
 */
export function labelAnchorPoint(
  box: LabelHostBox,
  gap: number = LABEL_GAP
): { x: number; y: number } {
  const halfHeight = (box.height * box.scaleY) / 2;
  const offset = halfHeight + gap;
  const theta = (box.angle * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Rotate the local straight-down offset (0, offset) by the host's angle.
  return {
    x: box.centerX - offset * sin,
    y: box.centerY + offset * cos,
  };
}

/**
 * The Label font size, in canvas pixels, given to a freshly-labelled object. A
 * constant so a typed Label and a tapped Quick-pick label read identically.
 */
export const DEFAULT_LABEL_FONT_SIZE = 20;

/**
 * The subset of an Annotation that carries its single Label. Any Fabric object
 * satisfies this (the props are stored as custom props), but the shape is kept
 * plain so the apply logic stays Fabric-free and testable.
 */
export interface LabelTarget {
  labelText: string | null;
  labelColor: string | null;
  labelFontSize?: number;
}

/**
 * Set, replace, or clear an Annotation's single Label. A non-blank phrase
 * becomes the object's one Label — trimmed, in the given colour, sized to the
 * object's existing Label size or the default — overwriting any prior Label
 * rather than adding a second. A blank phrase clears the Label. Both the typed
 * Label editor and the Quick-pick tap route through here so the two produce an
 * identical result.
 */
export function applyLabel(
  target: LabelTarget,
  text: string,
  color: string
): void {
  const trimmed = text.trim();
  if (trimmed) {
    target.labelText = trimmed;
    target.labelColor = color;
    target.labelFontSize = target.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
  } else {
    target.labelText = null;
  }
}

/** Near-black, matching the annotator palette's Black swatch. */
const DARK_TEXT = "#1A1A1A";
const LIGHT_TEXT = "#FFFFFF";

/**
 * The text colour that stays legible drawn on a pill of the given fill: dark
 * text on light fills, white text on dark fills. Picks by the fill's perceived
 * luminance (Rec. 601 weighting) against a midpoint threshold that keeps the
 * light palette swatches (Yellow, White) on dark text and the rest on white.
 * Accepts a 3- or 6-digit hex with or without a leading `#`.
 */
export function readableTextColor(fill: string): string {
  const hex = fill.replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? DARK_TEXT : LIGHT_TEXT;
}

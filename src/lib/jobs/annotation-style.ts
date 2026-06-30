// Issue #815 — the pure logic behind the color + thickness editor for a
// selected Annotation. The annotator shell reads the selected Fabric object's
// current style to pre-highlight the controls, and writes a new color/thickness
// back onto that same object in place (never delete-and-recreate).

import { annotationKind, type AnnotationKind } from "./annotation-toolbar";

/** The minimal shape of a selected Fabric object this module reads. */
export interface ReadableTarget {
  type?: string | null;
  [key: string]: unknown;
}

/** A selected Fabric object this module both reads and mutates in place. */
export interface StyleTarget extends ReadableTarget {
  set(key: string, value: unknown): void;
}

/** A pickable color in the palette. */
export interface ColorChoice {
  value: string;
  label: string;
}

/** A pickable line thickness in the palette. */
export interface ThicknessChoice {
  value: number;
  label: string;
}

/**
 * The single palette shared by both new-markup defaults and the editor for a
 * selected Annotation, so a swatch picked in either place means the same thing.
 */
export const ANNOTATION_COLORS: ColorChoice[] = [
  { value: "#F59E0B", label: "Yellow" },
  { value: "#C41E2A", label: "Red" },
  { value: "#2B5EA7", label: "Blue" },
  { value: "#0F6E56", label: "Green" },
  { value: "#FFFFFF", label: "White" },
  { value: "#1A1A1A", label: "Black" },
];

/** The three thickness steps shared by new markup and the editor. */
export const ANNOTATION_THICKNESSES: ThicknessChoice[] = [
  { value: 2, label: "Thin" },
  { value: 4, label: "Medium" },
  { value: 8, label: "Thick" },
];

/**
 * The property an Annotation of this Fabric type stores its color under. An
 * Arrow keeps its own `arrowColor` (a custom prop that also tints its
 * arrowhead); every other styleable kind uses Fabric's `stroke`.
 */
function colorProperty(fabricType: string | null | undefined): "arrowColor" | "stroke" {
  return annotationKind(fabricType) === "arrow" ? "arrowColor" : "stroke";
}

/**
 * The property an Annotation of this Fabric type stores its line thickness
 * under. An Arrow keeps `arrowThickness` (which also drives its arrowhead size);
 * every other styleable kind uses Fabric's `strokeWidth`.
 */
function thicknessProperty(
  fabricType: string | null | undefined,
): "arrowThickness" | "strokeWidth" {
  return annotationKind(fabricType) === "arrow" ? "arrowThickness" : "strokeWidth";
}

/**
 * Whether a selected Annotation of this kind gets the color/thickness editor.
 * Every drawn line/shape does; a text box is excluded (it carries its own text
 * styling), and a Numbered marker is excluded (#816) — a fixed-radius badge has
 * no stroke weight to re-thicken and takes its color from the active color at
 * drop time, not from a post-hoc editor. A non-Annotation selection (`null` —
 * the background image or an unknown object) is excluded too.
 */
export function supportsStyleEditor(kind: AnnotationKind | null): boolean {
  return kind !== null && kind !== "text" && kind !== "marker";
}

/** Repaint the selected Annotation to `color`, mutating it in place. */
export function applyColor(target: StyleTarget, color: string): void {
  target.set(colorProperty(target.type), color);
}

/** Re-weight the selected Annotation to `thickness`, mutating it in place. */
export function applyThickness(target: StyleTarget, thickness: number): void {
  target.set(thicknessProperty(target.type), thickness);
}

/** The selected Annotation's current color, for pre-highlighting the editor. */
export function currentColor(target: ReadableTarget): string {
  return target[colorProperty(target.type)] as string;
}

/** The selected Annotation's current thickness, for pre-highlighting the editor. */
export function currentThickness(target: ReadableTarget): number {
  return target[thicknessProperty(target.type)] as number;
}

/**
 * How much longer than its line thickness an Arrow's arrowhead is drawn. The
 * FabricArrow render uses this same factor at creation, so changing only
 * `arrowThickness` rescales the head through one shared relationship.
 */
export const ARROW_HEAD_LENGTH_FACTOR = 4;

/** The arrowhead length for a given line thickness — proportional, no offset. */
export function arrowHeadLength(thickness: number): number {
  return thickness * ARROW_HEAD_LENGTH_FACTOR;
}

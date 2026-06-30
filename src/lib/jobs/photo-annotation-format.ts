// Issue #805 — the one pure place that reads and writes a Photo's stored
// annotation markup. `parseAnnotations` migrates any of the three historical
// stored shapes (format 3, version 2, version 1) into a uniform array of Fabric
// object descriptors; `serializeAnnotations` wraps the current markup objects
// back into the stored envelope. Kept free of Fabric/React/DOM so the format
// logic lives in exactly one tested place — the annotator's load path reads
// `parseAnnotations` and its save path reads `serializeAnnotations`.

/**
 * The custom properties Annotations carry beyond Fabric's built-ins. This is the
 * single source of truth: each Annotation subclass's `customProperties` allowlist
 * and the save path's `toJSON` projection both read it, so the set of persisted
 * fields is defined in exactly one place. A given subclass only writes the props
 * it owns — a FabricArrow writes the `x1..arrowThickness` group, a Numbered
 * marker (#816) writes `markerNumber`/`markerColor` — while the shared Label
 * fields (`labelText`, `labelFontSize`, `labelColor`) belong to ANY Annotation
 * that carries an attached Label (#812). The projection list is shared so one
 * `toJSON([...ANNOTATION_CUSTOM_PROPS])` call serializes every kind, and `toJSON`
 * projects only the props an object actually has, so an unlabeled shape stays
 * free of stray Label keys.
 */
export const ANNOTATION_CUSTOM_PROPS = [
  "x1",
  "y1",
  "x2",
  "y2",
  "arrowColor",
  "labelText",
  "labelFontSize",
  "labelColor",
  "arrowThickness",
  "markerNumber",
  "markerColor",
] as const;

/** A single serialized Fabric object descriptor (a Rect, FabricArrow, etc.). */
export type Annotation = { type?: string; [key: string]: unknown };

/** The stored markup envelope (the `annotation_data` column's current shape). */
export interface AnnotationData {
  format: 3;
  canvas: { version: string; objects: Annotation[] };
}

// The Fabric JSON `version` stamp. Purely informational metadata — Fabric
// reconstructs from `objects` and `parseAnnotations` ignores it — pinned to the
// fabric major in use so the stored shape stays self-describing.
const FABRIC_JSON_VERSION = "7.2.0";

/**
 * Wrap the canvas's current markup objects into the stored envelope. This owns
 * ONLY the markup blob — the flattened "Annotated Photo" PNG is a separate
 * write (ADR 0024), and the background photo is reattached fresh on load, so it
 * is deliberately not carried here.
 */
export function serializeAnnotations(objects: Annotation[]): AnnotationData {
  return { format: 3, canvas: { version: FABRIC_JSON_VERSION, objects } };
}

/** A version-2 stored arrow: explicit endpoints, optional color and label. */
type LegacyArrow = {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  color?: string;
  label?: { text?: string; fontSize?: number };
};

export function parseAnnotations(stored: unknown): Annotation[] {
  if (!stored || typeof stored !== "object") return [];
  const saved = stored as Record<string, unknown>;

  // ── Format 3: native Fabric JSON (current format) ──
  if (saved.format === 3 && saved.canvas) {
    const canvas = saved.canvas as { objects?: Annotation[] };
    return canvas.objects ?? [];
  }

  // ── Version 2: explicit arrow data alongside other objects ──
  if (saved.version === 2) {
    const result: Annotation[] = [];

    if (Array.isArray(saved.arrows)) {
      for (const a of saved.arrows as LegacyArrow[]) {
        result.push({
          type: "FabricArrow",
          x1: a.x1,
          y1: a.y1,
          x2: a.x2,
          y2: a.y2,
          arrowColor: a.color || "#F59E0B",
          labelText: a.label?.text || null,
          labelFontSize: a.label?.fontSize || 20,
          arrowThickness: 6,
        });
      }
    }

    if (Array.isArray(saved.objects)) {
      result.push(...(saved.objects as Annotation[]));
    }

    return result;
  }

  // ── Version 1: raw canvas dump where arrows were stored as a stroked Path
  // followed by its two white Circle endpoint handles. Collapse each such
  // triple back into one FabricArrow; everything else survives in order, with
  // the recovered arrows appended last (matching the original load order). ──
  const objects = Array.isArray(saved.objects)
    ? (saved.objects as Annotation[])
    : [];
  const survivors: Annotation[] = [];
  const arrows: Annotation[] = [];

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const n1: Annotation | undefined = objects[i + 1];
    const n2: Annotation | undefined = objects[i + 2];

    const isArrowPath =
      obj.type === "path" &&
      obj.strokeWidth === 6 &&
      obj.strokeLineCap === "round" &&
      (obj.fill === "transparent" || obj.fill === "" || !obj.fill);
    const handlesFollow =
      n1?.type === "circle" &&
      n2?.type === "circle" &&
      n1?.radius === 8 &&
      n2?.radius === 8 &&
      n1?.fill === "#FFFFFF" &&
      n2?.fill === "#FFFFFF";

    if (isArrowPath && handlesFollow) {
      arrows.push({
        type: "FabricArrow",
        x1: n1?.left,
        y1: n1?.top,
        x2: n2?.left,
        y2: n2?.top,
        arrowColor: obj.stroke || "#F59E0B",
        labelText: null,
        labelFontSize: 20,
        arrowThickness: 6,
      });
      i += 2; // consume the two handle circles
    } else {
      survivors.push(objects[i]);
    }
  }

  return [...survivors, ...arrows];
}

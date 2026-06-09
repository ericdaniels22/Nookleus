import type { ReactNode } from "react";

type Expanded =
  | string
  | number
  | null
  | Expanded[]
  | { type: string; props: { [k: string]: unknown; children: Expanded } };

/**
 * Recursively invoke function components and return a tree whose only
 * element `type`s are the @react-pdf/primitives string tags ('VIEW',
 * 'TEXT', 'PAGE', 'IMAGE', etc.). Lets render-shape tests assert on
 * structure and text without involving the PDF reconciler.
 */
export function expandTree(node: ReactNode | unknown): Expanded {
  if (node == null || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map(expandTree) as Expanded[];
  if (typeof node === "object" && node !== null && "type" in node) {
    const el = node as { type: unknown; props: { children?: unknown } };
    const { type, props } = el;
    // A React Fragment (<>…</>) carries no tag of its own — expand straight
    // through to its children so the primitives inside still surface.
    if (typeof type === "symbol" || type === undefined) {
      return expandTree((props as { children?: unknown })?.children);
    }
    if (typeof type === "function") {
      const rendered = (type as (p: unknown) => ReactNode)(props ?? {});
      return expandTree(rendered);
    }
    if (typeof type === "string") {
      return {
        type,
        props: {
          ...(props as Record<string, unknown>),
          children: expandTree((props as { children?: unknown })?.children),
        },
      };
    }
  }
  return null;
}

export function collectText(node: Expanded): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  return collectText(node.props.children);
}

/**
 * Walks the expanded tree and returns every node whose `type` matches.
 */
export function findAll(
  node: Expanded,
  match: (n: Exclude<Expanded, string | number | null | unknown[]>) => boolean,
): Array<Exclude<Expanded, string | number | null | unknown[]>> {
  const out: Array<Exclude<Expanded, string | number | null | unknown[]>> = [];
  function visit(n: Expanded) {
    if (n == null || typeof n === "string" || typeof n === "number") return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (match(n)) out.push(n);
    visit(n.props.children);
  }
  visit(node);
  return out;
}

/**
 * Flatten an @react-pdf `style` prop — a single style object, or an array of
 * them (possibly nested) that the renderer merges left-to-right — into one
 * resolved object, so a test can read a final style value without caring how
 * the component composed it.
 */
export function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flattenStyle(s) }),
      {},
    );
  }
  if (style && typeof style === "object") return style as Record<string, unknown>;
  return {};
}

/**
 * Every rounded photo frame in the report PDF is a clipping VIEW
 * (`overflow: 'hidden'`) that directly wraps the photo IMAGE — the shape that
 * carries `PHOTO_CORNER_RADIUS`. Returns one entry per such frame, so a test
 * can hold every photo across any page layout to the shared radius. (The cover
 * photo is the lone exception: a bare IMAGE with the radius on the image
 * itself, not a wrapping frame, so it is asserted directly.)
 */
export function photoFrames(
  tree: Expanded,
): Array<Exclude<Expanded, string | number | null | unknown[]>> {
  return findAll(tree, (n) => {
    if (n.type !== "VIEW") return false;
    if (flattenStyle(n.props.style).overflow !== "hidden") return false;
    const children = Array.isArray(n.props.children)
      ? n.props.children
      : [n.props.children];
    return children.some(
      (c) =>
        c && typeof c === "object" && !Array.isArray(c) && c.type === "IMAGE",
    );
  });
}

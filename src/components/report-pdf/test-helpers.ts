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

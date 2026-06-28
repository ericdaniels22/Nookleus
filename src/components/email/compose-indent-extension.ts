import { Extension, type CommandProps } from "@tiptap/core";
import {
  nextIndentLevel,
  indentToMarginPx,
  type IndentDirection,
} from "@/lib/email/compose-indent";

// Block node types that carry an indent level. Lists handle their own nesting,
// so indent/outdent here targets paragraphs and headings.
const INDENTABLE_TYPES: string[] = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    composeIndent: {
      /** Increase the indent level of the selected block(s). */
      indent: () => ReturnType;
      /** Decrease the indent level of the selected block(s). */
      outdent: () => ReturnType;
    };
  }
}

function applyIndent(direction: IndentDirection) {
  return ({ state, dispatch, tr }: CommandProps): boolean => {
    const { from, to } = state.selection;
    let changed = false;
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!INDENTABLE_TYPES.includes(node.type.name)) return;
      // A paragraph inside a list item is already indented by the list nesting;
      // adding margin-left here double-indents it (issue #660). Lists own their
      // own nesting (Tab / sinkListItem), so skip list-item children.
      if (parent?.type.name === "listItem") return;
      const current =
        typeof node.attrs.indent === "number" ? node.attrs.indent : 0;
      const next = nextIndentLevel(current, direction);
      if (next !== current) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        changed = true;
      }
    });
    if (changed && dispatch) dispatch(tr);
    return changed;
  };
}

/**
 * Adds an integer `indent` level to block nodes (paragraph, heading) plus
 * indent()/outdent() commands. All level math + clamping lives in the pure,
 * unit-tested compose-indent module; this extension is the thin Tiptap shell
 * that stores the level and renders it as an inline margin-left, so the
 * indentation is carried into the sent email's HTML — not just the editor view.
 *
 * Opt-in: only the compose editor loads this via TiptapEditor's extraExtensions,
 * so the shared editor's other consumers (contracts, estimates, …) are
 * completely unaffected.
 */
export const IndentExtension = Extension.create({
  name: "composeIndent",

  addGlobalAttributes() {
    return [
      {
        types: INDENTABLE_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) => {
              const raw = element.getAttribute("data-indent");
              const n = raw ? Number.parseInt(raw, 10) : 0;
              return Number.isFinite(n) ? n : 0;
            },
            renderHTML: (attributes: { indent?: number }) => {
              const level = attributes.indent ?? 0;
              if (!level) return {};
              return {
                "data-indent": String(level),
                style: `margin-left: ${indentToMarginPx(level)}px`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent: () => applyIndent("indent"),
      outdent: () => applyIndent("outdent"),
    };
  },
});

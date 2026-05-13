import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mergeField: {
      insertMergeField: (fieldName: string) => ReturnType;
    };
  }
}

export interface MergeFieldNodeOptions {
  // Set of slugs that should render as resolved (not warning). Callers
  // build this from the registry (intake form_config + system fields) plus
  // any context-specific extras (signing_link, payment tokens, etc.).
  // When empty, every pill renders with `data-unknown` — matches the empty
  // registry SSR fallback used before the mount-effect fetch lands.
  extraResolvableNames?: Set<string>;
}

export const MergeFieldNode = Node.create<MergeFieldNodeOptions>({
  name: "mergeField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { extraResolvableNames: undefined };
  },

  addAttributes() {
    return {
      fieldName: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-field-name") ?? "",
        renderHTML: (attrs) => ({
          "data-field-name": String(attrs.fieldName ?? ""),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-field-name]",
        getAttrs: (node) => {
          const el = node as HTMLElement;
          return { fieldName: el.getAttribute("data-field-name") ?? "" };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const fieldName = String(node.attrs.fieldName ?? "");
    const known = this.options.extraResolvableNames?.has(fieldName) ?? false;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "merge-field-pill",
        "data-field-name": fieldName,
        ...(known ? {} : { "data-unknown": "true" }),
      }),
      `{{${fieldName}}}`,
    ];
  },

  addCommands() {
    return {
      insertMergeField:
        (fieldName: string) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { fieldName },
            })
            .insertContent(" ")
            .run();
        },
    };
  },
});

export default MergeFieldNode;

import { Node, mergeAttributes } from "@tiptap/core";
import { isKnownField } from "@/lib/contracts/merge-fields";
import { EMAIL_EXTRA_MERGE_FIELDS } from "@/lib/contracts/email-merge-fields";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mergeField: {
      insertMergeField: (fieldName: string) => ReturnType;
    };
  }
}

const EMAIL_EXTRA_NAMES = new Set<string>(EMAIL_EXTRA_MERGE_FIELDS.map((f) => f.name));

function isResolvable(name: string, paymentNames?: Set<string>): boolean {
  if (isKnownField(name)) return true;
  if (EMAIL_EXTRA_NAMES.has(name)) return true;
  if (paymentNames?.has(name)) return true;
  return false;
}

export interface MergeFieldNodeOptions {
  // Optional set of additional resolvable field names for the payments editor
  // (so payment-specific tokens don't render as warning pills).
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
    const known = isResolvable(fieldName, this.options.extraResolvableNames);
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

const TOKEN_RE = /\{\{([a-z_][a-z0-9_]*)\}\}/gi;

/**
 * Walks text nodes inside `html` and replaces any `{{field_name}}` substrings
 * with a Tiptap merge-field pill span. Leaves attribute values untouched, so
 * `<a href="{{signing_link}}">Open document</a>` is preserved exactly.
 *
 * Returns the original string unchanged on the server (no DOMParser there).
 * Components calling this are "use client", so SSR isn't a concern in
 * practice — the guard is just a safety net.
 */
export function tokenizeForEditor(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return html;

  walkTextNodes(root, (textNode) => {
    const text = textNode.textContent ?? "";
    if (!TOKEN_RE.test(text)) return;
    TOKEN_RE.lastIndex = 0;

    const frag = doc.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      const [match, fieldName] = m;
      const start = m.index;
      if (start > last) {
        frag.appendChild(doc.createTextNode(text.slice(last, start)));
      }
      const span = doc.createElement("span");
      span.setAttribute("data-field-name", fieldName);
      span.setAttribute("class", "merge-field-pill");
      span.textContent = `{{${fieldName}}}`;
      frag.appendChild(span);
      last = start + match.length;
    }
    if (last < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(last)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  });

  return root.innerHTML;
}

function walkTextNodes(root: Node, visit: (n: Text) => void) {
  // Snapshot the matching text nodes BEFORE mutating, otherwise the live
  // tree walker walks past the replacement nodes we just inserted.
  const textNodes: Text[] = [];
  const walker = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent?.hasAttribute("data-field-name")) return;
      textNodes.push(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const child of Array.from(node.childNodes)) walker(child);
  };
  walker(root);
  for (const tn of textNodes) visit(tn);
}

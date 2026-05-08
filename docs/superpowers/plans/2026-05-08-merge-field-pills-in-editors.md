# Merge-field Pills in Email Template Editors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make merge fields render as styled purple pills inside the Subject and Body editors of every email template (Settings → Contracts and Settings → Payments), and switch the merge-field selector dropdown to show plain-English labels (e.g. "Customer Name") instead of raw tokens (`{{customer_name}}`).

**Why:** Today the body editor inserts `{{customer_name}}` as plain text, which looks like code stuck in a sentence. The selector already styles tokens as purple pills — users expect the same look once placed. Plain-English labels in the picker also make the dropdown easier to scan for non-technical users.

**Decision log (from grilling, 2026-05-08):**

| # | Decision |
|---|---|
| 1 | Pill content = raw `{{token}}` (preserves the resolver contract; no migration of saved bodies) |
| 2 | Pills appear in BOTH subject AND body |
| 3 | Existing saved tokens auto-convert to pills on load |
| 4 | Applies to Contracts settings AND Payments settings |
| 5 | Pills are atomic — backspace deletes whole pill, click selects whole pill |
| 6 | Tokens that aren't in the registry render as a warning-styled pill (red/amber border) |
| 7 | Selector shows label only ("Customer Name") as a pill — same shape as today, different text |
| 8 | No `{{` autocomplete (dropdown picker only) |
| 9 | Signing Link entry in the picker still inserts an `<a href="{{signing_link}}">Open document</a>` hyperlink — NOT a pill — because the resolver substitutes the URL and a pill would show the raw URL as link text |

**Architecture:**

The resolver already handles two storage shapes ([src/lib/contracts/merge-fields.ts:228](src/lib/contracts/merge-fields.ts:228) and [src/lib/contracts/email-merge-fields.ts:81](src/lib/contracts/email-merge-fields.ts:81)):
- Bare token: `{{customer_name}}`
- Tiptap pill span: `<span data-field-name="customer_name">{{customer_name}}</span>`

So this is a **pure UI change** — no resolver, no API, no DB schema changes. The editor switches to emitting pill spans; old saved templates with bare tokens still resolve correctly until the user re-saves them (which silently upgrades to the span format).

Three new pieces of UI code:

1. **`MergeFieldNode`** — a Tiptap inline atomic Node extension. Parses `<span data-field-name="x">…</span>` into a node, renders the same span. Atomic = backspace deletes the whole node. Draggable = users can move pills around (free with `draggable: true`).

2. **`MergeFieldInput`** — a single-line, pill-aware contenteditable replacement for the subject `<input>`. Built on Tiptap with StarterKit pruned down to text + the merge-field node. Custom serializer flattens pill nodes to `{{token}}` so the subject still saves as a plain string (preserves the DB contract — subjects must be plain text or the recipient sees `<p>` tags in their inbox).

3. **`tokenizeForEditor(html)`** — DOM-based pre-processor that walks text nodes only (skipping attribute-embedded tokens like `href="{{signing_link}}"`) and wraps each `{{token}}` in a pill span. Run once when the editor mounts, so existing seeded templates render with pills on first load.

**Tech Stack:** React 19, Next.js (per AGENTS.md, this is a non-standard build — APIs may differ from training data), Tiptap v3.22.2 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-placeholder` — all already in package.json), `DOMParser` (browser-only; the components are all `"use client"` anyway).

**Spec:** None — design captured inline in the decision log above. This is a UI polish, not a major feature.

**Note on testing:** Manual smoke-test in the browser (Settings → Contracts and Settings → Payments). No automated coverage — the existing email template editors have no unit tests, and Tiptap interactions are difficult to drive without a real browser. Verification task below covers the smoke checks.

---

## File structure

**New files:**
- `src/components/contracts/merge-field-node.ts` — Tiptap Node extension
- `src/components/contracts/merge-field-input.tsx` — Single-line pill-aware input (replaces `<input>` for subject)
- `src/components/contracts/tokenize-for-editor.ts` — Bare-token → pill-span pre-processor

**Modified files:**
- `src/components/tiptap-editor.tsx` — Accept an `extensions` prop; pass `tokenizeForEditor(content)` through before mounting
- `src/components/contracts/email-template-field.tsx` — Replace `<input>` with `MergeFieldInput`; update `MergeFieldDropdown` to show labels and insert pills (special-case signing_link); pass merge-field extension into TiptapEditor
- `src/app/settings/payments/payment-email-template-field.tsx` — Same changes as above, with the payment-specific merge fields
- `src/app/globals.css` — Add `.merge-field-pill[data-unknown="true"]` warning style; ensure pill style works for `<span>` rendered both in editor and dropdown

**Files NOT touched:**
- `src/lib/contracts/merge-fields.ts` (resolver) — already supports both shapes
- `src/lib/contracts/email-merge-fields.ts` (resolver) — already supports both shapes
- `src/app/api/contracts/send/route.ts` — signing-link guard already checks both `{{signing_link}}` and `data-field-name="signing_link"` ([route.ts:79](src/app/api/contracts/send/route.ts:79))
- `src/components/contracts/send-contract-modal.tsx` — same guard pattern, already dual-shape ([send-contract-modal.tsx:55](src/components/contracts/send-contract-modal.tsx:55))
- Database schema, migrations, seeded templates — all stay as-is

---

## Task 1: Build the `MergeFieldNode` Tiptap extension

**Files:**
- Create: `src/components/contracts/merge-field-node.ts`

**Goal:** Inline atomic Tiptap node that parses and renders `<span data-field-name="x" class="merge-field-pill">{{x}}</span>`.

- [ ] **Step 1: Read the existing TiptapEditor to confirm the v3 API shape**

Run: `cat src/components/tiptap-editor.tsx`

Expected: imports from `@tiptap/react`, uses `useEditor`, `EditorContent`, `StarterKit`, etc. If the import shape differs from the snippet in the next step, adapt to whatever the file actually shows — Tiptap v3 changed some import paths from v2.

- [ ] **Step 2: Create `src/components/contracts/merge-field-node.ts`**

```ts
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

const EMAIL_EXTRA_NAMES = new Set(EMAIL_EXTRA_MERGE_FIELDS.map((f) => f.name));

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
```

The node renders as `<span data-field-name="x" class="merge-field-pill">{{x}}</span>`, matching exactly what the resolver expects. Atom + inline + draggable make the pill a Lego brick. The `extraResolvableNames` option is how the payments editor will pass in the payment-specific token names so they don't get flagged as "unknown."

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no errors. If `@tiptap/core` types don't include the command-augmentation pattern, drop the `declare module` block and use `editor.chain().insertContent({ type: "mergeField", ... })` directly from the picker code instead. This is a common Tiptap-v3 typing quirk.

---

## Task 2: Build the bare-token → pill pre-processor

**Files:**
- Create: `src/components/contracts/tokenize-for-editor.ts`

**Goal:** Walk an HTML string's text nodes only, replacing `{{token}}` substrings with `<span data-field-name="token">{{token}}</span>`. Skip attribute-embedded tokens (so `href="{{signing_link}}"` is preserved as-is).

- [ ] **Step 1: Create `src/components/contracts/tokenize-for-editor.ts`**

```ts
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
      textNodes.push(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    // Don't descend into elements whose text content is an attribute-style
    // value (none in practice, but cheap defense in depth).
    for (const child of Array.from(node.childNodes)) walker(child);
  };
  walker(root);
  for (const tn of textNodes) visit(tn);
}
```

- [ ] **Step 2: Smoke-check the edge cases by reading through them mentally**

Confirm by reading the function:
- Input `Hi {{customer_name}}, sign here` → `Hi <span ...>{{customer_name}}</span>, sign here` ✓
- Input `<a href="{{signing_link}}">Open document</a>` → unchanged (the `{{signing_link}}` is in an attribute, not a text node) ✓
- Input `<p>Hi {{a}} and {{b}}</p>` → both tokens converted ✓
- Input `<span data-field-name="x">{{x}}</span>` (already a pill) → the existing `<span>` is an element; its child text node is `{{x}}` which gets re-wrapped in another pill span. **Bug.**

Fix: skip text nodes whose parent already has `data-field-name`.

Update the `walker` block to:

```ts
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
```

This makes the function idempotent — running it twice on the same HTML produces the same result.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no errors.

---

## Task 3: Plumb the merge-field node through `TiptapEditor`

**Files:**
- Modify: `src/components/tiptap-editor.tsx`

**Goal:** Accept an optional `extensions` array prop and tokenize incoming `content` before handing it to Tiptap. Backwards-compatible — callers that don't pass extensions get the original behavior plus the editor still tokenizes (which is a no-op for content with no tokens).

- [ ] **Step 1: Modify [src/components/tiptap-editor.tsx](src/components/tiptap-editor.tsx)**

Change the `TiptapEditorProps` interface:

```ts
import type { Extension, Node, Mark } from "@tiptap/core";

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  extraExtensions?: Array<Extension | Node | Mark>;
}
```

Change the component to accept and use it:

```ts
export default function TiptapEditor({
  content,
  onChange,
  placeholder = "Type your message...",
  extraExtensions = [],
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      ...extraExtensions,
    ],
    content: tokenizeForEditor(content),
    immediatelyRender: false,
    // ...rest unchanged
  });
  // ...
}
```

Add the import at the top:

```ts
import { tokenizeForEditor } from "@/components/contracts/tokenize-for-editor";
```

Leave everything else in the file unchanged (toolbar, link prompt, `onUpdate`, etc.). Note: `onUpdate` continues to call `onChange(editor.getHTML())` — Tiptap re-serializes the merge-field node back to its `<span data-field-name="x">{{x}}</span>` form via `MergeFieldNode.renderHTML`. So saved HTML always uses the span shape after first edit.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no errors. If `Extension | Node | Mark` typing is awkward in v3, fall back to `Array<unknown>` and rely on runtime — this is internal plumbing only.

---

## Task 4: Build the single-line `MergeFieldInput` for subject lines

**Files:**
- Create: `src/components/contracts/merge-field-input.tsx`

**Goal:** Drop-in replacement for `<input type="text">` that supports inline merge-field pills. Accepts `value: string` (with `{{tokens}}`) and emits `onChange(value: string)` (also with `{{tokens}}`). One line only — Enter is suppressed.

- [ ] **Step 1: Create `src/components/contracts/merge-field-input.tsx`**

```tsx
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import { MergeFieldNode } from "./merge-field-node";
import { tokenizeForEditor } from "./tokenize-for-editor";

export interface MergeFieldInputHandle {
  insertMergeField: (fieldName: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  extraResolvableNames?: Set<string>;
}

const MergeFieldInput = forwardRef<MergeFieldInputHandle, Props>(function MergeFieldInput(
  { value, onChange, placeholder, className, extraResolvableNames },
  ref,
) {
  const lastEmittedRef = useRef<string>("");

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      MergeFieldNode.configure({ extraResolvableNames }),
    ],
    content: tokenizeForEditor(escapeForSingleLine(value)),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          (className ??
            "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]") +
          " merge-field-input-line",
      },
      handleKeyDown(_view, event) {
        // Single-line: swallow Enter so the user can't create a new paragraph.
        if (event.key === "Enter") {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const next = serializeToTokenString(editor.getJSON());
      if (next === lastEmittedRef.current) return;
      lastEmittedRef.current = next;
      onChange(next);
    },
  });

  // Sync external value changes (e.g. parent reset) without losing focus.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(tokenizeForEditor(escapeForSingleLine(value)), {
      emitUpdate: false,
    });
  }, [value, editor]);

  useImperativeHandle(
    ref,
    () => ({
      insertMergeField: (fieldName: string) => {
        if (!editor) return;
        editor
          .chain()
          .focus()
          .insertContent({ type: "mergeField", attrs: { fieldName } })
          .insertContent(" ")
          .run();
      },
      focus: () => editor?.commands.focus(),
    }),
    [editor],
  );

  if (!editor) return null;
  return <EditorContent editor={editor} />;
});

export default MergeFieldInput;

// Tiptap's Document/Paragraph wraps content in a single <p>. We need a string
// of the visible text + pills, with `{{token}}` standing in for each pill.
function serializeToTokenString(json: ReturnType<typeof JSON.parse>): string {
  // ProseMirror JSON: { type: "doc", content: [{ type: "paragraph", content: [...] }] }
  type N = { type: string; text?: string; attrs?: { fieldName?: string }; content?: N[] };
  const out: string[] = [];
  function walk(n: N) {
    if (n.type === "text" && typeof n.text === "string") {
      out.push(n.text);
      return;
    }
    if (n.type === "mergeField" && n.attrs?.fieldName) {
      out.push(`{{${n.attrs.fieldName}}}`);
      return;
    }
    if (n.content) {
      for (const c of n.content) walk(c);
    }
  }
  walk(json as N);
  return out.join("");
}

// HTML-escape characters that would otherwise be parsed as markup when
// passed through tokenizeForEditor, since the saved value is a plain string.
function escapeForSingleLine(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: Add a CSS rule so the single-line editor looks like an input**

Append to `src/app/globals.css` (the merge-field section, around line 320):

```css
/* Subject-line single-line editor — mimic the look of a plain <input>. */
.merge-field-input-line .ProseMirror,
.merge-field-input-line.ProseMirror {
  min-height: auto;
  outline: none;
}
.merge-field-input-line p {
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: Verify it compiles and confirm Tiptap v3 has `extension-document`/`extension-paragraph`/`extension-text`/`extension-history` available**

Run: `npx tsc --noEmit && grep -E "@tiptap/(extension-(document|paragraph|text|history))" package.json`

If any of those four packages aren't in package.json, install them:

```sh
npm install @tiptap/extension-document@^3.22.2 @tiptap/extension-paragraph@^3.22.2 @tiptap/extension-text@^3.22.2 @tiptap/extension-history@^3.22.2
```

These four extensions are tiny and ship as part of StarterKit; we're just importing them directly to avoid pulling in lists, headings, blockquote, etc. that StarterKit also includes.

---

## Task 5: Add the warning-state pill CSS

**Files:**
- Modify: `src/app/globals.css`

**Goal:** Pills with `data-unknown="true"` get a warning color so unrecognized tokens are visible at a glance.

- [ ] **Step 1: Append to the merge-field section of `src/app/globals.css` (after the existing `.merge-field-pill` and `.ProseMirror` rules around line 306)**

```css
/* Unknown merge field — token doesn't match any known field name.
 * Editor-only signal; the resolver still emits the standard "________"
 * unresolved placeholder at send time. */
.merge-field-pill[data-unknown="true"] {
  background: rgba(239, 68, 68, 0.10);
  color: rgb(252, 165, 165);
  border-color: rgba(239, 68, 68, 0.35);
}
.ProseMirror .merge-field-pill[data-unknown="true"]:hover {
  background: rgba(239, 68, 68, 0.18);
}
```

- [ ] **Step 2: Verify the build still compiles**

Run: `npx tsc --noEmit`

Expected: no errors. (CSS doesn't affect typecheck, but this catches earlier task regressions.)

---

## Task 6: Update `EmailTemplateField` (contracts)

**Files:**
- Modify: `src/components/contracts/email-template-field.tsx`

**Goal:** Replace the subject `<input>` with `MergeFieldInput`; replace the body `TiptapEditor` with one that has the merge-field extension; rewrite the dropdown to (a) show labels, (b) insert pills via editor commands, (c) special-case `signing_link` to insert an "Open document" anchor link.

- [ ] **Step 1: Read [src/components/contracts/email-template-field.tsx](src/components/contracts/email-template-field.tsx) to confirm the starting shape**

Run: `cat src/components/contracts/email-template-field.tsx`

Confirm the file matches the snapshot we read during planning (172 lines, `MergeFieldDropdown` renders pill buttons with `{{${f.name}}}` text). If the shape has drifted, STOP and reconcile before continuing.

- [ ] **Step 2: Rewrite the file**

Overwrite with:

```tsx
"use client";

import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import TiptapEditor from "@/components/tiptap-editor";
import { ChevronDown, Plus } from "lucide-react";
import { MERGE_FIELD_CATEGORIES, mergeFieldsByCategory } from "@/lib/contracts/merge-fields";
import { EMAIL_EXTRA_MERGE_FIELDS } from "@/lib/contracts/email-merge-fields";
import { MergeFieldNode } from "@/components/contracts/merge-field-node";
import MergeFieldInput, {
  type MergeFieldInputHandle,
} from "@/components/contracts/merge-field-input";

export interface EmailTemplateFieldProps {
  label: string;
  description?: string;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}

const SIGNING_LINK_HTML = `<a href="{{signing_link}}">Open document</a>`;

export default function EmailTemplateField({
  label,
  description,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: EmailTemplateFieldProps) {
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [bodyMenuOpen, setBodyMenuOpen] = useState(false);
  const subjectInputRef = useRef<MergeFieldInputHandle | null>(null);
  const bodyEditorRef = useRef<Editor | null>(null);

  const grouped = mergeFieldsByCategory();

  function insertIntoSubject(fieldName: string) {
    // Subject is single-line plain text — even signing_link goes in as a
    // pill here. (Recipients rarely click a subject anyway; the body is
    // where the clickable link belongs.)
    subjectInputRef.current?.insertMergeField(fieldName);
    setSubjectMenuOpen(false);
  }

  function insertIntoBody(fieldName: string) {
    const editor = bodyEditorRef.current;
    if (!editor) return;
    if (fieldName === "signing_link") {
      // Special case: insert a clickable anchor whose href contains the
      // token. Resolver swaps `{{signing_link}}` in the href at send time.
      editor.chain().focus().insertContent(SIGNING_LINK_HTML).insertContent(" ").run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent({ type: "mergeField", attrs: { fieldName } })
        .insertContent(" ")
        .run();
    }
    setBodyMenuOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Subject</label>
          <MergeFieldDropdown
            open={subjectMenuOpen}
            setOpen={setSubjectMenuOpen}
            grouped={grouped}
            onPick={insertIntoSubject}
          />
        </div>
        <MergeFieldInput
          ref={subjectInputRef}
          value={subject}
          onChange={onSubjectChange}
          placeholder="Subject line"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Body</label>
          <MergeFieldDropdown
            open={bodyMenuOpen}
            setOpen={setBodyMenuOpen}
            grouped={grouped}
            onPick={insertIntoBody}
          />
        </div>
        <TiptapEditor
          content={body}
          onChange={onBodyChange}
          placeholder="Email body. Use merge fields to insert data at send time."
          extraExtensions={[MergeFieldNode]}
          onReady={(editor) => {
            bodyEditorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}

function MergeFieldDropdown({
  open,
  setOpen,
  grouped,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  grouped: ReturnType<typeof mergeFieldsByCategory>;
  onPick: (fieldName: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 transition-colors"
      >
        <Plus size={12} /> Merge Field <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 max-h-80 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl z-40 p-2">
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Email Context
            </div>
            <div className="flex flex-wrap gap-1">
              {EMAIL_EXTRA_MERGE_FIELDS.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  title={`{{${f.name}}}`}
                  onClick={() => onPick(f.name)}
                  className="merge-field-pill cursor-pointer hover:brightness-110"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {grouped[cat].map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    title={`{{${f.name}}}`}
                    onClick={() => onPick(f.name)}
                    className="merge-field-pill cursor-pointer hover:brightness-110"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Two notable changes:
1. The dropdown buttons now render `{f.label}` (e.g. "Customer Name") instead of `{{${f.name}}}`. The `title={...}` attribute keeps the raw token discoverable via hover tooltip for power users.
2. `insertIntoBody("signing_link")` inserts an anchor; everything else inserts a pill node.

Note: the `onReady` prop on TiptapEditor is added in the next sub-step.

- [ ] **Step 3: Add `onReady` prop to TiptapEditor**

Modify [src/components/tiptap-editor.tsx](src/components/tiptap-editor.tsx) once more, adding to the props:

```ts
import type { Editor } from "@tiptap/react";

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  extraExtensions?: Array<unknown>;
  onReady?: (editor: Editor) => void;
}
```

And inside the component, after `useEditor(...)`:

```ts
useEffect(() => {
  if (editor && onReady) onReady(editor);
}, [editor, onReady]);
```

(Add `useEffect` to the React imports.)

This is needed so the parent can grab the editor instance and call `editor.chain().insertContent(...)` from the dropdown picker. There's no other clean way to imperatively insert a pill — Tiptap doesn't expose the editor through child render props.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no errors.

---

## Task 7: Update `PaymentEmailTemplateField` (payments)

**Files:**
- Modify: `src/app/settings/payments/payment-email-template-field.tsx`

**Goal:** Apply the same pattern as Task 6, but pass the payment-specific resolvable names so payment tokens (`{{invoice_number}}`, `{{amount_due}}`, etc.) don't render as warning pills.

- [ ] **Step 1: Read [src/app/settings/payments/payment-email-template-field.tsx](src/app/settings/payments/payment-email-template-field.tsx)**

Run: `cat src/app/settings/payments/payment-email-template-field.tsx`

Also check what the payment-specific token names are:

Run: `cat src/lib/payments/merge-fields.ts | head -60`

This tells us the names that need to be added to `extraResolvableNames` so they don't get the "unknown" warning treatment.

- [ ] **Step 2: Rewrite the file**

Apply the exact same shape as Task 6, with two diffs:

1. Build a `paymentNames: Set<string>` from `PAYMENT_MERGE_FIELDS` and pass it as `extraResolvableNames` to both `MergeFieldInput` (subject) and the body's `MergeFieldNode.configure({ extraResolvableNames: paymentNames })`.

2. The body's signing-link special case isn't relevant for payment templates (no signing_link in this picker). So `insertIntoBody` always inserts a pill node — no anchor branch.

3. The dropdown still has two sections (Payment fields + Contract fields). Both render labels via `f.label`.

Concretely:

```tsx
// Imports — add MergeFieldNode, MergeFieldInput, etc. as in Task 6.
import { MergeFieldNode } from "@/components/contracts/merge-field-node";
import MergeFieldInput, {
  type MergeFieldInputHandle,
} from "@/components/contracts/merge-field-input";
import { useMemo } from "react";

// Inside the component:
const paymentNames = useMemo(
  () => new Set(Object.values(paymentGrouped).flat().map((f) => f.name)),
  [paymentGrouped],
);

// In the body editor:
<TiptapEditor
  content={body}
  onChange={onBodyChange}
  placeholder="Email body. Use merge fields to insert data at send time."
  extraExtensions={[MergeFieldNode.configure({ extraResolvableNames: paymentNames })]}
  onReady={(editor) => {
    bodyEditorRef.current = editor;
  }}
/>

// In the subject input:
<MergeFieldInput
  ref={subjectInputRef}
  value={subject}
  onChange={onSubjectChange}
  placeholder="Subject line"
  extraResolvableNames={paymentNames}
/>

// insertIntoBody always inserts a pill (no signing_link special case here):
function insertIntoBody(fieldName: string) {
  bodyEditorRef.current
    ?.chain()
    .focus()
    .insertContent({ type: "mergeField", attrs: { fieldName } })
    .insertContent(" ")
    .run();
  setBodyMenuOpen(false);
}

// In the dropdown buttons, render `f.label` instead of `{{${f.name}}}`,
// and add `title={`{{${f.name}}}`}` for the hover tooltip — same change as Task 6.
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no errors.

---

## Task 8: Manual smoke test

**Files:**
- None (verification only)

**Goal:** Confirm the change works for a typical user before committing.

- [ ] **Step 1: Start the dev server**

Use the preview tools (or `npm run dev` if preview tools aren't available in this session).

- [ ] **Step 2: Settings → Contracts**

Navigate to `/settings/contracts`. Verify:
1. Existing seeded body templates render with PURPLE PILLS in place of bare `{{customer_name}}`, `{{document_title}}`, `{{company_name}}` etc.
2. The "Open document" hyperlink in the seeded signing-request body is STILL a hyperlink (not a pill).
3. The Subject input shows pills for any tokens it contains (e.g. `Please sign: ` + a `{{document_title}}` pill).
4. Clicking "+ Merge Field" opens the dropdown showing PLAIN ENGLISH labels (e.g. "Customer Name") in purple pills, grouped by category.
5. Hovering a dropdown pill shows the raw token (`{{customer_name}}`) as a tooltip.
6. Clicking "Customer Name" inserts a pill with `{{customer_name}}` text into the body at the cursor.
7. Clicking "Signing Link" in the dropdown inserts a clickable "Open document" hyperlink (not a pill).
8. Backspace next to a pill deletes the WHOLE pill in one keystroke.
9. Typing `{{not_a_real_field}}` into the body and clicking elsewhere produces a RED warning-styled pill.
10. Click Save. Reload the page. All pills survive — bodies still show pills, subjects still show pills.

- [ ] **Step 3: Settings → Payments**

Navigate to `/settings/payments`. Verify the same behavior for payment email templates. Pay extra attention to:
1. Payment-specific tokens (e.g. `{{amount_due}}`, `{{invoice_number}}`) render as NORMAL purple pills, not warning pills (because we passed them via `extraResolvableNames`).
2. The dropdown still has both "Payment" and "Contract" sections.

- [ ] **Step 4: Send a real test contract end-to-end**

This catches resolver regressions:
1. Open Settings → Contracts, click Save (forces the body to re-serialize through the editor — output now contains pill spans instead of bare tokens).
2. Navigate to a job, send a contract.
3. Open the customer's email. Confirm:
   - Customer name resolves correctly (was a pill, should appear as the actual customer's name).
   - The "Open document" link is clickable and goes to the signing page.
   - No raw `{{token}}` text leaks through.

This proves the resolver still works on the new `<span data-field-name="...">` storage shape.

- [ ] **Step 5: Console check**

Open DevTools console while on the settings pages. Confirm: no errors, no warnings about Tiptap node parsing or React keys.

If anything in steps 2–5 fails, STOP and diagnose before moving on. The most likely failures:
- `tokenizeForEditor` regex doesn't match a token shape used in real seeds (check the actual seeded body — `cat supabase/migration-build*-contract-templates.sql | grep -A5 signing_request_body`).
- Tiptap v3 parses `<span data-field-name>` differently than the extension expects (check `parseHTML` logic).
- `MergeFieldInput` loses focus or duplicates content on external value changes (the `lastEmittedRef` guard should prevent this — verify).

---

## Task 9: Commit

**Files:**
- All of the above

- [ ] **Step 1: Confirm a clean diff**

Run: `git status` and `git diff --stat`

Expected files modified/created:
- `src/components/contracts/merge-field-node.ts` (NEW)
- `src/components/contracts/tokenize-for-editor.ts` (NEW)
- `src/components/contracts/merge-field-input.tsx` (NEW)
- `src/components/tiptap-editor.tsx` (MODIFIED)
- `src/components/contracts/email-template-field.tsx` (MODIFIED)
- `src/app/settings/payments/payment-email-template-field.tsx` (MODIFIED)
- `src/app/globals.css` (MODIFIED)
- `package.json` / `package-lock.json` if Task 4 needed to add Tiptap sub-extensions

Nothing else should be touched.

- [ ] **Step 2: Stage and commit**

```sh
git add src/components/contracts/merge-field-node.ts \
        src/components/contracts/tokenize-for-editor.ts \
        src/components/contracts/merge-field-input.tsx \
        src/components/tiptap-editor.tsx \
        src/components/contracts/email-template-field.tsx \
        src/app/settings/payments/payment-email-template-field.tsx \
        src/app/globals.css

# Add package.json + lockfile if Task 4 installed sub-extensions:
git add package.json package-lock.json
```

Commit message:

```
feat(email-templates): merge-field pills in subject + body editors

Email template editors (Settings → Contracts and Settings → Payments)
now render merge fields as styled purple pills inline with the text,
matching the look of the picker dropdown. The dropdown itself now
shows plain-English labels ("Customer Name") instead of raw tokens.

- New Tiptap atomic Node extension (MergeFieldNode) for in-body pills
- New single-line MergeFieldInput component for the subject field
- DOM-walking tokenizer auto-converts existing `{{token}}` text in
  seeded templates to pills on first load (idempotent — won't double-
  wrap an existing pill span)
- Unknown tokens render in a red warning style so typos are visible
- Signing Link picker still inserts an `<a href>Open document</a>`
  link (recipients see "Open document", not the raw URL)

The resolver in lib/contracts/merge-fields.ts already handled both
storage shapes (`{{x}}` and `<span data-field-name="x">{{x}}</span>`),
so this is a pure UI change — no DB, API, or resolver edits.
```

- [ ] **Step 3: Push the branch and update the vault**

After the commit lands, run the `/handoff` slash command to update `docs/vault/00-NOW.md` with a one-line entry pointing at this plan and the new components.

---

## Risks & open questions

1. **Tiptap `extraExtensions` typing.** The `Array<Extension | Node | Mark>` import shape sometimes breaks in v3 because the union doesn't perfectly match `Extension<{}>`. If TypeScript complains, fall back to `Array<unknown>` — runtime behavior is unaffected.

2. **`MergeFieldInput` focus jitter on external value changes.** Parent re-renders pass new `value` props that we sync via `useEffect` + `setContent`. The `lastEmittedRef` guard prevents loops, but if focus jumps unexpectedly while typing, the fix is to only call `setContent` when the editor is NOT focused (`!editor.isFocused`).

3. **Signing-link guard.** Both [src/app/api/contracts/send/route.ts:79](src/app/api/contracts/send/route.ts:79) and [src/components/contracts/send-contract-modal.tsx:55](src/components/contracts/send-contract-modal.tsx:55) check for either `{{signing_link}}` OR `data-field-name="signing_link"`. After this change, picker-inserted signing links are anchors with `href="{{signing_link}}"` — the bare-token check still matches. The span check still matches if a user directly inserts a `signing_link` pill (unusual, but the dropdown allows it). Both shapes covered. ✓

4. **Existing seeded body with `<a href="{{signing_link}}">Open document</a>`.** The tokenizer skips attribute-embedded tokens (Task 2 Step 2). Loading the seeded body produces pills for all the visible tokens and leaves the anchor's href untouched. ✓

5. **What if a user manually types `<a href="{{signing_link}}">My Link</a>` in the body via the link toolbar?** The Link extension stores it as a real anchor; tokenizer leaves the href alone; resolver swaps the URL at send time. Works exactly like the seeded version. ✓

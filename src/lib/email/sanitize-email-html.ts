import sanitizeHtml from "sanitize-html";

// Allowlist-based sanitization for email body HTML (issue #658, PRD #634).
//
// Why this exists: body HTML on the send / draft-save / template-write paths is
// stored and emailed verbatim. The only XSS defense used to be the client
// Tiptap round-trip — which a direct API POST bypasses entirely. This module is
// the server-side backstop: the editor round-trip is UX, this is security.
//
// The allowlist is tuned to what the compose Tiptap editor and the
// signature/template features legitimately emit (issues #642/#643): block tags,
// the inline marks the formatting toolbar drives, links, images (incl. pasted
// base64), and a small set of inline styles. Anything outside the lists — a
// `<script>`, an `onerror=`, a `javascript:` href, an unknown CSS property — is
// dropped. We hand the parsing to the vetted `sanitize-html` library rather than
// regex, because HTML cannot be safely sanitized with string transforms.

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

const ALLOWED_TAGS = [
  "p",
  "br",
  "span",
  "div",
  "a",
  "img",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "strike",
  "del",
  "u",
  "mark",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  ...HEADING_TAGS,
];

// Value patterns for the only CSS properties the compose toolbar can set, plus
// the signature region's inline visual separator. A declaration whose property
// is absent here — or whose value fails the pattern — is dropped, which also
// neutralizes CSS-based vectors (expression(), url(), …).
const COLOR = [
  /^#(?:[0-9a-fA-F]{3,4}){1,2}$/,
  /^rgba?\(/i,
  /^hsla?\(/i,
  /^[a-z]+$/i,
];
const LENGTH = [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/];
const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    color: COLOR,
    "background-color": COLOR,
    "font-size": LENGTH,
    "text-align": [/^(?:left|right|center|justify)$/],
    "margin-left": LENGTH,
    "margin-top": LENGTH,
    "padding-top": LENGTH,
    "border-top": [
      /^[\d.]+px\s+(?:solid|dashed|dotted)\s+(?:#(?:[0-9a-fA-F]{3,4}){1,2}|[a-z]+)$/i,
    ],
  },
};

// Internal markers the compose editor round-trips: the signature region's
// delimiter (#643) and the indent level (#642). They must SURVIVE storage so a
// resumed draft can re-locate and swap its signature region, but must NOT ship
// in outgoing mail (issue #658 L5) — the visual styling (border-top,
// margin-left) carries the appearance, the markers are app-internal.
function buildOptions(preserveInternalMarkers: boolean): sanitizeHtml.IOptions {
  const indentAttr = preserveInternalMarkers ? ["data-indent"] : [];
  const headingAttrs = Object.fromEntries(
    HEADING_TAGS.map((t) => [t, indentAttr]),
  );
  return {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      // `*` is merged with each tag's own list by sanitize-html, so every
      // allowed tag may carry an (allowlisted) inline style.
      "*": ["style"],
      a: ["href", "target", "rel", "name"],
      img: ["src", "alt", "title", "width", "height"],
      mark: ["data-color"],
      p: indentAttr,
      ...headingAttrs,
      div: preserveInternalMarkers ? ["data-signature-block"] : [],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // Pasted images come through as base64 data URIs (editor allowBase64);
    // `data:` is only ever honored for <img> src, never for links.
    allowedSchemesByTag: { img: ["http", "https", "data"] },
  };
}

const STORAGE_OPTIONS = buildOptions(true);
const SEND_OPTIONS = buildOptions(false);

/**
 * Sanitize email body HTML for STORAGE — draft save and template
 * create/update. Allowlist-based; PRESERVES internal round-trip markers
 * (`data-signature-block`, `data-indent`) so a resumed draft can still locate
 * and swap its signature region (issue #656).
 */
export function sanitizeEmailHtmlForStorage(html: string | null | undefined): string {
  return sanitizeHtml(html ?? "", STORAGE_OPTIONS);
}

/**
 * Sanitize email body HTML for SENDING. Same allowlist as storage, then strips
 * the internal markers so they never ship in outgoing mail (issue #658 L5); the
 * visual styling they carried (border-top, margin-left) is preserved.
 */
export function sanitizeEmailHtmlForSend(html: string | null | undefined): string {
  return sanitizeHtml(html ?? "", SEND_OPTIONS);
}

// src/lib/pdf-renderer/html-to-pdf.tsx — minimal HTML → @react-pdf converter.
// HTML strings come from the Tiptap editor: estimate/invoice statements
// (src/components/estimate-builder/statement-editor.tsx) and Photo Report
// section write-ups (issue #403). The editor is bare StarterKit, so it can emit
// more than we render richly — headings, blockquotes, code blocks, horizontal
// rules, hard breaks, links, nested lists. We render the common subset (<p>,
// <strong>/<b>, <em>/<i>, <ul>/<ol>/<li> with nesting) and DEGRADE everything
// else to clean text: a heading/blockquote/code block becomes a plain
// paragraph, an <hr>/<img> is dropped, a <br> becomes a line break, and unknown
// inline tags (links, <span>, <s>, <u>, inline <code>) keep their text. The one
// hard rule: never leak a tag-name fragment (e.g. "h2>") into the PDF.

import { Text, View } from "@react-pdf/renderer";
import type { JSX } from "react";

interface Run { text: string; bold?: boolean; italic?: boolean; }

// True when at least one run carries non-whitespace text. Guards against
// emitting a phantom paragraph for `<p>   </p>` (Tiptap can produce this
// when a user hits space and saves).
function runsHaveContent(runs: Run[]): boolean {
  return runs.some((r) => r.text.trim().length > 0);
}

// Tokenize a fragment of HTML into plain runs. Naive parser sufficient for the
// editor's output; not a general HTML parser. Any tag is consumed: <strong>/<b>
// and <em>/<i> toggle styling, and every other inline tag — links, <span>, the
// <p> TipTap wraps list-item content in — is simply dropped so no angle-bracket
// remnants leak into the rendered text.
function tokenize(html: string): Run[] {
  const runs: Run[] = [];
  const re = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi;
  let bold = false;
  let italic = false;
  for (const m of html.matchAll(re)) {
    const tag = m[2]?.toLowerCase();
    const text = m[3];
    if (tag) {
      const isClose = m[1] === "/";
      if (tag === "strong" || tag === "b") bold = !isClose;
      else if (tag === "em" || tag === "i") italic = !isClose;
      // Any other tag is a no-op formatting boundary.
    } else if (text) {
      const decoded = text
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      if (decoded.length > 0) runs.push({ text: decoded, bold, italic });
    }
  }
  return runs;
}

function renderRuns(runs: Run[], keyPrefix: string): JSX.Element[] {
  return runs.map((r, i) => {
    const style: { fontWeight?: "bold"; fontStyle?: "italic" } = {};
    if (r.bold) style.fontWeight = "bold";
    if (r.italic) style.fontStyle = "italic";
    return <Text key={`${keyPrefix}-r${i}`} style={style}>{r.text}</Text>;
  });
}

// Fold the tags we don't render richly onto ones we do, or strip them, BEFORE
// parsing — so the block scanner only ever sees <p>/<ul>/<ol> plus inline runs,
// and no unsupported tag can leak its name as text.
function normalizeBlocks(html: string): string {
  return html
    .replace(/<img[^>]*>/gi, "") // images are out of scope — drop entirely
    .replace(/<hr\s*\/?>/gi, "") // horizontal rules carry no text — drop
    .replace(/<br\s*\/?>/gi, "\n") // hard break → newline inside the paragraph
    .replace(/<h[1-6]\b[^>]*>/gi, "<p>") // headings render as plain paragraphs
    .replace(/<\/h[1-6]\s*>/gi, "</p>")
    .replace(/<blockquote\b[^>]*>/gi, "") // unwrap blockquote; its inner <p> stays
    .replace(/<\/blockquote\s*>/gi, "")
    .replace(/<pre\b[^>]*>/gi, "<p>") // code block → paragraph
    .replace(/<\/pre\s*>/gi, "</p>")
    .replace(/<code\b[^>]*>/gi, "") // drop inline / code-block <code> styling tags
    .replace(/<\/code\s*>/gi, "");
}

// Find the match for the tag that closes the element opened at `from`, counting
// nested opens of the same tag so <ul>/<ol>/<li> nesting is respected (a naive
// non-greedy regex would stop at the FIRST inner close and corrupt the tree).
// `from` must point just past the opening tag. Returns the RegExpMatchArray for
// the matching close tag (so callers get both `.index` and its length), or null.
function findMatchingClose(
  html: string,
  tag: string,
  from: number,
): RegExpExecArray | null {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) return m;
    } else {
      depth += 1;
    }
  }
  return null;
}

// Split a list item's inner HTML into its direct (inline) content and any
// nested lists, so the bullet text and its sub-list render separately.
function splitNestedLists(liInner: string): {
  direct: string;
  nested: Array<{ type: "ul" | "ol"; inner: string }>;
} {
  let direct = "";
  const nested: Array<{ type: "ul" | "ol"; inner: string }> = [];
  const openRe = /<(ul|ol)\b[^>]*>/gi;
  let pos = 0;
  while (pos < liInner.length) {
    openRe.lastIndex = pos;
    const m = openRe.exec(liInner);
    if (!m) {
      direct += liInner.slice(pos);
      break;
    }
    direct += liInner.slice(pos, m.index);
    const type = m[1].toLowerCase() as "ul" | "ol";
    const contentStart = m.index + m[0].length;
    const close = findMatchingClose(liInner, type, contentStart);
    nested.push({
      type,
      inner: close ? liInner.slice(contentStart, close.index) : liInner.slice(contentStart),
    });
    pos = close ? close.index + close[0].length : liInner.length;
  }
  return { direct, nested };
}

// Render the rows of a <ul>/<ol> as flat indented bullet rows in document order.
// Nested lists recurse with deeper indentation; blank items are skipped and
// numbering stays continuous. Returns row Views (empty array ⇒ nothing to show).
function renderListRows(
  inner: string,
  listType: "ul" | "ol",
  keyPrefix: string,
  depth: number,
): JSX.Element[] {
  const rows: JSX.Element[] = [];
  const liOpenRe = /<li\b[^>]*>/gi;
  let pos = 0;
  let number = 0;
  let idx = 0;
  while (pos < inner.length) {
    liOpenRe.lastIndex = pos;
    const m = liOpenRe.exec(inner);
    if (!m) break;
    const contentStart = m.index + m[0].length;
    const close = findMatchingClose(inner, "li", contentStart);
    const liInner = close ? inner.slice(contentStart, close.index) : inner.slice(contentStart);
    pos = close ? close.index + close[0].length : inner.length;

    const { direct, nested } = splitNestedLists(liInner);
    const runs = tokenize(direct);
    // Skip empty / whitespace-only items (e.g. TipTap's <li><p></p></li>), the
    // same guard paragraphs use, so a blank item is not a stray bullet.
    if (runsHaveContent(runs)) {
      const bullet = listType === "ul" ? "• " : `${number + 1}. `;
      rows.push(
        <View
          key={`${keyPrefix}-i${idx}`}
          style={{ flexDirection: "row", marginBottom: 2, marginLeft: depth * 16 }}
        >
          <Text style={{ width: 16 }}>{bullet}</Text>
          <Text style={{ flex: 1 }}>{renderRuns(runs, `${keyPrefix}-i${idx}`)}</Text>
        </View>,
      );
      number += 1;
      idx += 1;
    }
    for (const child of nested) {
      rows.push(...renderListRows(child.inner, child.type, `${keyPrefix}-n${idx}`, depth + 1));
      idx += 1;
    }
  }
  return rows;
}

// Convert a subset of editor HTML into an array of <View> / <Text> nodes.
// Empty / whitespace-only input returns an empty array. The scan recognizes
// <p>, <ul>, <ol> as blocks (lists nest); unrecognized open tags are skipped
// (their inner content still renders) and stray close tags are dropped, so a
// tag name can never surface as visible body text.
export function htmlToPdfNodes(html: string | null | undefined): JSX.Element[] {
  if (!html) return [];
  const cleaned = normalizeBlocks(html);
  const out: JSX.Element[] = [];
  let pos = 0;
  let i = 0;
  let stray = "";

  const flushStray = () => {
    if (stray) {
      const runs = tokenize(stray);
      if (runsHaveContent(runs)) {
        out.push(
          <Text key={`s-${i}`} style={{ marginBottom: 4 }}>{renderRuns(runs, `s-${i}`)}</Text>,
        );
        i += 1;
      }
      stray = "";
    }
  };

  while (pos < cleaned.length) {
    const lt = cleaned.indexOf("<", pos);
    if (lt === -1) {
      stray += cleaned.slice(pos);
      break;
    }
    if (lt > pos) stray += cleaned.slice(pos, lt);

    const tagMatch = /^<(\/?)([a-z][a-z0-9]*)\b[^>]*>/i.exec(cleaned.slice(lt));
    if (!tagMatch) {
      // A lone '<' that doesn't start a tag — keep it as text, advance one char.
      stray += "<";
      pos = lt + 1;
      continue;
    }
    const isClose = tagMatch[1] === "/";
    const tag = tagMatch[2].toLowerCase();
    const afterOpen = lt + tagMatch[0].length;

    if (isClose) {
      // A stray top-level close tag — drop it (no leak).
      pos = afterOpen;
      continue;
    }
    if (tag === "p" || tag === "ul" || tag === "ol") {
      flushStray();
      const close = findMatchingClose(cleaned, tag, afterOpen);
      const inner = close ? cleaned.slice(afterOpen, close.index) : cleaned.slice(afterOpen);
      pos = close ? close.index + close[0].length : cleaned.length;
      if (tag === "p") {
        const runs = tokenize(inner);
        if (runsHaveContent(runs)) {
          out.push(
            <Text key={`p-${i}`} style={{ marginBottom: 4 }}>{renderRuns(runs, `p-${i}`)}</Text>,
          );
          i += 1;
        }
      } else {
        const rows = renderListRows(inner, tag, `list-${i}`, 0);
        // A genuinely empty (or all-blank) list contributes nothing, so an empty
        // write-up stays empty and the intro page renders heading-only.
        if (rows.length > 0) {
          out.push(<View key={`list-${i}`}>{rows}</View>);
          i += 1;
        }
      }
    } else {
      // Unrecognized open tag (e.g. a top-level inline wrapper) — skip the tag
      // itself; its inner content keeps flowing through the scan.
      pos = afterOpen;
    }
  }
  flushStray();
  return out;
}

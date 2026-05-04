// src/lib/pdf-renderer/html-to-pdf.tsx — minimal HTML → @react-pdf converter.
// Statements (estimate/invoice opening + closing) are stored as HTML strings by
// the Tiptap editor in src/components/estimate-builder/statement-editor.tsx. We
// only support the subset the editor produces: <p>, <strong>/<b>, <em>/<i>,
// <ul>, <ol>, <li>, <br>. Image nodes are stripped (out of scope for v1).

import { Text, View } from "@react-pdf/renderer";
import { JSX } from "react";

interface Run { text: string; bold?: boolean; italic?: boolean; }

// Tokenize a fragment of HTML into plain runs. Naive parser sufficient for the
// editor's output; not a general HTML parser.
function tokenize(html: string): Run[] {
  const runs: Run[] = [];
  const re = /<\/?(strong|b|em|i)>|([^<]+)/gi;
  let bold = false;
  let italic = false;
  for (const m of html.matchAll(re)) {
    const tag = m[1];
    const text = m[2];
    if (tag) {
      const isClose = m[0].startsWith("</");
      const t = tag.toLowerCase();
      if (t === "strong" || t === "b") bold = !isClose;
      else if (t === "em" || t === "i") italic = !isClose;
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

// Splits the HTML into block-level chunks (<p>, <ul>, <ol>, top-level text).
// Returns an array of <View> / <Text> nodes. Empty / whitespace-only string
// returns an empty array.
export function htmlToPdfNodes(html: string | null | undefined): JSX.Element[] {
  if (!html) return [];
  // Strip images outright.
  const cleaned = html.replace(/<img[^>]*>/gi, "");
  // Match top-level blocks. Anything not inside a block becomes a paragraph.
  const blockRe = /<(p|ul|ol)>([\s\S]*?)<\/\1>|([^<]+)/gi;
  const out: JSX.Element[] = [];
  let i = 0;
  for (const m of cleaned.matchAll(blockRe)) {
    const tag = m[1]?.toLowerCase();
    const inner = m[2];
    const stray = m[3]?.trim();
    if (tag === "p") {
      const runs = tokenize(inner);
      if (runs.length > 0) {
        out.push(<Text key={`p-${i}`} style={{ marginBottom: 4 }}>{renderRuns(runs, `p-${i}`)}</Text>);
      }
    } else if (tag === "ul" || tag === "ol") {
      const items: JSX.Element[] = [];
      let li = 0;
      const liRe = /<li>([\s\S]*?)<\/li>/gi;
      for (const liM of inner.matchAll(liRe)) {
        const runs = tokenize(liM[1]);
        const bullet = tag === "ul" ? "• " : `${li + 1}. `;
        items.push(
          <View key={`l-${i}-${li}`} style={{ flexDirection: "row", marginBottom: 2 }}>
            <Text style={{ width: 16 }}>{bullet}</Text>
            <Text style={{ flex: 1 }}>{renderRuns(runs, `l-${i}-${li}`)}</Text>
          </View>,
        );
        li += 1;
      }
      out.push(<View key={`list-${i}`}>{items}</View>);
    } else if (stray) {
      const runs = tokenize(stray);
      if (runs.length > 0) {
        out.push(<Text key={`s-${i}`} style={{ marginBottom: 4 }}>{renderRuns(runs, `s-${i}`)}</Text>);
      }
    }
    i += 1;
  }
  return out;
}

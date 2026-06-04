import { describe, expect, it } from "vitest";

import { htmlToPdfNodes } from "./html-to-pdf";
import {
  collectText,
  expandTree,
  findAll,
} from "@/components/report-pdf/test-helpers";

// htmlToPdfNodes is the minimal HTML → @react-pdf mapping shared by estimate /
// invoice statements (StatementBlock) and now the Photo Report section intro
// page (issue #403). It only understands the subset the TipTap editor emits.
// These tests pin that contract because the intro page makes it load-bearing.

// Expand the returned primitive nodes and read their concatenated text.
function text(html: string | null | undefined): string {
  return collectText(expandTree(htmlToPdfNodes(html)));
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flattenStyle(s) }),
      {},
    );
  }
  if (style && typeof style === "object") return style as Record<string, unknown>;
  return {};
}

// Every top-level paragraph is a TEXT node carrying the block marginBottom; the
// bullet glyph / number is a separate narrow TEXT inside a row VIEW. Counting
// the paragraph-level TEXT nodes (those with a marginBottom) approximates "how
// many blocks did we emit".
function paragraphCount(html: string): number {
  const tree = expandTree(htmlToPdfNodes(html));
  return findAll(
    tree,
    (n) => n.type === "TEXT" && flattenStyle(n.props.style).marginBottom === 4,
  ).length;
}

describe("htmlToPdfNodes", () => {
  it("returns nothing for empty, null, or undefined input", () => {
    expect(htmlToPdfNodes("")).toHaveLength(0);
    expect(htmlToPdfNodes(null)).toHaveLength(0);
    expect(htmlToPdfNodes(undefined)).toHaveLength(0);
  });

  it("renders each <p> as its own paragraph, in document order", () => {
    expect(text("<p>First paragraph.</p><p>Second paragraph.</p>")).toBe(
      "First paragraph.Second paragraph.",
    );
    expect(paragraphCount("<p>First paragraph.</p><p>Second paragraph.</p>")).toBe(
      2,
    );
  });

  it("renders a <ul> as bullet rows", () => {
    expect(text("<ul><li>Alpha</li><li>Beta</li></ul>")).toBe("• Alpha• Beta");
  });

  it("renders an <ol> as numbered rows, counting from 1", () => {
    expect(text("<ol><li>One</li><li>Two</li><li>Three</li></ol>")).toBe(
      "1. One2. Two3. Three",
    );
  });

  it("tolerates TipTap's <li><p>…</p></li> list serialization", () => {
    // StarterKit wraps list-item content in a paragraph; the bullet text must
    // still come through without the inner <p> leaking.
    expect(text("<ul><li><p>Wrapped item</p></li></ul>")).toBe("• Wrapped item");
  });

  it("applies bold styling to <strong> and italic to <em> runs", () => {
    const tree = expandTree(
      htmlToPdfNodes("<p>Plain <strong>bold</strong> and <em>italic</em>.</p>"),
    );

    const bold = findAll(tree, (n) => n.type === "TEXT" && n.props.children === "bold")
      .map((n) => flattenStyle(n.props.style))
      .find((s) => s.fontWeight === "bold");
    expect(bold).toBeDefined();

    const italic = findAll(
      tree,
      (n) => n.type === "TEXT" && n.props.children === "italic",
    )
      .map((n) => flattenStyle(n.props.style))
      .find((s) => s.fontStyle === "italic");
    expect(italic).toBeDefined();
  });

  it("guards against empty / whitespace-only paragraphs", () => {
    expect(htmlToPdfNodes("<p></p>")).toHaveLength(0);
    expect(htmlToPdfNodes("<p>   </p>")).toHaveLength(0);
    // A blank paragraph between two real ones is dropped, not rendered blank.
    expect(text("<p>real</p><p></p><p>also</p>")).toBe("realalso");
    expect(paragraphCount("<p>real</p><p></p><p>also</p>")).toBe(2);
  });

  it("strips <img> tags entirely, keeping the surrounding text", () => {
    const out = text('<p>Before<img src="photo.jpg" />After</p>');
    expect(out).toBe("BeforeAfter");
    expect(out).not.toContain("photo.jpg");
    // A lone image produces no node at all.
    expect(htmlToPdfNodes('<img src="lonely.jpg">')).toHaveLength(0);
  });

  it("treats <b>/<i> the same as <strong>/<em>", () => {
    const tree = expandTree(
      htmlToPdfNodes("<p>Plain <b>bold-alt</b> and <i>italic-alt</i>.</p>"),
    );

    const bold = findAll(
      tree,
      (n) => n.type === "TEXT" && n.props.children === "bold-alt",
    )
      .map((n) => flattenStyle(n.props.style))
      .find((s) => s.fontWeight === "bold");
    expect(bold).toBeDefined();

    const italic = findAll(
      tree,
      (n) => n.type === "TEXT" && n.props.children === "italic-alt",
    )
      .map((n) => flattenStyle(n.props.style))
      .find((s) => s.fontStyle === "italic");
    expect(italic).toBeDefined();
  });

  it("drops empty lists and empty / whitespace-only list items", () => {
    // An empty list must yield NO node, so an "empty write-up" stays empty and
    // the intro page renders heading-only (no stray bullet block).
    expect(htmlToPdfNodes("<ul></ul>")).toHaveLength(0);
    expect(htmlToPdfNodes("<ol></ol>")).toHaveLength(0);
    expect(htmlToPdfNodes("<ul><li>   </li></ul>")).toHaveLength(0);
    // TipTap serialises a blank list item as <li><p></p></li>.
    expect(htmlToPdfNodes("<ul><li><p></p></li></ul>")).toHaveLength(0);
    // A blank item among real ones is skipped; numbering stays continuous.
    expect(text("<ul><li>Real</li><li>   </li></ul>")).toBe("• Real");
    expect(text("<ol><li>One</li><li>  </li><li>Two</li></ol>")).toBe(
      "1. One2. Two",
    );
  });
});

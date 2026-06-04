import { describe, expect, it } from "vitest";

import SectionDividerPage from "./section-divider-page";
import { collectText, expandTree, findAll } from "./test-helpers";

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

describe("SectionDividerPage", () => {
  it("renders the section title large and centered", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Living Room"
        description={null}
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Living Room");

    const titleNodes = findAll(
      tree,
      (n) =>
        n.type === "TEXT" &&
        typeof n.props.children === "string" &&
        (n.props.children as string) === "Living Room",
    );
    // The title TEXT and the footer's section label both render the string.
    // The title is the one whose font size is large.
    const big = titleNodes
      .map((n) => flattenStyle(n.props.style))
      .find((s) => Number(s.fontSize) >= 28);
    expect(big).toBeDefined();
    expect(big!.textAlign).toBe("center");
  });

  it("renders the description beneath the title when present", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Living Room"
        description="Buckled flooring after water loss."
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={9}
      />,
    );

    expect(collectText(tree)).toContain("Buckled flooring after water loss.");
  });

  it("omits the description block when description is null or empty", () => {
    for (const description of [null, ""]) {
      const tree = expandTree(
        <SectionDividerPage
          title="Living Room"
          description={description}
          customerName="Jane Doe"
          reportDate="2026-05-19"
          pageNumber={2}
          totalPages={9}
        />,
      );

      const text = collectText(tree);
      // No stray bullet/dash characters where the description would go.
      expect(text).toContain("Living Room");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
    }
  });

  it("renders the page header and footer (section name in footer-left, page counter, customer)", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Living Room"
        description={null}
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={5}
      />,
    );

    const text = collectText(tree);
    // Header
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Photo Report");
    expect(text).toContain("May 19, 2026");
    // Footer: section identifier left, page counter center, customer right
    expect(text).toContain("Living Room");
    expect(text).toContain("2 / 5");
  });

  // ── The write-up is rich text (issue #403) ─────────────────────────────────
  // The Section write-up is now HTML authored in the TipTap editor, stored in
  // `description`. The intro page renders it through the shared HTML→PDF
  // mapping, so a bullet list becomes real bullet rows rather than the literal
  // `<ul>…</ul>` source string.
  it("renders a bullet-list write-up as bullet rows, not raw HTML", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Findings"
        description="<ul><li>Buckled flooring</li><li>Standing water</li></ul>"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    // Bullet glyph + item text, emitted by htmlToPdfNodes.
    expect(text).toContain("• Buckled flooring");
    expect(text).toContain("• Standing water");
    // The raw list tags must not leak into the rendered text.
    expect(text).not.toContain("<ul>");
    expect(text).not.toContain("<li>");
  });

  it("renders a numbered-list write-up with 1./2. markers", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Work performed"
        description="<ol><li>Extracted standing water</li><li>Set air movers</li></ol>"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={3}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("1. Extracted standing water");
    expect(text).toContain("2. Set air movers");
    expect(text).not.toContain("<ol>");
  });

  it("renders bold and italic runs from the write-up as styled text", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Findings"
        description="<p>Severe <strong>structural</strong> and <em>cosmetic</em> damage.</p>"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={9}
      />,
    );

    expect(collectText(tree)).toContain("Severe structural and cosmetic damage.");

    const boldRun = findAll(
      tree,
      (n) => n.type === "TEXT" && n.props.children === "structural",
    )
      .map((n) => flattenStyle(n.props.style))
      .find((s) => s.fontWeight === "bold");
    expect(boldRun).toBeDefined();

    const italicRun = findAll(
      tree,
      (n) => n.type === "TEXT" && n.props.children === "cosmetic",
    )
      .map((n) => flattenStyle(n.props.style))
      .find((s) => s.fontStyle === "italic");
    expect(italicRun).toBeDefined();
  });

  it("renders heading-only (no block) for a TipTap-empty write-up", () => {
    // TipTap serialises a blank editor as `<p></p>`; a stray space saves as
    // `<p> </p>`. Neither must produce a write-up block on the intro page.
    for (const description of ["<p></p>", "<p>   </p>"]) {
      const tree = expandTree(
        <SectionDividerPage
          title="Just photos"
          description={description}
          customerName="Jane Doe"
          reportDate="2026-05-19"
          pageNumber={2}
          totalPages={9}
        />,
      );

      const text = collectText(tree);
      expect(text).toContain("Just photos");
      expect(text).not.toContain("<p>");
      // No bullet or list markers where an empty write-up would have rendered.
      expect(text).not.toContain("•");
    }
  });

  it("renders heading-only when the write-up is an emptied list (no stray bullet block)", () => {
    // A user who starts a bullet then clears it can leave an empty list behind;
    // that is still an empty write-up — heading only, no blank bullet.
    const tree = expandTree(
      <SectionDividerPage
        title="Just photos"
        description="<ul><li><p></p></li></ul>"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Just photos");
    expect(text).not.toContain("•");
  });
});

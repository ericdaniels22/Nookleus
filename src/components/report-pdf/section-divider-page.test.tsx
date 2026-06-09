import { describe, expect, it } from "vitest";

import SectionDividerPage from "./section-divider-page";
import { collectText, expandTree, findAll, flattenStyle } from "./test-helpers";

describe("SectionDividerPage", () => {
  it("renders the section title large and centered", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Living Room"
        description={null}
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
          pageNumber={2}
          totalPages={9}
        />,
      );

      const text = collectText(tree);
      expect(text).toContain("Living Room");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
    }
  });

  it("drops the top header and keeps the section footer + 'Page X of Y'", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Living Room"
        description={null}
        pageNumber={2}
        totalPages={5}
      />,
    );

    const text = collectText(tree);
    expect(text).not.toContain("Photo Report");
    expect(text).toContain("Living Room");
    expect(text).toContain("Page 2 of 5");
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
        pageNumber={2}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("• Buckled flooring");
    expect(text).toContain("• Standing water");
    expect(text).not.toContain("<ul>");
    expect(text).not.toContain("<li>");
  });

  it("renders a numbered-list write-up with 1./2. markers", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Work performed"
        description="<ol><li>Extracted standing water</li><li>Set air movers</li></ol>"
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
    for (const description of ["<p></p>", "<p>   </p>"]) {
      const tree = expandTree(
        <SectionDividerPage
          title="Just photos"
          description={description}
          pageNumber={2}
          totalPages={9}
        />,
      );

      const text = collectText(tree);
      expect(text).toContain("Just photos");
      expect(text).not.toContain("<p>");
      expect(text).not.toContain("•");
    }
  });

  it("renders a heading-in-write-up as clean text, never the raw <h2> source", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Findings"
        description="<h2>Demo Findings</h2><p>Water intrusion along the north wall.</p>"
        pageNumber={2}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Demo Findings");
    expect(text).toContain("Water intrusion along the north wall.");
    expect(text).not.toContain("h2>");
    expect(text).not.toContain("<h2");
  });

  it("renders heading-only when the write-up is an emptied list (no stray bullet block)", () => {
    const tree = expandTree(
      <SectionDividerPage
        title="Just photos"
        description="<ul><li><p></p></li></ul>"
        pageNumber={2}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Just photos");
    expect(text).not.toContain("•");
  });
});

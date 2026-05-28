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
});

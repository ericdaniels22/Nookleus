import { describe, expect, it } from "vitest";

import PageFooter from "./page-footer";
import { collectText, expandTree, findAll } from "./test-helpers";

describe("PageFooter", () => {
  it("renders the section name on the left", () => {
    const tree = expandTree(
      <PageFooter sectionTitle="Exterior" pageNumber={2} totalPages={7} />,
    );
    expect(collectText(tree)).toContain("Exterior");
  });

  it("renders a 'Page X of Y' counter using the supplied static numbers", () => {
    const tree = expandTree(
      <PageFooter sectionTitle="Exterior" pageNumber={2} totalPages={7} />,
    );
    expect(collectText(tree)).toContain("Page 2 of 7");
  });

  it("uses react-pdf's dynamic page render fn when pageNumber is omitted", () => {
    const tree = expandTree(<PageFooter sectionTitle="Exterior" />);
    // Look for a TEXT node carrying a `render` function (react-pdf dynamic
    // text). That is how the live PDF resolves {pageNumber}/{totalPages}.
    const dynamicTexts = findAll(
      tree,
      (n) => n.type === "TEXT" && typeof n.props.render === "function",
    );
    expect(dynamicTexts.length).toBeGreaterThan(0);
    // And that render fn produces the "Page X of Y" wording.
    const rendered = (
      dynamicTexts[0].props.render as (p: {
        pageNumber: number;
        totalPages: number;
      }) => string
    )({ pageNumber: 2, totalPages: 7 });
    expect(rendered).toBe("Page 2 of 7");
  });
});

import { describe, expect, it } from "vitest";

import PageFooter from "./page-footer";
import { collectText, expandTree, findAll } from "./test-helpers";

describe("PageFooter", () => {
  it("renders the section name on the left, customer on the right", () => {
    const tree = expandTree(
      <PageFooter
        sectionTitle="Exterior"
        customerName="Jane Doe"
        pageNumber={2}
        totalPages={7}
      />,
    );
    const text = collectText(tree);
    expect(text).toContain("Exterior");
    expect(text).toContain("Jane Doe");
  });

  it("renders 'X / Y' page counter using the supplied static numbers", () => {
    const tree = expandTree(
      <PageFooter
        sectionTitle="Exterior"
        customerName="Jane Doe"
        pageNumber={2}
        totalPages={7}
      />,
    );
    expect(collectText(tree)).toContain("2 / 7");
  });

  it("uses react-pdf's dynamic page render fn when pageNumber is omitted", () => {
    const tree = expandTree(
      <PageFooter sectionTitle="Exterior" customerName="Jane Doe" />,
    );
    // Look for a TEXT node carrying a `render` function (react-pdf dynamic
    // text). That is how the live PDF resolves {pageNumber}/{totalPages}.
    const dynamicTexts = findAll(
      tree,
      (n) => n.type === "TEXT" && typeof n.props.render === "function",
    );
    expect(dynamicTexts.length).toBeGreaterThan(0);
  });
});

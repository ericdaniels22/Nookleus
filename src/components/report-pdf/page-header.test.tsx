import { describe, expect, it } from "vitest";

import PageHeader from "./page-header";
import { collectText, expandTree } from "./test-helpers";

describe("PageHeader", () => {
  it("renders customer name and 'Photo Report' label on the left", () => {
    const tree = expandTree(
      <PageHeader customerName="Jane Doe" reportDate="2026-05-19" />,
    );
    expect(collectText(tree)).toContain("Jane Doe");
    expect(collectText(tree)).toContain("Photo Report");
  });

  it("renders the report date formatted as 'MMM d, yyyy'", () => {
    const tree = expandTree(
      <PageHeader customerName="Jane Doe" reportDate="2026-05-19" />,
    );
    expect(collectText(tree)).toContain("May 19, 2026");
  });

  it("omits the customer chunk when the name is empty, still shows 'Photo Report'", () => {
    const tree = expandTree(
      <PageHeader customerName="" reportDate="2026-05-19" />,
    );
    const text = collectText(tree);
    expect(text).toContain("Photo Report");
    expect(text).not.toContain("—  —");
  });
});

import { describe, expect, it } from "vitest";

import CoverPage from "./cover-page";
import type { CoverPageData } from "@/lib/cover-page-data";
import { collectText, expandTree, findAll } from "./test-helpers";

function makeData(overrides: Partial<CoverPageData> = {}): CoverPageData {
  return {
    logo: { kind: "text", name: "AAA Disaster Recovery" },
    customerName: "Jane Doe",
    propertyAddress: "123 Main St",
    pointOfContact: {
      companyName: "AAA Disaster Recovery",
      phone: "555-1234",
      email: "info@aaa.example",
    },
    insurance: { visible: true, carrier: "State Farm", claimNumber: "CLM-001" },
    ...overrides,
  };
}

describe("CoverPage", () => {
  it('falls back to "Photo Report" when the title is empty', () => {
    const tree = expandTree(
      <CoverPage
        data={makeData()}
        title=""
        coverPhotoUrl={null}
        logoUrl={null}
      />,
    );

    expect(collectText(tree)).toContain("Photo Report");
  });

  it('still falls back to "Photo Report" when the title is only whitespace', () => {
    const tree = expandTree(
      <CoverPage
        data={makeData()}
        title="   "
        coverPhotoUrl={null}
        logoUrl={null}
      />,
    );

    expect(collectText(tree)).toContain("Photo Report");
  });

  it("renders a provided title unchanged, without the fallback", () => {
    const tree = expandTree(
      <CoverPage
        data={makeData()}
        title="Mitigation Scope"
        coverPhotoUrl={null}
        logoUrl={null}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Mitigation Scope");
    expect(text).not.toContain("Photo Report");
  });

  it("renders the customer name from the cover data", () => {
    const tree = expandTree(
      <CoverPage
        data={makeData({ customerName: "Acme Restoration LLC" })}
        title="Site Report"
        coverPhotoUrl={null}
        logoUrl={null}
      />,
    );

    expect(collectText(tree)).toContain("Acme Restoration LLC");
  });

  it("renders the insurance block when it is visible", () => {
    const tree = expandTree(
      <CoverPage
        data={makeData({
          insurance: {
            visible: true,
            carrier: "State Farm",
            claimNumber: "CLM-001",
          },
        })}
        title="Site Report"
        coverPhotoUrl={null}
        logoUrl={null}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Insurance Carrier:");
    expect(text).toContain("State Farm");
    expect(text).toContain("Claim Number:");
    expect(text).toContain("CLM-001");
  });

  it("omits the insurance block when it is hidden", () => {
    const tree = expandTree(
      <CoverPage
        data={makeData({
          insurance: { visible: false, carrier: "", claimNumber: "" },
        })}
        title="Site Report"
        coverPhotoUrl={null}
        logoUrl={null}
      />,
    );

    const text = collectText(tree);
    expect(text).not.toContain("Insurance Carrier:");
    expect(text).not.toContain("Claim Number:");
  });

  it("renders the company name as a styled-text logo when there is no image logo", () => {
    const tree = expandTree(
      <CoverPage
        data={makeData({ logo: { kind: "text", name: "AAA Disaster Recovery" } })}
        title="Site Report"
        coverPhotoUrl={null}
        logoUrl={null}
      />,
    );

    expect(collectText(tree)).toContain("AAA Disaster Recovery");
    // No image logo branch was taken, and no cover photo was supplied, so the
    // page renders no IMAGE primitives at all.
    expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(0);
  });

  it("renders the image logo when an image logo is provided", () => {
    const tree = expandTree(
      <CoverPage
        data={makeData({ logo: { kind: "image", path: "logos/co.png" } })}
        title="Site Report"
        coverPhotoUrl={null}
        logoUrl="https://cdn.example/logo.png"
      />,
    );

    const imageUrls = findAll(tree, (n) => n.type === "IMAGE").map(
      (n) => n.props.src as string,
    );
    expect(imageUrls).toContain("https://cdn.example/logo.png");
  });
});

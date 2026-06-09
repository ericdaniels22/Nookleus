import { describe, expect, it } from "vitest";

import CoverPage from "./cover-page";
import type { RenderCover } from "@/lib/report-render-model";
import { PHOTO_CORNER_RADIUS } from "./photo-page";
import { collectText, expandTree, findAll, flattenStyle } from "./test-helpers";

function makeCover(overrides: Partial<RenderCover> = {}): RenderCover {
  return {
    title: "Site Report",
    logo: { kind: "text", name: "AAA Disaster Recovery" },
    customerName: "Jane Doe",
    propertyAddress: "123 Main St",
    pointOfContact: {
      companyName: "AAA Disaster Recovery",
      phone: "555-1234",
      email: "info@aaa.example",
    },
    insurance: { visible: true, carrier: "State Farm", claimNumber: "CLM-001" },
    coverPhotoUrl: null,
    ...overrides,
  };
}

describe("CoverPage (title)", () => {
  it('falls back to "Photo Report" when the title is empty or whitespace', () => {
    for (const title of ["", "   "]) {
      const tree = expandTree(
        <CoverPage cover={makeCover({ title })} logoUrl={null} />,
      );
      expect(collectText(tree)).toContain("Photo Report");
    }
  });

  it("renders a provided title unchanged, without the fallback", () => {
    const tree = expandTree(
      <CoverPage cover={makeCover({ title: "Mitigation Scope" })} logoUrl={null} />,
    );
    const text = collectText(tree);
    expect(text).toContain("Mitigation Scope");
    expect(text).not.toContain("Photo Report");
  });
});

describe("CoverPage (resolved blocks)", () => {
  it("renders the customer name when present and omits the Customer block when null", () => {
    const shown = expandTree(
      <CoverPage
        cover={makeCover({ customerName: "Acme Restoration LLC" })}
        logoUrl={null}
      />,
    );
    expect(collectText(shown)).toContain("Acme Restoration LLC");

    const hidden = expandTree(
      <CoverPage cover={makeCover({ customerName: null })} logoUrl={null} />,
    );
    expect(collectText(hidden)).not.toContain("Customer");
  });

  it("renders the property address when present and omits the Property block when null", () => {
    const shown = expandTree(
      <CoverPage
        cover={makeCover({ propertyAddress: "742 Evergreen Terrace" })}
        logoUrl={null}
      />,
    );
    expect(collectText(shown)).toContain("742 Evergreen Terrace");

    const hidden = expandTree(
      <CoverPage cover={makeCover({ propertyAddress: null })} logoUrl={null} />,
    );
    expect(collectText(hidden)).not.toContain("Property");
  });

  it("renders the point of contact when present and omits it entirely when null", () => {
    const shown = expandTree(
      <CoverPage
        cover={makeCover({
          pointOfContact: {
            companyName: "Bravo Co",
            phone: "555-9000",
            email: "hi@bravo.example",
          },
        })}
        logoUrl={null}
      />,
    );
    const shownText = collectText(shown);
    expect(shownText).toContain("Point of contact");
    expect(shownText).toContain("Bravo Co");
    expect(shownText).toContain("555-9000");
    expect(shownText).toContain("hi@bravo.example");

    const hidden = expandTree(
      <CoverPage cover={makeCover({ pointOfContact: null })} logoUrl={null} />,
    );
    expect(collectText(hidden)).not.toContain("Point of contact");
  });

  it("renders the insurance block only when it is present and visible", () => {
    const shown = expandTree(
      <CoverPage
        cover={makeCover({
          insurance: { visible: true, carrier: "State Farm", claimNumber: "CLM-001" },
        })}
        logoUrl={null}
      />,
    );
    const text = collectText(shown);
    expect(text).toContain("Insurance Carrier:");
    expect(text).toContain("State Farm");
    expect(text).toContain("Claim Number:");
    expect(text).toContain("CLM-001");

    const hiddenByNull = expandTree(
      <CoverPage cover={makeCover({ insurance: null })} logoUrl={null} />,
    );
    expect(collectText(hiddenByNull)).not.toContain("Insurance Carrier:");

    const hiddenByFlag = expandTree(
      <CoverPage
        cover={makeCover({
          insurance: { visible: false, carrier: "x", claimNumber: "y" },
        })}
        logoUrl={null}
      />,
    );
    expect(collectText(hiddenByFlag)).not.toContain("Insurance Carrier:");
  });
});

describe("CoverPage (logo)", () => {
  it("renders the company name as a text logo when there is no image logo", () => {
    const tree = expandTree(
      <CoverPage
        cover={makeCover({ logo: { kind: "text", name: "AAA Disaster Recovery" } })}
        logoUrl={null}
      />,
    );
    expect(collectText(tree)).toContain("AAA Disaster Recovery");
    expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(0);
  });

  it("renders the image logo when an image logo is provided", () => {
    const tree = expandTree(
      <CoverPage
        cover={makeCover({ logo: { kind: "image", path: "logos/co.png" } })}
        logoUrl="https://cdn.example/logo.png"
      />,
    );
    const urls = findAll(tree, (n) => n.type === "IMAGE").map(
      (n) => n.props.src as string,
    );
    expect(urls).toContain("https://cdn.example/logo.png");
  });

  it("renders no logo at all when the logo block is hidden (null)", () => {
    // Null out the point of contact too: its companyName is the same string as
    // the text logo, so this isolates the logo as the only source of the name.
    const tree = expandTree(
      <CoverPage
        cover={makeCover({ logo: null, pointOfContact: null })}
        logoUrl={null}
      />,
    );
    expect(collectText(tree)).not.toContain("AAA Disaster Recovery");
  });
});

describe("CoverPage (cover photo)", () => {
  it("applies the shared corner radius to the cover photo", () => {
    const tree = expandTree(
      <CoverPage
        cover={makeCover({ coverPhotoUrl: "https://cdn.example/cover.jpg" })}
        logoUrl={null}
      />,
    );
    const cover = findAll(tree, (n) => n.type === "IMAGE").find(
      (n) => n.props.src === "https://cdn.example/cover.jpg",
    );
    expect(cover).toBeDefined();
    expect(flattenStyle(cover!.props.style).borderRadius).toBe(
      PHOTO_CORNER_RADIUS,
    );
  });

  it("rounds the cover-photo placeholder with the same shared radius", () => {
    const tree = expandTree(
      <CoverPage cover={makeCover({ coverPhotoUrl: null })} logoUrl={null} />,
    );
    const rounded = findAll(
      tree,
      (n) =>
        n.type === "VIEW" &&
        flattenStyle(n.props.style).borderRadius === PHOTO_CORNER_RADIUS,
    );
    expect(rounded).toHaveLength(1);
  });
});

describe("CoverPage (prepared by)", () => {
  it("renders the 'Prepared by' line when a creator is supplied", () => {
    const tree = expandTree(
      <CoverPage cover={makeCover()} logoUrl={null} preparedBy="Eric Daniels" />,
    );
    expect(collectText(tree)).toContain("Eric Daniels");
  });
});

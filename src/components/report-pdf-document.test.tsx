import { describe, expect, it } from "vitest";

import ReportPDFDocument from "./report-pdf-document";
import { collectText, expandTree, findAll } from "./report-pdf/test-helpers";
import type {
  RenderCover,
  RenderSlot,
  ReportRenderModel,
} from "@/lib/report-render-model";

const cover: RenderCover = {
  title: "Mitigation Scope",
  logo: { kind: "text", name: "AAA Disaster Recovery" },
  customerName: "Jane Doe",
  propertyAddress: "123 Main St",
  pointOfContact: {
    companyName: "AAA Disaster Recovery",
    phone: null,
    email: null,
  },
  insurance: null,
  coverPhotoUrl: null,
};

function slot(
  photoId: string,
  url: string,
  number: number,
  caption: string | null = null,
): RenderSlot {
  return {
    photoId,
    url,
    number,
    caption,
    dateCaptured: null,
    capturedBy: null,
    location: null,
    tags: [],
    orientation: "portrait",
  };
}

// One page of every kind, in document order. Each kind's component emits a
// marker that no other page produces, so finding all four markers proves each
// kind routed to its own component.
const model: ReportRenderModel = {
  title: "Mitigation Scope",
  cover,
  pages: [
    { kind: "cover" },
    {
      kind: "sectionDivider",
      title: "Demolition Scope",
      description: "Tear-out work",
    },
    {
      kind: "beforeAfterPair",
      sectionTitle: "Restoration",
      before: slot("ba-before", "https://example.com/before.jpg", 1),
      after: slot("ba-after", "https://example.com/after.jpg", 2),
    },
    {
      kind: "photoPage",
      sectionTitle: "Findings",
      slots: [slot("pp-1", "https://example.com/pp1.jpg", 3, "Standalone shot")],
      photosPerPage: 2,
    },
  ],
};

describe("ReportPDFDocument", () => {
  it("maps each page kind to its corresponding page component", () => {
    const tree = expandTree(
      <ReportPDFDocument model={model} logoUrl={null} />,
    );

    const text = collectText(tree);

    // cover -> CoverPage. "Point of contact" and the report title are unique to
    // the cover; no other page renders either.
    expect(text).toContain("Point of contact");
    expect(text).toContain("Mitigation Scope");

    // sectionDivider -> SectionDividerPage.
    expect(text).toContain("Demolition Scope");
    expect(text).toContain("Tear-out work");

    // beforeAfterPair -> BeforeAfterPairPage.
    expect(text).toContain("Before");
    expect(text).toContain("After");

    // photoPage -> PhotoPage (its slot caption).
    expect(text).toContain("Standalone shot");

    // One PDF page per document page, none dropped or duplicated, cover first.
    const pageNodes = findAll(tree, (n) => n.type === "PAGE");
    expect(pageNodes).toHaveLength(model.pages.length);
    expect(collectText(pageNodes[0])).toContain("Point of contact");
  });
});

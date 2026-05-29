import { describe, expect, it } from "vitest";

import ReportPDFDocument from "./report-pdf-document";
import { collectText, expandTree, findAll } from "./report-pdf/test-helpers";
import type { CoverPageData } from "@/lib/cover-page-data";
import type { DocumentPage, PhotoSlot } from "@/lib/build-report-document";

const coverData: CoverPageData = {
  logo: { kind: "text", name: "AAA Disaster Recovery" },
  customerName: "Jane Doe",
  propertyAddress: "123 Main St",
  pointOfContact: { companyName: "AAA Disaster Recovery", phone: null, email: null },
  insurance: { visible: false, carrier: "", claimNumber: "" },
};

// Mirrors the (private) ReportPhoto shape the document resolves slots against.
// If the production prop type drifts, the `photos={photos}` prop below stops
// type-checking.
type DocPhoto = {
  id: string;
  url: string;
  caption: string | null;
  before_after_role: "before" | "after" | null;
  taken_at: string | null;
};

const photos: Record<string, DocPhoto> = {
  "ba-before": {
    id: "ba-before",
    url: "https://example.com/before.jpg",
    caption: null,
    before_after_role: "before",
    taken_at: null,
  },
  "ba-after": {
    id: "ba-after",
    url: "https://example.com/after.jpg",
    caption: null,
    before_after_role: "after",
    taken_at: null,
  },
  "pp-1": {
    id: "pp-1",
    url: "https://example.com/pp1.jpg",
    caption: "Standalone shot",
    before_after_role: null,
    taken_at: null,
  },
};

function slot(
  photoId: string,
  number: number,
  caption: string | null = null,
): PhotoSlot {
  return {
    photoId,
    number,
    caption,
    takenAt: null,
    takenBy: null,
    orientation: "portrait",
  };
}

// One page of every kind, in document order. Each kind's component emits a
// marker that no other page produces, so finding all four markers proves each
// kind routed to its own component.
const pages: DocumentPage[] = [
  { kind: "cover" },
  { kind: "sectionDivider", title: "Demolition Scope", description: "Tear-out work" },
  {
    kind: "beforeAfterPair",
    sectionTitle: "Restoration",
    before: slot("ba-before", 1),
    after: slot("ba-after", 2),
  },
  {
    kind: "photoPage",
    sectionTitle: "Findings",
    slots: [slot("pp-1", 3, "Standalone shot")],
    photosPerPage: 2,
  },
];

describe("ReportPDFDocument", () => {
  it("maps each page kind to its corresponding page component", () => {
    const tree = expandTree(
      <ReportPDFDocument
        title="Mitigation Scope"
        coverPageData={coverData}
        coverPhotoUrl={null}
        logoUrl={null}
        reportDate="2026-05-19"
        pages={pages}
        photos={photos}
      />,
    );

    const text = collectText(tree);

    // cover -> CoverPage. "Point of contact" and the report title are unique to
    // the cover; the page-header's hardcoded "Photo Report" label and the
    // customer name appear on every other page, so they cannot identify it.
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
    expect(pageNodes).toHaveLength(pages.length);
    expect(collectText(pageNodes[0])).toContain("Point of contact");
  });
});

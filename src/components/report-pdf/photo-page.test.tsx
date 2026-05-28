import { describe, expect, it } from "vitest";

import PhotoPage, { type PhotoPageSlot } from "./photo-page";
import { collectText, expandTree, findAll } from "./test-helpers";

function makeSlot(overrides: Partial<PhotoPageSlot> = {}): PhotoPageSlot {
  return {
    photoId: "p1",
    url: "https://example.com/p1.jpg",
    number: 1,
    caption: null,
    takenAt: "2026-05-19T11:03:00",
    takenBy: "Eric Daniels",
    orientation: "portrait",
    ...overrides,
  };
}

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

describe("PhotoPage (2-per-page)", () => {
  it("renders the caption (bold) when a slot has one, and omits caption text when null", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({ photoId: "p1", number: 1, caption: "Buckled subfloor" }),
          makeSlot({ photoId: "p2", number: 2, caption: null }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={3}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Buckled subfloor");

    // Find the TEXT node carrying the caption and verify it is bold.
    const captionTexts = findAll(
      tree,
      (n) =>
        n.type === "TEXT" &&
        typeof n.props.children === "string" &&
        (n.props.children as string).includes("Buckled subfloor"),
    );
    expect(captionTexts.length).toBe(1);
    const style = flattenStyle(captionTexts[0].props.style);
    expect(style.fontFamily).toBe("Helvetica-Bold");
  });

  it("renders the formatted date taken and the creator for each photo", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({
            photoId: "p1",
            number: 1,
            takenAt: "2026-05-19T11:03:00",
            takenBy: "Eric Daniels",
          }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={1}
        totalPages={1}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("May 19, 2026, 11:03 AM");
    expect(text).toContain("Eric Daniels");
  });

  it("renders a numbered badge for each photo with its slot number", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({ photoId: "p1", number: 5 }),
          makeSlot({ photoId: "p2", number: 6 }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={3}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("5");
    expect(text).toContain("6");
  });

  it("uses objectFit:'contain' (letterbox) for a landscape photo, 'cover' for portrait", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({
            photoId: "wide",
            number: 1,
            orientation: "landscape",
            url: "https://x/wide.jpg",
          }),
          makeSlot({
            photoId: "tall",
            number: 2,
            orientation: "portrait",
            url: "https://x/tall.jpg",
          }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={1}
        totalPages={1}
      />,
    );

    const images = findAll(tree, (n) => n.type === "IMAGE");
    expect(images.length).toBe(2);

    const styleByUrl = new Map(
      images.map((img) => {
        const src = img.props.src as string | undefined;
        return [src, flattenStyle(img.props.style)];
      }),
    );

    expect(styleByUrl.get("https://x/wide.jpg")?.objectFit).toBe("contain");
    expect(styleByUrl.get("https://x/tall.jpg")?.objectFit).toBe("cover");
  });

  it("renders the page header (customer + 'Photo Report' + report_date) and footer (section + counter + customer)", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[makeSlot()]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={2}
        totalPages={5}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Photo Report");
    expect(text).toContain("May 19, 2026");
    expect(text).toContain("Living Room");
    expect(text).toContain("2 / 5");
  });
});

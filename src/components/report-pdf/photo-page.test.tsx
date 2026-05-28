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

  it("places the metadata column to the side of the photo (row layout) when photosPerPage is 2", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[makeSlot({ photoId: "p1", number: 1, caption: "Side meta" })]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        photosPerPage={2}
      />,
    );

    const slotWrappers = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      const s = flattenStyle(n.props.style);
      return (
        s.flexDirection === "row" &&
        Array.isArray(n.props.children) === true
      );
    });
    expect(slotWrappers.length).toBeGreaterThanOrEqual(1);
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

describe("PhotoPage (1-per-page)", () => {
  it("renders the single photo with its caption, date, creator, and numbered badge", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({
            photoId: "p1",
            number: 7,
            caption: "Buckled subfloor",
            takenAt: "2026-05-19T11:03:00",
            takenBy: "Eric Daniels",
          }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={1}
        totalPages={5}
        photosPerPage={1}
      />,
    );

    const images = findAll(tree, (n) => n.type === "IMAGE");
    expect(images.length).toBe(1);

    const text = collectText(tree);
    expect(text).toContain("Buckled subfloor");
    expect(text).toContain("May 19, 2026, 11:03 AM");
    expect(text).toContain("Eric Daniels");
    expect(text).toContain("7");
  });

  it("stacks metadata beneath the photo (column layout) at photosPerPage=1", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[makeSlot({ photoId: "p1", number: 1, caption: "below" })]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        photosPerPage={1}
      />,
    );

    // No slot wrapper should be using row layout — meta is below, not beside.
    const rowSlotWrappers = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      const s = flattenStyle(n.props.style);
      // A "slot row" wrapper is a row-flex view that contains an image
      // somewhere in its subtree.
      if (s.flexDirection !== "row") return false;
      const imgs = findAll(n, (m) => m.type === "IMAGE");
      return imgs.length > 0;
    });
    expect(rowSlotWrappers.length).toBe(0);
  });

  it("renders the page header and footer at photosPerPage=1", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[makeSlot({ photoId: "p1", number: 1 })]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={3}
        totalPages={9}
        photosPerPage={1}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Photo Report");
    expect(text).toContain("May 19, 2026");
    expect(text).toContain("Living Room");
    expect(text).toContain("3 / 9");
  });
});

describe("PhotoPage (4-per-page)", () => {
  it("renders all four photos with their numbered badges, captions, dates, and creators", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({
            photoId: "p1",
            number: 10,
            caption: "one",
            takenAt: "2026-05-19T11:03:00",
            takenBy: "Eric",
          }),
          makeSlot({
            photoId: "p2",
            number: 11,
            caption: "two",
            takenAt: "2026-05-19T11:03:00",
            takenBy: "Eric",
          }),
          makeSlot({
            photoId: "p3",
            number: 12,
            caption: "three",
            takenAt: "2026-05-19T11:03:00",
            takenBy: "Eric",
          }),
          makeSlot({
            photoId: "p4",
            number: 13,
            caption: "four",
            takenAt: "2026-05-19T11:03:00",
            takenBy: "Eric",
          }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        photosPerPage={4}
      />,
    );

    const images = findAll(tree, (n) => n.type === "IMAGE");
    expect(images.length).toBe(4);

    const text = collectText(tree);
    for (const word of ["one", "two", "three", "four"]) {
      expect(text).toContain(word);
    }
    for (const num of ["10", "11", "12", "13"]) {
      expect(text).toContain(num);
    }
  });

  it("arranges the four tiles in a 2x2 grid (row-flex wrapper with flexWrap='wrap')", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({ photoId: "p1", number: 1 }),
          makeSlot({ photoId: "p2", number: 2 }),
          makeSlot({ photoId: "p3", number: 3 }),
          makeSlot({ photoId: "p4", number: 4 }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        photosPerPage={4}
      />,
    );

    const gridWrappers = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      const s = flattenStyle(n.props.style);
      if (s.flexDirection !== "row" || s.flexWrap !== "wrap") return false;
      const imgs = findAll(n, (m) => m.type === "IMAGE");
      return imgs.length === 4;
    });
    expect(gridWrappers.length).toBe(1);
  });

  it("stacks metadata beneath each tile (no row-layout slot wrapper around an image) at photosPerPage=4", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({ photoId: "p1", number: 1, caption: "a" }),
          makeSlot({ photoId: "p2", number: 2, caption: "b" }),
          makeSlot({ photoId: "p3", number: 3, caption: "c" }),
          makeSlot({ photoId: "p4", number: 4, caption: "d" }),
        ]}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        photosPerPage={4}
      />,
    );

    // A "tile" is a column-flex wrapper that contains exactly one image.
    const tiles = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      const imgs = findAll(n, (m) => m.type === "IMAGE");
      if (imgs.length !== 1) return false;
      const s = flattenStyle(n.props.style);
      // Either explicit column or no flexDirection (default is column in
      // react-pdf). Importantly NOT row — that would put meta to the side.
      return s.flexDirection !== "row";
    });
    expect(tiles.length).toBeGreaterThanOrEqual(4);
  });

  it("handles a partial final page of 1, 2, or 3 tiles without breaking the 2x2 grid wrapper", () => {
    for (const count of [1, 2, 3]) {
      const slots = Array.from({ length: count }, (_, i) =>
        makeSlot({ photoId: `p${i + 1}`, number: i + 1, caption: `c${i}` }),
      );
      const tree = expandTree(
        <PhotoPage
          slots={slots}
          sectionTitle="Living Room"
          customerName="Jane Doe"
          reportDate="2026-05-19"
          photosPerPage={4}
        />,
      );

      const images = findAll(tree, (n) => n.type === "IMAGE");
      expect(images.length).toBe(count);

      // Grid wrapper still present even when partially filled.
      const gridWrappers = findAll(tree, (n) => {
        if (n.type !== "VIEW") return false;
        const s = flattenStyle(n.props.style);
        return s.flexDirection === "row" && s.flexWrap === "wrap";
      });
      expect(gridWrappers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders the page header and footer at photosPerPage=4", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({ photoId: "p1", number: 1 }),
          makeSlot({ photoId: "p2", number: 2 }),
        ]}
        sectionTitle="Kitchen"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={4}
        totalPages={7}
        photosPerPage={4}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Photo Report");
    expect(text).toContain("May 19, 2026");
    expect(text).toContain("Kitchen");
    expect(text).toContain("4 / 7");
  });

  it("uses objectFit 'contain' (letterbox) for landscape photos at photosPerPage=4", () => {
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
        photosPerPage={4}
      />,
    );

    const images = findAll(tree, (n) => n.type === "IMAGE");
    const styleByUrl = new Map(
      images.map((img) => [
        img.props.src as string | undefined,
        flattenStyle(img.props.style),
      ]),
    );
    expect(styleByUrl.get("https://x/wide.jpg")?.objectFit).toBe("contain");
    expect(styleByUrl.get("https://x/tall.jpg")?.objectFit).toBe("cover");
  });
});

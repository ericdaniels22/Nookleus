import { describe, expect, it } from "vitest";

import PhotoPage, { PHOTO_CORNER_RADIUS } from "./photo-page";
import type { RenderSlot } from "@/lib/report-render-model";
import {
  collectText,
  expandTree,
  findAll,
  flattenStyle,
  photoFrames,
} from "./test-helpers";

function makeSlot(overrides: Partial<RenderSlot> = {}): RenderSlot {
  return {
    photoId: "p1",
    url: "https://example.com/p1.jpg",
    number: 1,
    caption: null,
    dateCaptured: "2026-05-19T11:03:00",
    capturedBy: "Eric Daniels",
    location: "123 Main St",
    tags: [],
    orientation: "portrait",
    ...overrides,
  };
}

function slots(n: number, overrides: (i: number) => Partial<RenderSlot> = () => ({})) {
  return Array.from({ length: n }, (_, i) =>
    makeSlot({ photoId: `p${i + 1}`, number: i + 1, ...overrides(i) }),
  );
}

describe("PhotoPage (photo corner radius)", () => {
  it("is more pronounced than the previous radius of 4", () => {
    expect(PHOTO_CORNER_RADIUS).toBeGreaterThan(4);
  });

  it.each([2, 3, 4] as const)(
    "applies the shared radius to every photo frame at photosPerPage=%i",
    (photosPerPage) => {
      const tree = expandTree(
        <PhotoPage
          slots={slots(photosPerPage)}
          sectionTitle="Living Room"
          photosPerPage={photosPerPage}
        />,
      );

      const frames = photoFrames(tree);
      expect(frames.length).toBe(photosPerPage);
      for (const frame of frames) {
        expect(flattenStyle(frame.props.style).borderRadius).toBe(
          PHOTO_CORNER_RADIUS,
        );
      }
    },
  );
});

describe("PhotoPage (chrome)", () => {
  it("drops the running top header — no 'Photo Report' banner", () => {
    const tree = expandTree(
      <PhotoPage slots={slots(2)} sectionTitle="Living Room" />,
    );
    expect(collectText(tree)).not.toContain("Photo Report");
  });

  it("keeps a slim footer with the section name and 'Page X of Y'", () => {
    const tree = expandTree(
      <PhotoPage
        slots={slots(2)}
        sectionTitle="Living Room"
        pageNumber={2}
        totalPages={5}
      />,
    );
    const text = collectText(tree);
    expect(text).toContain("Living Room");
    expect(text).toContain("Page 2 of 5");
  });
});

describe("PhotoPage (per-photo detail fields)", () => {
  it("renders the bold caption when present and omits it when null", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({ photoId: "p1", number: 1, caption: "Buckled subfloor" }),
          makeSlot({ photoId: "p2", number: 2, caption: null }),
        ]}
        sectionTitle="Living Room"
      />,
    );

    const captionTexts = findAll(
      tree,
      (n) =>
        n.type === "TEXT" &&
        typeof n.props.children === "string" &&
        (n.props.children as string).includes("Buckled subfloor"),
    );
    expect(captionTexts.length).toBe(1);
    expect(flattenStyle(captionTexts[0].props.style).fontFamily).toBe(
      "Helvetica-Bold",
    );
  });

  it("renders the formatted date captured, the captured-by, and the location", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({
            photoId: "p1",
            number: 1,
            dateCaptured: "2026-05-19T11:03:00",
            capturedBy: "Eric Daniels",
            location: "123 Main St",
          }),
        ]}
        sectionTitle="Living Room"
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("May 19, 2026, 11:03 AM");
    expect(text).toContain("Eric Daniels");
    expect(text).toContain("123 Main St");
  });

  it("omits each detail field whose value is null (toggled off upstream)", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({
            photoId: "p1",
            number: 1,
            caption: "Only caption",
            dateCaptured: null,
            capturedBy: null,
            location: null,
            tags: [],
          }),
        ]}
        sectionTitle="Living Room"
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Only caption");
    expect(text).not.toContain("Eric Daniels");
    expect(text).not.toContain("123 Main St");
    expect(text).not.toContain("May 19");
  });

  it("renders a numbered badge only when the slot has a number", () => {
    const withNumber = expandTree(
      <PhotoPage
        slots={[makeSlot({ photoId: "p1", number: 5 })]}
        sectionTitle="Living Room"
      />,
    );
    const badges = (tree: ReturnType<typeof expandTree>) =>
      findAll(
        tree,
        (n) =>
          n.type === "TEXT" &&
          flattenStyle(n.props.style).position === "absolute",
      );
    expect(badges(withNumber)).toHaveLength(1);
    expect(collectText(badges(withNumber)[0])).toBe("5");

    const noNumber = expandTree(
      <PhotoPage
        slots={[makeSlot({ photoId: "p1", number: null })]}
        sectionTitle="Living Room"
      />,
    );
    expect(badges(noNumber)).toHaveLength(0);
  });

  it("renders each tag as a colored chip", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({
            photoId: "p1",
            number: 1,
            tags: [
              { name: "Damage", color: "#ff0000" },
              { name: "Repaired", color: "#00aa00" },
            ],
          }),
        ]}
        sectionTitle="Living Room"
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Damage");
    expect(text).toContain("Repaired");

    const backgrounds = findAll(tree, (n) => n.type === "VIEW")
      .map((n) => flattenStyle(n.props.style).backgroundColor)
      .filter(Boolean);
    expect(backgrounds).toContain("#ff0000");
    expect(backgrounds).toContain("#00aa00");
  });
});

describe("PhotoPage (image fit)", () => {
  it("uses objectFit 'contain' for landscape and 'cover' for portrait", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[
          makeSlot({ photoId: "wide", number: 1, orientation: "landscape", url: "https://x/wide.jpg" }),
          makeSlot({ photoId: "tall", number: 2, orientation: "portrait", url: "https://x/tall.jpg" }),
        ]}
        sectionTitle="Living Room"
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

  it("renders an empty frame (no image) when a slot's url is null", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[makeSlot({ photoId: "p1", number: 1, url: null, caption: "missing img" })]}
        sectionTitle="Living Room"
      />,
    );
    expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(0);
    expect(collectText(tree)).toContain("missing img");
  });
});

describe("PhotoPage (2-per-page)", () => {
  it("places the metadata column beside the photo (row layout)", () => {
    const tree = expandTree(
      <PhotoPage
        slots={[makeSlot({ photoId: "p1", number: 1, caption: "Side meta" })]}
        sectionTitle="Living Room"
        photosPerPage={2}
      />,
    );

    const rowSlots = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      if (flattenStyle(n.props.style).flexDirection !== "row") return false;
      return findAll(n, (m) => m.type === "IMAGE").length === 1;
    });
    expect(rowSlots.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PhotoPage (3-per-page)", () => {
  it("renders three photos, each with a side metadata column", () => {
    const tree = expandTree(
      <PhotoPage
        slots={slots(3, (i) => ({ caption: `c${i}` }))}
        sectionTitle="Living Room"
        photosPerPage={3}
      />,
    );

    expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(3);
    const text = collectText(tree);
    for (const c of ["c0", "c1", "c2"]) expect(text).toContain(c);

    const rowSlots = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      if (flattenStyle(n.props.style).flexDirection !== "row") return false;
      return findAll(n, (m) => m.type === "IMAGE").length === 1;
    });
    expect(rowSlots.length).toBe(3);
  });

  it("handles a partial final page of 1 or 2 photos", () => {
    for (const count of [1, 2]) {
      const tree = expandTree(
        <PhotoPage
          slots={slots(count)}
          sectionTitle="Living Room"
          photosPerPage={3}
        />,
      );
      expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(count);
    }
  });
});

describe("PhotoPage (4-per-page)", () => {
  it("arranges four tiles in a 2x2 grid with metadata beneath each tile", () => {
    const tree = expandTree(
      <PhotoPage
        slots={slots(4, (i) => ({ caption: `c${i}` }))}
        sectionTitle="Living Room"
        photosPerPage={4}
      />,
    );

    expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(4);

    const grids = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      const s = flattenStyle(n.props.style);
      if (s.flexDirection !== "row" || s.flexWrap !== "wrap") return false;
      return findAll(n, (m) => m.type === "IMAGE").length === 4;
    });
    expect(grids.length).toBe(1);

    // Each tile stacks meta beneath (not a row layout around the image).
    const rowSlots = findAll(tree, (n) => {
      if (n.type !== "VIEW") return false;
      if (flattenStyle(n.props.style).flexDirection !== "row") return false;
      return findAll(n, (m) => m.type === "IMAGE").length === 1;
    });
    expect(rowSlots.length).toBe(0);
  });

  it("handles a partial final page of 1, 2, or 3 tiles without breaking the grid", () => {
    for (const count of [1, 2, 3]) {
      const tree = expandTree(
        <PhotoPage
          slots={slots(count)}
          sectionTitle="Living Room"
          photosPerPage={4}
        />,
      );
      expect(findAll(tree, (n) => n.type === "IMAGE")).toHaveLength(count);
      const grids = findAll(tree, (n) => {
        if (n.type !== "VIEW") return false;
        const s = flattenStyle(n.props.style);
        return s.flexDirection === "row" && s.flexWrap === "wrap";
      });
      expect(grids.length).toBeGreaterThanOrEqual(1);
    }
  });
});

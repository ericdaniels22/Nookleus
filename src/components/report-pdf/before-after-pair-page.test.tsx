import { describe, expect, it } from "vitest";

import BeforeAfterPairPage from "./before-after-pair-page";
import { PHOTO_CORNER_RADIUS, type PhotoPageSlot } from "./photo-page";
import {
  collectText,
  expandTree,
  findAll,
  flattenStyle,
  photoFrames,
} from "./test-helpers";

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

describe("BeforeAfterPairPage", () => {
  it("renders the 'Before' and 'After' labels", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "before", number: 7 })}
        after={makeSlot({ photoId: "after", number: 8 })}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={3}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Before");
    expect(text).toContain("After");
  });

  it("renders both photo images at their respective URLs", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "p1", url: "https://x/before.jpg", number: 7 })}
        after={makeSlot({ photoId: "p2", url: "https://x/after.jpg", number: 8 })}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
      />,
    );

    const images = findAll(tree, (n) => n.type === "IMAGE");
    const urls = images.map((i) => i.props.src as string);
    expect(urls).toContain("https://x/before.jpg");
    expect(urls).toContain("https://x/after.jpg");
  });

  it("renders each slot's continuous photo number as a badge", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "p1", number: 7 })}
        after={makeSlot({ photoId: "p2", number: 8 })}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("7");
    expect(text).toContain("8");
  });

  it("renders the page header and footer with section, customer, and counter", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "p1", number: 1 })}
        after={makeSlot({ photoId: "p2", number: 2 })}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
        pageNumber={3}
        totalPages={9}
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Photo Report");
    expect(text).toContain("May 19, 2026");
    expect(text).toContain("Living Room");
    expect(text).toContain("3 / 9");
  });

  it("renders captions and metadata for each photo when present", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({
          photoId: "p1",
          number: 1,
          caption: "Wet subfloor",
          takenAt: "2026-05-19T11:03:00",
          takenBy: "Eric Daniels",
        })}
        after={makeSlot({
          photoId: "p2",
          number: 2,
          caption: "Fully dried",
          takenAt: "2026-05-21T10:00:00",
          takenBy: "Eric Daniels",
        })}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
      />,
    );

    const text = collectText(tree);
    expect(text).toContain("Wet subfloor");
    expect(text).toContain("Fully dried");
    expect(text).toContain("May 19, 2026, 11:03 AM");
    expect(text).toContain("May 21, 2026, 10:00 AM");
  });

  it("applies the shared corner radius to both the before and after photo frames", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "before", number: 7 })}
        after={makeSlot({ photoId: "after", number: 8 })}
        sectionTitle="Living Room"
        customerName="Jane Doe"
        reportDate="2026-05-19"
      />,
    );

    // One clipping frame per photo — before and after — each rounded with the
    // single shared constant, so the pair page can never drift from the radius
    // the rest of the report uses.
    const frames = photoFrames(tree);
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(flattenStyle(frame.props.style).borderRadius).toBe(
        PHOTO_CORNER_RADIUS,
      );
    }
  });
});

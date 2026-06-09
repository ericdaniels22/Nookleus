import { describe, expect, it } from "vitest";

import BeforeAfterPairPage from "./before-after-pair-page";
import { PHOTO_CORNER_RADIUS } from "./photo-page";
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

describe("BeforeAfterPairPage", () => {
  it("renders the 'Before' and 'After' labels", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "before", number: 7 })}
        after={makeSlot({ photoId: "after", number: 8 })}
        sectionTitle="Living Room"
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
      />,
    );
    const urls = findAll(tree, (n) => n.type === "IMAGE").map(
      (i) => i.props.src as string,
    );
    expect(urls).toContain("https://x/before.jpg");
    expect(urls).toContain("https://x/after.jpg");
  });

  it("renders each slot's continuous photo number as a badge, but only when numbered", () => {
    const numbered = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "p1", number: 7 })}
        after={makeSlot({ photoId: "p2", number: 8 })}
        sectionTitle="Living Room"
      />,
    );
    const text = collectText(numbered);
    expect(text).toContain("7");
    expect(text).toContain("8");

    const unnumbered = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "p1", number: null })}
        after={makeSlot({ photoId: "p2", number: null })}
        sectionTitle="Living Room"
      />,
    );
    const badges = findAll(
      unnumbered,
      (n) => n.type === "TEXT" && flattenStyle(n.props.style).position === "absolute",
    );
    expect(badges).toHaveLength(0);
  });

  it("drops the top header and keeps a slim section + 'Page X of Y' footer", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "p1", number: 1 })}
        after={makeSlot({ photoId: "p2", number: 2 })}
        sectionTitle="Living Room"
        pageNumber={3}
        totalPages={9}
      />,
    );
    const text = collectText(tree);
    expect(text).not.toContain("Photo Report");
    expect(text).toContain("Living Room");
    expect(text).toContain("Page 3 of 9");
  });

  it("renders captions, dates, captured-by, and location for each photo when present", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({
          photoId: "p1",
          number: 1,
          caption: "Wet subfloor",
          dateCaptured: "2026-05-19T11:03:00",
          capturedBy: "Eric Daniels",
          location: "123 Main St",
        })}
        after={makeSlot({
          photoId: "p2",
          number: 2,
          caption: "Fully dried",
          dateCaptured: "2026-05-21T10:00:00",
          capturedBy: "Eric Daniels",
        })}
        sectionTitle="Living Room"
      />,
    );
    const text = collectText(tree);
    expect(text).toContain("Wet subfloor");
    expect(text).toContain("Fully dried");
    expect(text).toContain("May 19, 2026, 11:03 AM");
    expect(text).toContain("May 21, 2026, 10:00 AM");
    expect(text).toContain("123 Main St");
  });

  it("renders tag chips for each photo's tags", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({
          photoId: "p1",
          number: 1,
          tags: [{ name: "Damage", color: "#ff0000" }],
        })}
        after={makeSlot({
          photoId: "p2",
          number: 2,
          tags: [{ name: "Repaired", color: "#00aa00" }],
        })}
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

  it("applies the shared corner radius to both the before and after photo frames", () => {
    const tree = expandTree(
      <BeforeAfterPairPage
        before={makeSlot({ photoId: "before", number: 7 })}
        after={makeSlot({ photoId: "after", number: 8 })}
        sectionTitle="Living Room"
      />,
    );
    const frames = photoFrames(tree);
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(flattenStyle(frame.props.style).borderRadius).toBe(
        PHOTO_CORNER_RADIUS,
      );
    }
  });
});

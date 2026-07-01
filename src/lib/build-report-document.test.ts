import { describe, expect, it } from "vitest";

import {
  buildReportDocument,
  type DocumentPage,
  type ReportPhotoInput,
  type ReportSectionInput,
} from "./build-report-document";
import type { PlanRender } from "./sketch/plan-render";

function makePlan(overrides: Partial<PlanRender> = {}): PlanRender {
  return {
    floorName: "Ground Floor",
    viewBox: { width: 14, height: 12 },
    rooms: [
      {
        polygon: [
          { x: 1, y: 1 },
          { x: 13, y: 1 },
          { x: 13, y: 11 },
          { x: 1, y: 11 },
        ],
        name: "Bedroom",
        areaLabel: "120 sq ft",
        labelAt: { x: 7, y: 6 },
        wallLabels: [{ x: 7, y: 1, text: "12'" }],
      },
    ],
    ...overrides,
  };
}

function makePhoto(overrides: Partial<ReportPhotoInput> = {}): ReportPhotoInput {
  return {
    id: "p-1",
    caption: null,
    takenAt: null,
    takenBy: null,
    width: 100,
    height: 200,
    beforeAfterPairId: null,
    beforeAfterRole: null,
    ...overrides,
  };
}

function makeSection(
  overrides: Partial<ReportSectionInput> = {},
): ReportSectionInput {
  return {
    title: "Section",
    description: null,
    photoIds: [],
    ...overrides,
  };
}

describe("buildReportDocument", () => {
  it("emits a single cover page when there are no sections", () => {
    const pages = buildReportDocument({
      sections: [],
      photos: {},
      photosPerPage: 2,
    });

    expect(pages).toEqual([{ kind: "cover" }]);
  });

  it("inserts a sectionDivider page before the first photoPage of a non-empty section, carrying its title and description", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({
          title: "Living Room",
          description: "Buckled flooring after water loss.",
          photoIds: ["a"],
        }),
      ],
      photos: { a: makePhoto({ id: "a" }) },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
    ]);

    const divider = pages[1];
    if (divider.kind !== "sectionDivider") throw new Error("expected sectionDivider");
    expect(divider.title).toBe("Living Room");
    expect(divider.description).toBe("Buckled flooring after water loss.");
  });

  it("buckets 3 photos in one section into two photoPages (2 + 1) with continuous numbering", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Living Room", photoIds: ["a", "b", "c"] }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
      },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
      "photoPage",
    ]);

    const firstPhotoPage = pages[2];
    if (firstPhotoPage.kind !== "photoPage") throw new Error("expected photoPage");
    expect(firstPhotoPage.sectionTitle).toBe("Living Room");
    expect(firstPhotoPage.slots.map((s) => s.photoId)).toEqual(["a", "b"]);
    expect(firstPhotoPage.slots.map((s) => s.number)).toEqual([1, 2]);

    const secondPhotoPage = pages[3];
    if (secondPhotoPage.kind !== "photoPage") throw new Error("expected photoPage");
    expect(secondPhotoPage.sectionTitle).toBe("Living Room");
    expect(secondPhotoPage.slots.map((s) => s.photoId)).toEqual(["c"]);
    expect(secondPhotoPage.slots.map((s) => s.number)).toEqual([3]);
  });

  it("continues photo numbering across sections and tags each page with its section title", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Exterior", photoIds: ["a", "b"] }),
        makeSection({ title: "Interior", photoIds: ["c", "d", "e"] }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
        d: makePhoto({ id: "d" }),
        e: makePhoto({ id: "e" }),
      },
      photosPerPage: 2,
    });

    const photoPages = pages.filter((p) => p.kind === "photoPage") as Extract<
      DocumentPage,
      { kind: "photoPage" }
    >[];

    expect(photoPages.map((p) => p.sectionTitle)).toEqual([
      "Exterior",
      "Interior",
      "Interior",
    ]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.number))).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.photoId))).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);

    // Each section's divider precedes its first photoPage in document order.
    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
      "sectionDivider",
      "photoPage",
      "photoPage",
    ]);
  });

  it("emits a sectionDivider for an empty section but no photoPages, and continues numbering across the gap", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Exterior", photoIds: ["a"] }),
        makeSection({ title: "Empty", description: "nothing here", photoIds: [] }),
        makeSection({ title: "Interior", photoIds: ["b"] }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
      },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
      "sectionDivider",
      "sectionDivider",
      "photoPage",
    ]);

    const dividers = pages.filter((p) => p.kind === "sectionDivider") as Extract<
      DocumentPage,
      { kind: "sectionDivider" }
    >[];
    expect(dividers.map((d) => d.title)).toEqual([
      "Exterior",
      "Empty",
      "Interior",
    ]);

    const photoPages = pages.filter((p) => p.kind === "photoPage") as Extract<
      DocumentPage,
      { kind: "photoPage" }
    >[];
    expect(photoPages.map((p) => p.sectionTitle)).toEqual([
      "Exterior",
      "Interior",
    ]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.number))).toEqual([
      1, 2,
    ]);
  });

  it("derives portrait orientation when height >= width, landscape when width > height", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "S", photoIds: ["tall", "wide", "square", "unknown"] }),
      ],
      photos: {
        tall: makePhoto({ id: "tall", width: 100, height: 200 }),
        wide: makePhoto({ id: "wide", width: 300, height: 200 }),
        square: makePhoto({ id: "square", width: 200, height: 200 }),
        unknown: makePhoto({ id: "unknown", width: null, height: null }),
      },
      photosPerPage: 2,
    });

    const slots = pages
      .filter((p) => p.kind === "photoPage")
      .flatMap(
        (p) => (p as Extract<DocumentPage, { kind: "photoPage" }>).slots,
      );

    const orientationsById = Object.fromEntries(
      slots.map((s) => [s.photoId, s.orientation]),
    );

    expect(orientationsById).toEqual({
      tall: "portrait",
      wide: "landscape",
      square: "portrait",
      unknown: "portrait",
    });
  });

  it("passes caption, takenAt, and takenBy through to each slot verbatim", () => {
    const pages = buildReportDocument({
      sections: [makeSection({ title: "S", photoIds: ["a"] })],
      photos: {
        a: makePhoto({
          id: "a",
          caption: "Buckled subfloor",
          takenAt: "2026-05-20T14:32:00Z",
          takenBy: "Eric Daniels",
        }),
      },
      photosPerPage: 2,
    });

    const photoPage = pages[2];
    if (photoPage.kind !== "photoPage") throw new Error("expected photoPage");

    expect(photoPage.slots[0]).toMatchObject({
      photoId: "a",
      number: 1,
      caption: "Buckled subfloor",
      takenAt: "2026-05-20T14:32:00Z",
      takenBy: "Eric Daniels",
    });
  });

  it("emits a beforeAfterPair page when two photos in a section share a before_after_pair_id", () => {
    const pages = buildReportDocument({
      sections: [makeSection({ title: "Living Room", photoIds: ["a", "b"] })],
      photos: {
        a: makePhoto({
          id: "a",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "before",
          caption: "Before drying",
        }),
        b: makePhoto({
          id: "b",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "after",
          caption: "After drying",
        }),
      },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "beforeAfterPair",
    ]);

    const pair = pages[2];
    if (pair.kind !== "beforeAfterPair") throw new Error("expected beforeAfterPair");
    expect(pair.sectionTitle).toBe("Living Room");
    expect(pair.before.photoId).toBe("a");
    expect(pair.after.photoId).toBe("b");
    expect(pair.before.number).toBe(1);
    expect(pair.after.number).toBe(2);
    expect(pair.before.caption).toBe("Before drying");
    expect(pair.after.caption).toBe("After drying");
  });

  it("skips the partner in subsequent traversal so a pair is never double-rendered", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Living Room", photoIds: ["a", "b", "c"] }),
      ],
      photos: {
        a: makePhoto({
          id: "a",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "before",
        }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({
          id: "c",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "after",
        }),
      },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "beforeAfterPair",
      "photoPage",
    ]);

    const pair = pages[2];
    if (pair.kind !== "beforeAfterPair") throw new Error("expected beforeAfterPair");
    expect(pair.before.photoId).toBe("a");
    expect(pair.after.photoId).toBe("c");
    expect(pair.before.number).toBe(1);
    expect(pair.after.number).toBe(2);

    const single = pages[3];
    if (single.kind !== "photoPage") throw new Error("expected photoPage");
    expect(single.slots.map((s) => s.photoId)).toEqual(["b"]);
    expect(single.slots.map((s) => s.number)).toEqual([3]);
  });

  it("falls back to regular photoPage rendering when a paired photo's partner is missing from the section", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Living Room", photoIds: ["a", "b"] }),
      ],
      photos: {
        // "a" claims a pair id, but its partner is not in the photo set.
        a: makePhoto({
          id: "a",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "before",
        }),
        b: makePhoto({ id: "b" }),
      },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
    ]);

    const photoPage = pages[2];
    if (photoPage.kind !== "photoPage") throw new Error("expected photoPage");
    expect(photoPage.slots.map((s) => s.photoId)).toEqual(["a", "b"]);
    expect(photoPage.slots.map((s) => s.number)).toEqual([1, 2]);
  });

  it("when more than two photos share a before_after_pair_id, pairs the first two and renders extras as regular photos", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Living Room", photoIds: ["a", "b", "c"] }),
      ],
      photos: {
        a: makePhoto({
          id: "a",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "before",
        }),
        b: makePhoto({
          id: "b",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "after",
        }),
        c: makePhoto({
          id: "c",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "after",
        }),
      },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "beforeAfterPair",
      "photoPage",
    ]);

    const pair = pages[2];
    if (pair.kind !== "beforeAfterPair") throw new Error("expected beforeAfterPair");
    expect(pair.before.photoId).toBe("a");
    expect(pair.after.photoId).toBe("b");
    expect(pair.before.number).toBe(1);
    expect(pair.after.number).toBe(2);

    const single = pages[3];
    if (single.kind !== "photoPage") throw new Error("expected photoPage");
    expect(single.slots.map((s) => s.photoId)).toEqual(["c"]);
    expect(single.slots.map((s) => s.number)).toEqual([3]);
  });

  it("emits each pair on its own page regardless of photosPerPage (2, 3, or 4)", () => {
    for (const ppp of [2, 3, 4]) {
      const pages = buildReportDocument({
        sections: [
          makeSection({ title: "Living Room", photoIds: ["a", "b"] }),
        ],
        photos: {
          a: makePhoto({
            id: "a",
            beforeAfterPairId: "pair-1",
            beforeAfterRole: "before",
          }),
          b: makePhoto({
            id: "b",
            beforeAfterPairId: "pair-1",
            beforeAfterRole: "after",
          }),
        },
        photosPerPage: ppp,
      });

      expect(pages.map((p) => p.kind)).toEqual([
        "cover",
        "sectionDivider",
        "beforeAfterPair",
      ]);
    }
  });

  it("emits a separate beforeAfterPair page for each pair in the same section, with continuous numbering", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({
          title: "Living Room",
          photoIds: ["a", "b", "c", "d"],
        }),
      ],
      photos: {
        a: makePhoto({
          id: "a",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "before",
        }),
        b: makePhoto({
          id: "b",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "after",
        }),
        c: makePhoto({
          id: "c",
          beforeAfterPairId: "pair-2",
          beforeAfterRole: "before",
        }),
        d: makePhoto({
          id: "d",
          beforeAfterPairId: "pair-2",
          beforeAfterRole: "after",
        }),
      },
      photosPerPage: 2,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "beforeAfterPair",
      "beforeAfterPair",
    ]);

    const first = pages[2];
    if (first.kind !== "beforeAfterPair") throw new Error("expected beforeAfterPair");
    expect(first.before.photoId).toBe("a");
    expect(first.after.photoId).toBe("b");
    expect(first.before.number).toBe(1);
    expect(first.after.number).toBe(2);

    const second = pages[3];
    if (second.kind !== "beforeAfterPair") throw new Error("expected beforeAfterPair");
    expect(second.before.photoId).toBe("c");
    expect(second.after.photoId).toBe("d");
    expect(second.before.number).toBe(3);
    expect(second.after.number).toBe(4);
  });

  it("assigns the 'before' slot to the photo whose role is 'before' even when 'after' appears first in the section list", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Living Room", photoIds: ["after-first", "before-second"] }),
      ],
      photos: {
        "after-first": makePhoto({
          id: "after-first",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "after",
        }),
        "before-second": makePhoto({
          id: "before-second",
          beforeAfterPairId: "pair-1",
          beforeAfterRole: "before",
        }),
      },
      photosPerPage: 2,
    });

    const pair = pages[2];
    if (pair.kind !== "beforeAfterPair") throw new Error("expected beforeAfterPair");
    expect(pair.before.photoId).toBe("before-second");
    expect(pair.after.photoId).toBe("after-first");
    // Numbering is in traversal order: after-first encountered first → 1,
    // partner before-second → 2. The slot/role assignment is independent
    // of the numbering.
    expect(pair.after.number).toBe(1);
    expect(pair.before.number).toBe(2);
  });

  it("treats the retired photosPerPage=1 value as the 2-per-page default", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({ title: "Living Room", photoIds: ["a", "b", "c"] }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
      },
      photosPerPage: 1,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
      "photoPage",
    ]);

    const photoPages = pages.filter((p) => p.kind === "photoPage") as Extract<
      DocumentPage,
      { kind: "photoPage" }
    >[];
    // 1 is no longer a layout; it buckets at 2 and the pages are tagged 2.
    expect(photoPages.map((p) => p.slots.length)).toEqual([2, 1]);
    expect(photoPages.map((p) => p.photosPerPage)).toEqual([2, 2]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.photoId))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.number))).toEqual([
      1, 2, 3,
    ]);
  });

  it("at photosPerPage=3 buckets three photos into one photoPage, spilling the fourth onto its own page", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({
          title: "Living Room",
          photoIds: ["a", "b", "c", "d"],
        }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
        d: makePhoto({ id: "d" }),
      },
      photosPerPage: 3,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
      "photoPage",
    ]);

    const photoPages = pages.filter((p) => p.kind === "photoPage") as Extract<
      DocumentPage,
      { kind: "photoPage" }
    >[];
    expect(photoPages.map((p) => p.slots.length)).toEqual([3, 1]);
    expect(photoPages.map((p) => p.photosPerPage)).toEqual([3, 3]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.photoId))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.number))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("at photosPerPage=4 buckets four photos into one photoPage with four slots", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({
          title: "Living Room",
          photoIds: ["a", "b", "c", "d"],
        }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
        d: makePhoto({ id: "d" }),
      },
      photosPerPage: 4,
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
    ]);

    const photoPage = pages[2];
    if (photoPage.kind !== "photoPage") throw new Error("expected photoPage");
    expect(photoPage.slots.map((s) => s.photoId)).toEqual(["a", "b", "c", "d"]);
    expect(photoPage.slots.map((s) => s.number)).toEqual([1, 2, 3, 4]);
  });

  it("tags each photoPage with the photosPerPage value the engine bucketed at", () => {
    for (const ppp of [2, 3, 4] as const) {
      const pages = buildReportDocument({
        sections: [makeSection({ title: "S", photoIds: ["a"] })],
        photos: { a: makePhoto({ id: "a" }) },
        photosPerPage: ppp,
      });
      const photoPage = pages.find((p) => p.kind === "photoPage") as Extract<
        DocumentPage,
        { kind: "photoPage" }
      >;
      expect(photoPage.photosPerPage).toBe(ppp);
    }
  });

  it("at photosPerPage=4 with a partial final page, the trailing photos render on their own page with fewer slots", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({
          title: "Living Room",
          photoIds: ["a", "b", "c", "d", "e", "f"],
        }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
        d: makePhoto({ id: "d" }),
        e: makePhoto({ id: "e" }),
        f: makePhoto({ id: "f" }),
      },
      photosPerPage: 4,
    });

    const photoPages = pages.filter((p) => p.kind === "photoPage") as Extract<
      DocumentPage,
      { kind: "photoPage" }
    >[];

    expect(photoPages.map((p) => p.slots.length)).toEqual([4, 2]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.photoId))).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.number))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("plans cover → per-Section intro → photo pages, forwarding each Section's rich-text write-up to its intro page", () => {
    // Issue #403: the section divider is the Section's intro page (heading +
    // write-up). The planner keeps its interface — it forwards the write-up
    // HTML verbatim on the divider and the renderer maps it to PDF primitives.
    const pages = buildReportDocument({
      sections: [
        makeSection({
          title: "Findings",
          description: "<p>What we found.</p><ul><li>Buckled flooring</li></ul>",
          photoIds: ["a", "b"],
        }),
        makeSection({
          title: "Work performed",
          description: "<p>What we did.</p>",
          photoIds: ["c"],
        }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
      },
      photosPerPage: 2,
    });

    // Each Section's intro page sits immediately before that Section's photos.
    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
      "sectionDivider",
      "photoPage",
    ]);

    const intros = pages.filter((p) => p.kind === "sectionDivider") as Extract<
      DocumentPage,
      { kind: "sectionDivider" }
    >[];
    expect(intros.map((d) => d.title)).toEqual(["Findings", "Work performed"]);
    // Write-up HTML is passed through untouched (the renderer, not the planner,
    // turns it into paragraphs / bullet rows).
    expect(intros[0].description).toBe(
      "<p>What we found.</p><ul><li>Buckled flooring</li></ul>",
    );
    expect(intros[1].description).toBe("<p>What we did.</p>");
  });

  it("omits the Section Title Page when sectionTitlePages is false, naming each Section only via its photoPage and leaving numbering unchanged", () => {
    const pages = buildReportDocument({
      sections: [
        makeSection({
          title: "Exterior",
          description: "<p>write-up</p>",
          photoIds: ["a", "b", "c"],
        }),
        makeSection({
          title: "Interior",
          description: "<p>more</p>",
          photoIds: ["d"],
        }),
      ],
      photos: {
        a: makePhoto({ id: "a" }),
        b: makePhoto({ id: "b" }),
        c: makePhoto({ id: "c" }),
        d: makePhoto({ id: "d" }),
      },
      photosPerPage: 2,
      sectionTitlePages: false,
    });

    // No sectionDivider pages: the cover leads straight into photo pages.
    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "photoPage",
      "photoPage",
      "photoPage",
    ]);

    const photoPages = pages.filter((p) => p.kind === "photoPage") as Extract<
      DocumentPage,
      { kind: "photoPage" }
    >[];
    // The Section name still rides on every photo page so the footer can name it.
    expect(photoPages.map((p) => p.sectionTitle)).toEqual([
      "Exterior",
      "Exterior",
      "Interior",
    ]);
    // Dropping the title pages does not disturb continuous photo numbering.
    expect(photoPages.flatMap((p) => p.slots.map((s) => s.number))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("inserts one sketchPlan page per Floor plan directly after the cover, before the first Section", () => {
    // Issue #868: when the report includes the Job's Sketch, each Floor's
    // dimensioned plan is its own page, laid out right after the cover so the
    // reader sees the space before the photo tour of it.
    const pages = buildReportDocument({
      sections: [makeSection({ title: "Living Room", photoIds: ["a"] })],
      photos: { a: makePhoto({ id: "a" }) },
      photosPerPage: 2,
      sketchPlans: [
        makePlan({ floorName: "Ground Floor" }),
        makePlan({ floorName: "Second Floor" }),
      ],
    });

    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sketchPlan",
      "sketchPlan",
      "sectionDivider",
      "photoPage",
    ]);

    const plans = pages.filter((p) => p.kind === "sketchPlan") as Extract<
      DocumentPage,
      { kind: "sketchPlan" }
    >[];
    expect(plans.map((p) => p.plan.floorName)).toEqual([
      "Ground Floor",
      "Second Floor",
    ]);
    // The plan model is forwarded verbatim for the renderer to draw.
    expect(plans[0].plan.rooms[0].areaLabel).toBe("120 sq ft");
  });

  it("emits no sketchPlan page when no Sketch plans are supplied", () => {
    const pages = buildReportDocument({
      sections: [makeSection({ title: "S", photoIds: ["a"] })],
      photos: { a: makePhoto({ id: "a" }) },
      photosPerPage: 2,
      sketchPlans: [],
    });

    expect(pages.some((p) => p.kind === "sketchPlan")).toBe(false);
    expect(pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
    ]);
  });

  it("keeps the Section Title Page when sectionTitlePages is true (and by default)", () => {
    const withFlag = buildReportDocument({
      sections: [makeSection({ title: "S", photoIds: ["a"] })],
      photos: { a: makePhoto({ id: "a" }) },
      photosPerPage: 2,
      sectionTitlePages: true,
    });
    const byDefault = buildReportDocument({
      sections: [makeSection({ title: "S", photoIds: ["a"] })],
      photos: { a: makePhoto({ id: "a" }) },
      photosPerPage: 2,
    });

    const expected = ["cover", "sectionDivider", "photoPage"];
    expect(withFlag.map((p) => p.kind)).toEqual(expected);
    expect(byDefault.map((p) => p.kind)).toEqual(expected);
  });
});

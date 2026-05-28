import { describe, expect, it } from "vitest";

import {
  buildReportDocument,
  type DocumentPage,
  type ReportPhotoInput,
  type ReportSectionInput,
} from "./build-report-document";

function makePhoto(overrides: Partial<ReportPhotoInput> = {}): ReportPhotoInput {
  return {
    id: "p-1",
    caption: null,
    takenAt: null,
    takenBy: null,
    width: 100,
    height: 200,
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

  it("treats unsupported photosPerPage values (1, 4) as 2 for this slice", () => {
    const photoIds = ["a", "b", "c"];
    const photos: Record<string, ReportPhotoInput> = {
      a: makePhoto({ id: "a" }),
      b: makePhoto({ id: "b" }),
      c: makePhoto({ id: "c" }),
    };

    for (const ppp of [1, 4]) {
      const pages = buildReportDocument({
        sections: [makeSection({ title: "S", photoIds })],
        photos,
        photosPerPage: ppp,
      });

      const photoPages = pages.filter((p) => p.kind === "photoPage") as Extract<
        DocumentPage,
        { kind: "photoPage" }
      >[];

      expect(photoPages.map((p) => p.slots.length)).toEqual([2, 1]);
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  buildReportDocument,
  type LayoutEnginePhoto,
  type LayoutEngineSection,
} from "./build-report-document";
import type { CompanySettings } from "./types";
import type { CoverPageJob } from "./cover-page-data";

function makePhoto(overrides: Partial<LayoutEnginePhoto> = {}): LayoutEnginePhoto {
  return {
    id: "p-default",
    caption: null,
    takenAt: null,
    takenBy: null,
    width: 3000,
    height: 4000,
    ...overrides,
  };
}

const baseJob: CoverPageJob = {
  property_address: "123 Main St",
  insurance_company: null,
  claim_number: null,
  contact: null,
};

const baseSettings: CompanySettings = {
  company_name: "AAA Disaster Recovery",
};

function photosByIds(...photos: LayoutEnginePhoto[]): Record<string, LayoutEnginePhoto> {
  const map: Record<string, LayoutEnginePhoto> = {};
  for (const p of photos) map[p.id] = p;
  return map;
}

function makeSection(
  title: string,
  photoIds: string[],
  description = "",
): LayoutEngineSection {
  return { title, description, photo_ids: photoIds };
}

describe("buildReportDocument", () => {
  it("emits a cover page as the first entry", () => {
    const pages = buildReportDocument({
      job: baseJob,
      companySettings: baseSettings,
      sections: [],
      photos: {},
      photosPerPage: 2,
    });

    expect(pages[0]).toEqual({ kind: "cover" });
  });

  describe("continuous numbering", () => {
    it("numbers photos 1..N across the whole report in traversal order", () => {
      const photos = photosByIds(
        makePhoto({ id: "a" }),
        makePhoto({ id: "b" }),
        makePhoto({ id: "c" }),
        makePhoto({ id: "d" }),
      );

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [
          makeSection("Exterior", ["a", "b"]),
          makeSection("Interior", ["c", "d"]),
        ],
        photos,
        photosPerPage: 2,
      });

      const photoPages = pages.filter((p) => p.kind === "photoPage");
      const allSlots = photoPages.flatMap((p) =>
        p.kind === "photoPage" ? p.slots : [],
      );

      expect(allSlots.map((s) => s.photoId)).toEqual(["a", "b", "c", "d"]);
      expect(allSlots.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    });

    it("starts numbering at 1 even when the first section is empty", () => {
      const photos = photosByIds(makePhoto({ id: "x" }), makePhoto({ id: "y" }));

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [
          makeSection("Empty Section", []),
          makeSection("Real Section", ["x", "y"]),
        ],
        photos,
        photosPerPage: 2,
      });

      const slots = pages
        .filter((p) => p.kind === "photoPage")
        .flatMap((p) => (p.kind === "photoPage" ? p.slots : []));

      expect(slots.map((s) => s.number)).toEqual([1, 2]);
    });
  });

  describe("bucketing at photosPerPage = 2", () => {
    it("groups two photos into one page", () => {
      const photos = photosByIds(makePhoto({ id: "a" }), makePhoto({ id: "b" }));

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [makeSection("Only", ["a", "b"])],
        photos,
        photosPerPage: 2,
      });

      const photoPages = pages.filter((p) => p.kind === "photoPage");
      expect(photoPages).toHaveLength(1);
      expect(photoPages[0].kind === "photoPage" && photoPages[0].slots).toHaveLength(2);
    });

    it("puts an odd final photo on its own page with one slot", () => {
      const photos = photosByIds(
        makePhoto({ id: "a" }),
        makePhoto({ id: "b" }),
        makePhoto({ id: "c" }),
      );

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [makeSection("Only", ["a", "b", "c"])],
        photos,
        photosPerPage: 2,
      });

      const photoPages = pages.filter((p) => p.kind === "photoPage");
      expect(photoPages).toHaveLength(2);

      const first = photoPages[0];
      const second = photoPages[1];
      if (first.kind !== "photoPage" || second.kind !== "photoPage") {
        throw new Error("expected photoPage entries");
      }

      expect(first.slots.map((s) => s.photoId)).toEqual(["a", "b"]);
      expect(second.slots.map((s) => s.photoId)).toEqual(["c"]);
    });
  });

  describe("multi-section ordering", () => {
    it("emits section pages in section order with sectionTitle set per page", () => {
      const photos = photosByIds(
        makePhoto({ id: "a" }),
        makePhoto({ id: "b" }),
        makePhoto({ id: "c" }),
      );

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [
          makeSection("Exterior", ["a", "b"]),
          makeSection("Interior", ["c"]),
        ],
        photos,
        photosPerPage: 2,
      });

      const photoPages = pages.filter((p) => p.kind === "photoPage");
      expect(
        photoPages.map((p) => (p.kind === "photoPage" ? p.sectionTitle : "")),
      ).toEqual(["Exterior", "Interior"]);
    });

    it("does not pack photos from different sections onto the same page", () => {
      // One photo in section A, one in section B → must be two separate pages,
      // not one page combining them even though photosPerPage = 2.
      const photos = photosByIds(makePhoto({ id: "a" }), makePhoto({ id: "b" }));

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [
          makeSection("Exterior", ["a"]),
          makeSection("Interior", ["b"]),
        ],
        photos,
        photosPerPage: 2,
      });

      const photoPages = pages.filter((p) => p.kind === "photoPage");
      expect(photoPages).toHaveLength(2);
      const [first, second] = photoPages;
      if (first.kind !== "photoPage" || second.kind !== "photoPage") {
        throw new Error("expected photoPage entries");
      }
      expect(first.sectionTitle).toBe("Exterior");
      expect(first.slots).toHaveLength(1);
      expect(second.sectionTitle).toBe("Interior");
      expect(second.slots).toHaveLength(1);
    });
  });

  describe("empty section", () => {
    it("emits no photo pages for a section with no photos", () => {
      const photos = photosByIds(makePhoto({ id: "a" }));

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [
          makeSection("Empty", []),
          makeSection("Real", ["a"]),
        ],
        photos,
        photosPerPage: 2,
      });

      const photoPages = pages.filter((p) => p.kind === "photoPage");
      expect(photoPages).toHaveLength(1);
      expect(
        photoPages[0].kind === "photoPage" && photoPages[0].sectionTitle,
      ).toBe("Real");
    });
  });

  describe("orientation marker", () => {
    it("marks a wider-than-tall photo as landscape", () => {
      const photos = photosByIds(
        makePhoto({ id: "a", width: 4000, height: 3000 }),
      );

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [makeSection("Only", ["a"])],
        photos,
        photosPerPage: 2,
      });

      const slot = pages
        .filter((p) => p.kind === "photoPage")
        .flatMap((p) => (p.kind === "photoPage" ? p.slots : []))[0];

      expect(slot.orientation).toBe("landscape");
    });

    it("marks a taller-than-wide photo as portrait", () => {
      const photos = photosByIds(
        makePhoto({ id: "a", width: 3000, height: 4000 }),
      );

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [makeSection("Only", ["a"])],
        photos,
        photosPerPage: 2,
      });

      const slot = pages
        .filter((p) => p.kind === "photoPage")
        .flatMap((p) => (p.kind === "photoPage" ? p.slots : []))[0];

      expect(slot.orientation).toBe("portrait");
    });

    it("defaults to portrait when width or height is unknown", () => {
      const photos = photosByIds(
        makePhoto({ id: "a", width: null, height: null }),
      );

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [makeSection("Only", ["a"])],
        photos,
        photosPerPage: 2,
      });

      const slot = pages
        .filter((p) => p.kind === "photoPage")
        .flatMap((p) => (p.kind === "photoPage" ? p.slots : []))[0];

      expect(slot.orientation).toBe("portrait");
    });
  });

  describe("missing photos", () => {
    it("skips photo_ids that are not present in the photos map", () => {
      const photos = photosByIds(makePhoto({ id: "a" }), makePhoto({ id: "c" }));

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [makeSection("Only", ["a", "missing", "c"])],
        photos,
        photosPerPage: 2,
      });

      const slots = pages
        .filter((p) => p.kind === "photoPage")
        .flatMap((p) => (p.kind === "photoPage" ? p.slots : []));

      expect(slots.map((s) => s.photoId)).toEqual(["a", "c"]);
      expect(slots.map((s) => s.number)).toEqual([1, 2]);
    });
  });

  describe("slot field passthrough", () => {
    it("preserves caption, takenAt, and takenBy from the input photo onto the slot", () => {
      const photos = photosByIds(
        makePhoto({
          id: "a",
          caption: "Living room wall",
          takenAt: "2026-04-01T10:00:00Z",
          takenBy: "Alice Tech",
        }),
      );

      const pages = buildReportDocument({
        job: baseJob,
        companySettings: baseSettings,
        sections: [makeSection("Only", ["a"])],
        photos,
        photosPerPage: 2,
      });

      const slot = pages
        .filter((p) => p.kind === "photoPage")
        .flatMap((p) => (p.kind === "photoPage" ? p.slots : []))[0];

      expect(slot.caption).toBe("Living room wall");
      expect(slot.takenAt).toBe("2026-04-01T10:00:00Z");
      expect(slot.takenBy).toBe("Alice Tech");
    });
  });
});

import { describe, expect, it } from "vitest";

import { buildReportRenderModel } from "./report-render-model";
import type {
  BuildReportRenderModelArgs,
  RenderPhotoInput,
  RenderPage,
} from "./report-render-model";
import type { CoverPageData } from "./cover-page-data";
import type { ResolvedReportSettings } from "./photo-report-settings";

function makePhoto(
  overrides: Partial<RenderPhotoInput> = {},
): RenderPhotoInput {
  return {
    id: "p-1",
    caption: null,
    takenAt: null,
    takenBy: null,
    width: 100,
    height: 200,
    url: "https://cdn.example/p-1.jpg",
    tags: [],
    ...overrides,
  };
}

function makeSettings(
  overrides: Partial<ResolvedReportSettings> = {},
): ResolvedReportSettings {
  return {
    photosPerPage: 2,
    details: {
      sectionTitlePages: true,
      photoNumbers: true,
      capturedBy: true,
      location: true,
      dateCaptured: true,
      photoTags: true,
      ...overrides.details,
    },
    cover: {
      logo: true,
      customer: true,
      propertyAddress: true,
      pointOfContact: true,
      insurance: true,
      coverPhotoId: null,
      ...overrides.cover,
    },
    ...("photosPerPage" in overrides
      ? { photosPerPage: overrides.photosPerPage! }
      : {}),
  };
}

function makeCoverData(overrides: Partial<CoverPageData> = {}): CoverPageData {
  return {
    logo: { kind: "text", name: "AAA" },
    customerName: "Jane Doe",
    propertyAddress: "123 Main St",
    pointOfContact: { companyName: "AAA", phone: "555", email: "a@b.co" },
    insurance: { visible: true, carrier: "Acme", claimNumber: "CL-1" },
    ...overrides,
  };
}

function makeArgs(
  overrides: Partial<BuildReportRenderModelArgs> = {},
): BuildReportRenderModelArgs {
  return {
    title: "Roof Report",
    sections: [],
    photos: {},
    settings: makeSettings(),
    coverData: makeCoverData(),
    coverPhotoUrl: null,
    propertyAddress: "123 Main St",
    ...overrides,
  };
}

const photoPages = (pages: RenderPage[]) =>
  pages.filter((p): p is Extract<RenderPage, { kind: "photoPage" }> =>
    p.kind === "photoPage",
  );

describe("buildReportRenderModel", () => {
  it("delegates page structure to the planner, threading photos-per-page and the Section-Title-Page toggle", () => {
    const model = buildReportRenderModel(
      makeArgs({
        sections: [
          { title: "Exterior", description: "<p>hi</p>", photoIds: ["a", "b", "c"] },
        ],
        photos: {
          a: makePhoto({ id: "a" }),
          b: makePhoto({ id: "b" }),
          c: makePhoto({ id: "c" }),
        },
        settings: makeSettings({ photosPerPage: 2 }),
      }),
    );

    expect(model.title).toBe("Roof Report");
    expect(model.pages.map((p) => p.kind)).toEqual([
      "cover",
      "sectionDivider",
      "photoPage",
      "photoPage",
    ]);
    expect(photoPages(model.pages).map((p) => p.photosPerPage)).toEqual([2, 2]);
  });

  it("populates every detail field on a slot when all toggles are on", () => {
    const model = buildReportRenderModel(
      makeArgs({
        sections: [{ title: "S", description: null, photoIds: ["a"] }],
        photos: {
          a: makePhoto({
            id: "a",
            caption: "Front door",
            takenAt: "2026-01-02T03:04:05Z",
            takenBy: "Sam",
            url: "https://cdn.example/a.jpg",
            tags: [{ name: "Damage", color: "#ff0000" }],
          }),
        },
        propertyAddress: "123 Main St",
      }),
    );

    const [slot] = photoPages(model.pages)[0].slots;
    expect(slot).toEqual({
      photoId: "a",
      url: "https://cdn.example/a.jpg",
      number: 1,
      caption: "Front door",
      dateCaptured: "2026-01-02T03:04:05Z",
      capturedBy: "Sam",
      location: "123 Main St",
      tags: [{ name: "Damage", color: "#ff0000" }],
      orientation: "portrait",
    });
  });

  it("nulls each detail field when its toggle is off, but always keeps the caption", () => {
    const model = buildReportRenderModel(
      makeArgs({
        sections: [{ title: "S", description: null, photoIds: ["a"] }],
        photos: {
          a: makePhoto({
            id: "a",
            caption: "Front door",
            takenAt: "2026-01-02T03:04:05Z",
            takenBy: "Sam",
            tags: [{ name: "Damage", color: "#ff0000" }],
          }),
        },
        propertyAddress: "123 Main St",
        settings: makeSettings({
          details: {
            sectionTitlePages: true,
            photoNumbers: false,
            capturedBy: false,
            location: false,
            dateCaptured: false,
            photoTags: false,
          },
        }),
      }),
    );

    const [slot] = photoPages(model.pages)[0].slots;
    expect(slot.number).toBeNull();
    expect(slot.capturedBy).toBeNull();
    expect(slot.dateCaptured).toBeNull();
    expect(slot.location).toBeNull();
    expect(slot.tags).toEqual([]);
    expect(slot.caption).toBe("Front door");
  });

  it("sets location to the Job's property address, treating a blank address as none", () => {
    const blank = buildReportRenderModel(
      makeArgs({
        sections: [{ title: "S", description: null, photoIds: ["a"] }],
        photos: { a: makePhoto({ id: "a" }) },
        propertyAddress: "   ",
      }),
    );
    expect(photoPages(blank.pages)[0].slots[0].location).toBeNull();
  });

  it("passes a photo's tags through as render chips, gated by the tags toggle", () => {
    const tags = [
      { name: "Damage", color: "#ff0000" },
      { name: "Repaired", color: "#00aa00" },
    ];
    const model = buildReportRenderModel(
      makeArgs({
        sections: [{ title: "S", description: null, photoIds: ["a"] }],
        photos: { a: makePhoto({ id: "a", tags }) },
      }),
    );
    expect(photoPages(model.pages)[0].slots[0].tags).toEqual(tags);
  });

  it("gates the before/after pair slots through the same toggles", () => {
    const model = buildReportRenderModel(
      makeArgs({
        sections: [{ title: "S", description: null, photoIds: ["a", "b"] }],
        photos: {
          a: makePhoto({
            id: "a",
            takenBy: "Sam",
            beforeAfterPairId: "pair-1",
            beforeAfterRole: "before",
          }),
          b: makePhoto({
            id: "b",
            takenBy: "Sam",
            beforeAfterPairId: "pair-1",
            beforeAfterRole: "after",
          }),
        },
        settings: makeSettings({
          details: {
            sectionTitlePages: true,
            photoNumbers: true,
            capturedBy: false,
            location: true,
            dateCaptured: true,
            photoTags: true,
          },
        }),
      }),
    );

    const pair = model.pages.find(
      (p): p is Extract<RenderPage, { kind: "beforeAfterPair" }> =>
        p.kind === "beforeAfterPair",
    )!;
    expect(pair.before.capturedBy).toBeNull();
    expect(pair.after.capturedBy).toBeNull();
    expect(pair.before.location).toBe("123 Main St");
    expect(pair.before.number).toBe(1);
    expect(pair.after.number).toBe(2);
  });

  it("resolves the Cover Page: visible blocks pass through, hidden blocks become null, title and cover photo are carried", () => {
    const model = buildReportRenderModel(
      makeArgs({
        title: "Roof Report",
        coverData: makeCoverData({
          customerName: "Jane Doe",
          propertyAddress: "123 Main St",
        }),
        coverPhotoUrl: "https://cdn.example/cover.jpg",
        settings: makeSettings({
          cover: {
            logo: true,
            customer: true,
            propertyAddress: false,
            pointOfContact: false,
            insurance: true,
            coverPhotoId: null,
          },
        }),
      }),
    );

    expect(model.cover.title).toBe("Roof Report");
    expect(model.cover.coverPhotoUrl).toBe("https://cdn.example/cover.jpg");
    expect(model.cover.customerName).toBe("Jane Doe");
    expect(model.cover.logo).toEqual({ kind: "text", name: "AAA" });
    expect(model.cover.insurance).toEqual({
      visible: true,
      carrier: "Acme",
      claimNumber: "CL-1",
    });
    // Hidden blocks are nulled out.
    expect(model.cover.propertyAddress).toBeNull();
    expect(model.cover.pointOfContact).toBeNull();
  });
});

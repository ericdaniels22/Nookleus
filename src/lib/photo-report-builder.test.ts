// Issue #401 — Photo Report Rework, Slice 2b (extends #400, Slice 2a).
//
// Tests for the pure "builder brain": turning a photo selection into the one
// default Section a new report starts with, the reducer that holds the report
// while it is being edited (tracking what changed so auto-save knows when to
// fire), and the slice-2b Section-management + photo-assignment operations.

import { describe, expect, it } from "vitest";

import {
  buildDefaultReportSections,
  initBuilderState,
  photoReportBuilderReducer,
} from "./photo-report-builder";

function loaded() {
  return initBuilderState({
    title: "Photo Report #1",
    report_date: "2026-06-04",
    sections: [{ title: "Photos", description: "", photo_ids: ["p1", "p2"] }],
  });
}

/** The five Cover Page block flags, all on — the #551 cover-block default. */
const DEFAULT_COVER_BLOCKS = {
  logo: true,
  customer: true,
  propertyAddress: true,
  pointOfContact: true,
  insurance: true,
} as const;

describe("buildDefaultReportSections", () => {
  it("puts every selected photo into a single default section, in order", () => {
    expect(buildDefaultReportSections(["p1", "p2", "p3"])).toEqual([
      expect.objectContaining({
        title: "Photos",
        description: "",
        photo_ids: ["p1", "p2", "p3"],
      }),
    ]);
  });

  it("still returns one (empty) section when nothing was selected", () => {
    expect(buildDefaultReportSections([])).toEqual([
      expect.objectContaining({ title: "Photos", description: "", photo_ids: [] }),
    ]);
  });

  it("copies the selection so later edits do not mutate the caller's array", () => {
    const selection = ["p1"];
    const sections = buildDefaultReportSections(selection);
    sections[0].photo_ids.push("p2");
    expect(selection).toEqual(["p1"]);
  });

  it("stamps the default section with an id from the injected id factory", () => {
    expect(buildDefaultReportSections(["p1"], () => "sec-1")).toEqual([
      { id: "sec-1", title: "Photos", description: "", photo_ids: ["p1"] },
    ]);
  });

  it("gives the default section a non-empty id by default", () => {
    const [section] = buildDefaultReportSections([]);
    expect(typeof section.id).toBe("string");
    expect(section.id.length).toBeGreaterThan(0);
  });
});

describe("photoReportBuilderReducer", () => {
  it("a freshly loaded report is not dirty", () => {
    expect(loaded().dirty).toBe(false);
  });

  it("editing the title changes it and marks the report dirty", () => {
    const next = photoReportBuilderReducer(loaded(), {
      type: "setTitle",
      title: "Roof damage report",
    });
    expect(next.title).toBe("Roof damage report");
    expect(next.dirty).toBe(true);
  });

  it("editing the report date changes it and marks the report dirty", () => {
    const next = photoReportBuilderReducer(loaded(), {
      type: "setReportDate",
      reportDate: "2026-06-10",
    });
    expect(next.reportDate).toBe("2026-06-10");
    expect(next.dirty).toBe(true);
  });

  it("editing a section heading changes that section and marks dirty", () => {
    const next = photoReportBuilderReducer(loaded(), {
      type: "setSectionHeading",
      index: 0,
      heading: "Exterior",
    });
    expect(next.sections[0].title).toBe("Exterior");
    expect(next.sections[0].photo_ids).toEqual(["p1", "p2"]);
    expect(next.dirty).toBe(true);
  });

  it("editing a section write-up changes that section and marks dirty", () => {
    const next = photoReportBuilderReducer(loaded(), {
      type: "setSectionWriteup",
      index: 0,
      writeup: "Significant water intrusion along the north wall.",
    });
    expect(next.sections[0].description).toBe(
      "Significant water intrusion along the north wall.",
    );
    expect(next.dirty).toBe(true);
  });

  it("changing photos-per-page updates it and marks the report dirty", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "setPhotosPerPage",
      photosPerPage: 4,
    });
    expect(next.photosPerPage).toBe(4);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBeGreaterThan(before.revision);
  });

  it("treats re-picking the current photos-per-page as a no-op", () => {
    // loaded() resolves to the 2-per-page default; re-selecting 2 must change
    // nothing — same state object back, not dirtied (mirrors the photo no-ops).
    const before = loaded();
    expect(before.photosPerPage).toBe(2);
    const next = photoReportBuilderReducer(before, {
      type: "setPhotosPerPage",
      photosPerPage: 2,
    });
    expect(next).toBe(before);
  });

  it("toggling a detail field flips it, leaving the others, and marks dirty", () => {
    const before = loaded();
    // loaded() resolves to all detail toggles on.
    expect(before.details.photoNumbers).toBe(true);
    expect(before.details.location).toBe(true);
    const next = photoReportBuilderReducer(before, {
      type: "toggleReportField",
      field: "photoNumbers",
    });
    expect(next.details.photoNumbers).toBe(false);
    expect(next.details.location).toBe(true);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBeGreaterThan(before.revision);
  });

  it("toggling a detail field twice returns it to its starting value", () => {
    const before = loaded();
    const once = photoReportBuilderReducer(before, {
      type: "toggleReportField",
      field: "sectionTitlePages",
    });
    const twice = photoReportBuilderReducer(once, {
      type: "toggleReportField",
      field: "sectionTitlePages",
    });
    expect(once.details.sectionTitlePages).toBe(false);
    expect(twice.details.sectionTitlePages).toBe(true);
  });

  it("toggling Include-Sketch-Plan flips it, marks dirty, and bumps the revision (#868)", () => {
    const before = loaded();
    // The Sketch-plan page is opt-in, so a settings-less report starts off.
    expect(before.includeSketchPlan).toBe(false);
    const on = photoReportBuilderReducer(before, {
      type: "toggleIncludeSketchPlan",
    });
    expect(on.includeSketchPlan).toBe(true);
    expect(on.dirty).toBe(true);
    expect(on.revision).toBeGreaterThan(before.revision);
    // The detail toggles are a separate group — flipping the plan leaves them.
    expect(on.details).toEqual(before.details);
    // Toggling again returns it to off.
    const off = photoReportBuilderReducer(on, {
      type: "toggleIncludeSketchPlan",
    });
    expect(off.includeSketchPlan).toBe(false);
  });

  it("seeds photos-per-page and detail toggles from the loaded report's snapshot", () => {
    const state = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [{ title: "Photos", description: "", photo_ids: [] }],
      report_settings: { photosPerPage: 4, photoTags: false },
    });
    expect(state.photosPerPage).toBe(4);
    expect(state.details.photoTags).toBe(false);
    // Fields the snapshot omits fall through to the all-on default.
    expect(state.details.location).toBe(true);
  });

  it("defaults a settings-less report to 2-per-page with every detail toggle on", () => {
    const state = loaded();
    expect(state.photosPerPage).toBe(2);
    expect(state.details).toEqual({
      sectionTitlePages: true,
      photoNumbers: true,
      capturedBy: true,
      location: true,
      dateCaptured: true,
      photoTags: true,
    });
  });

  it("seeds Include-Sketch-Plan on from the loaded report's snapshot (#868)", () => {
    const state = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [{ title: "Photos", description: "", photo_ids: [] }],
      report_settings: { includeSketchPlan: true },
    });
    expect(state.includeSketchPlan).toBe(true);
    // Seeding a loaded report is not an edit.
    expect(state.dirty).toBe(false);
  });

  it("marking saved clears the dirty flag once the current revision lands", () => {
    const edited = photoReportBuilderReducer(loaded(), {
      type: "setTitle",
      title: "Edited",
    });
    expect(edited.dirty).toBe(true);
    const saved = photoReportBuilderReducer(edited, {
      type: "markSaved",
      revision: edited.revision,
    });
    expect(saved.dirty).toBe(false);
    expect(saved.title).toBe("Edited");
  });

  it("keeps the report dirty when a save lands for a stale revision", () => {
    // A save for revision N completes, but the user already typed again
    // (revision N+1) while it was in flight. Clearing dirty here would strand
    // the newer edit unsaved, so the reducer must leave the report dirty.
    const first = photoReportBuilderReducer(loaded(), {
      type: "setTitle",
      title: "A",
    });
    const second = photoReportBuilderReducer(first, {
      type: "setTitle",
      title: "AB",
    });
    expect(second.revision).toBeGreaterThan(first.revision);

    const afterStaleSave = photoReportBuilderReducer(second, {
      type: "markSaved",
      revision: first.revision,
    });
    expect(afterStaleSave.dirty).toBe(true);
    expect(afterStaleSave.title).toBe("AB");

    // The follow-up save for the current revision then clears it.
    const afterCurrentSave = photoReportBuilderReducer(afterStaleSave, {
      type: "markSaved",
      revision: second.revision,
    });
    expect(afterCurrentSave.dirty).toBe(false);
  });

  it("adds a new empty section to the end and marks the report dirty", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "addSection",
      id: "new-sec",
    });
    expect(next.sections).toHaveLength(before.sections.length + 1);
    const added = next.sections[next.sections.length - 1];
    expect(added.title).toBe("New section");
    expect(added.description).toBe("");
    expect(added.photo_ids).toEqual([]);
    // The sections that were already there are untouched.
    expect(next.sections[0]).toEqual(before.sections[0]);
    expect(next.dirty).toBe(true);
  });

  it("gives the added section the stable id carried by the action", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "addSection",
      id: "added-1",
    });
    expect(next.sections[next.sections.length - 1].id).toBe("added-1");
  });

  it("removes the section at the given index, dropping its photos from the report, and marks dirty", () => {
    // A two-section report: [ Photos(p1,p2), New section() ].
    const before = photoReportBuilderReducer(loaded(), {
      type: "addSection",
      id: "s2",
    });
    const next = photoReportBuilderReducer(before, {
      type: "removeSection",
      index: 0,
    });
    expect(next.sections).toHaveLength(1);
    expect(next.sections[0].title).toBe("New section");
    // The removed section's photos are gone from the report entirely.
    expect(next.sections.flatMap((s) => s.photo_ids)).not.toContain("p1");
    expect(next.dirty).toBe(true);
  });

  it("ignores a remove for a section index that does not exist", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "removeSection",
      index: 5,
    });
    expect(next).toBe(before);
  });

  it("reorders a section to a new position and marks dirty", () => {
    const before = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [
        { title: "A", description: "", photo_ids: [] },
        { title: "B", description: "", photo_ids: [] },
        { title: "C", description: "", photo_ids: [] },
      ],
    });
    const next = photoReportBuilderReducer(before, {
      type: "reorderSection",
      from: 0,
      to: 2,
    });
    expect(next.sections.map((s) => s.title)).toEqual(["B", "C", "A"]);
    expect(next.dirty).toBe(true);
  });

  it("ignores a reorder with an out-of-range index", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "reorderSection",
      from: 0,
      to: 9,
    });
    expect(next).toBe(before);
  });

  it("treats reordering a section onto itself as a no-op", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "reorderSection",
      from: 0,
      to: 0,
    });
    expect(next).toBe(before);
  });

  it("assigns a photo into a section, appending it and marking dirty", () => {
    // [ Photos(p1,p2), New section() ].
    const before = photoReportBuilderReducer(loaded(), {
      type: "addSection",
      id: "s2",
    });
    // Add a photo that is not yet anywhere in the report (add-to-report).
    const next = photoReportBuilderReducer(before, {
      type: "assignPhotoToSection",
      photoId: "p9",
      sectionIndex: 1,
    });
    expect(next.sections[1].photo_ids).toEqual(["p9"]);
    expect(next.sections[0].photo_ids).toEqual(["p1", "p2"]);
    expect(next.dirty).toBe(true);
  });

  it("moving a photo to another section removes it from the section it was in", () => {
    // [ Photos(p1,p2), New section() ]; move p1 into section 1.
    const before = photoReportBuilderReducer(loaded(), {
      type: "addSection",
      id: "s2",
    });
    const next = photoReportBuilderReducer(before, {
      type: "assignPhotoToSection",
      photoId: "p1",
      sectionIndex: 1,
    });
    expect(next.sections[0].photo_ids).toEqual(["p2"]);
    expect(next.sections[1].photo_ids).toEqual(["p1"]);
  });

  it("treats assigning a photo to the section it already occupies as a no-op", () => {
    // loaded(): [ Photos(p1,p2) ]. p1 is already (only) in section 0, so
    // re-assigning it there must change nothing — no reorder, no dirty, and the
    // exact same state object back (mirrors removePhotoFromReport's no-op).
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "assignPhotoToSection",
      photoId: "p1",
      sectionIndex: 0,
    });
    expect(next).toBe(before);
  });

  it("ignores assigning a photo to a section index that does not exist", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "assignPhotoToSection",
      photoId: "p1",
      sectionIndex: 9,
    });
    expect(next).toBe(before);
  });

  it("adds several photos to a section in selection order with one revision bump (#552)", () => {
    const before = loaded(); // [ Photos(p1,p2) ]
    const next = photoReportBuilderReducer(before, {
      type: "addPhotosToSection",
      photoIds: ["p3", "p4", "p5"],
      sectionIndex: 0,
    });
    expect(next.sections[0].photo_ids).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(next.dirty).toBe(true);
    // The whole multi-add is one edit: one revision bump, one auto-save.
    expect(next.revision).toBe(before.revision + 1);
  });

  it("dedupes a selection that names the same photo twice", () => {
    const next = photoReportBuilderReducer(loaded(), {
      type: "addPhotosToSection",
      photoIds: ["p3", "p4", "p3"],
      sectionIndex: 0,
    });
    expect(next.sections[0].photo_ids).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("adding a photo that lives in another section moves it (no duplicates)", () => {
    // [ Photos(p1,p2), New section() ]; add p1 + a new p9 into section 1.
    const before = photoReportBuilderReducer(loaded(), {
      type: "addSection",
      id: "s2",
    });
    const next = photoReportBuilderReducer(before, {
      type: "addPhotosToSection",
      photoIds: ["p1", "p9"],
      sectionIndex: 1,
    });
    expect(next.sections[0].photo_ids).toEqual(["p2"]);
    expect(next.sections[1].photo_ids).toEqual(["p1", "p9"]);
  });

  it("keeps a photo already in the target section in place while appending the rest", () => {
    // p1 is already first in section 0 — re-adding it must not move it to the
    // end (the picker disables in-Section photos, but the reducer guards too).
    const next = photoReportBuilderReducer(loaded(), {
      type: "addPhotosToSection",
      photoIds: ["p1", "p3"],
      sectionIndex: 0,
    });
    expect(next.sections[0].photo_ids).toEqual(["p1", "p2", "p3"]);
  });

  it("treats an add that changes nothing as a no-op", () => {
    const before = loaded();
    // Everything requested is already (only) in the target section.
    expect(
      photoReportBuilderReducer(before, {
        type: "addPhotosToSection",
        photoIds: ["p1", "p2"],
        sectionIndex: 0,
      }),
    ).toBe(before);
    // An empty selection is equally a no-op.
    expect(
      photoReportBuilderReducer(before, {
        type: "addPhotosToSection",
        photoIds: [],
        sectionIndex: 0,
      }),
    ).toBe(before);
  });

  it("ignores adding photos to a section index that does not exist", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "addPhotosToSection",
      photoIds: ["p3"],
      sectionIndex: 9,
    });
    expect(next).toBe(before);
  });

  it("reorders a photo within its section and marks dirty (#552)", () => {
    const before = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [
        { title: "Photos", description: "", photo_ids: ["p1", "p2", "p3"] },
        { title: "Other", description: "", photo_ids: ["p4"] },
      ],
    });
    const next = photoReportBuilderReducer(before, {
      type: "reorderPhotoWithinSection",
      sectionIndex: 0,
      from: 0,
      to: 2,
    });
    // arrayMove semantics: the dragged photo lands at the target index.
    expect(next.sections[0].photo_ids).toEqual(["p2", "p3", "p1"]);
    // The other section is untouched (same object, not just equal).
    expect(next.sections[1]).toBe(before.sections[1]);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBe(before.revision + 1);
  });

  it("treats reordering a photo onto its own position as a no-op", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "reorderPhotoWithinSection",
      sectionIndex: 0,
      from: 1,
      to: 1,
    });
    expect(next).toBe(before);
  });

  it("ignores a photo reorder with an out-of-range photo index", () => {
    const before = loaded(); // section 0 has two photos
    expect(
      photoReportBuilderReducer(before, {
        type: "reorderPhotoWithinSection",
        sectionIndex: 0,
        from: 0,
        to: 5,
      }),
    ).toBe(before);
    expect(
      photoReportBuilderReducer(before, {
        type: "reorderPhotoWithinSection",
        sectionIndex: 0,
        from: -1,
        to: 0,
      }),
    ).toBe(before);
  });

  it("ignores a photo reorder in a section index that does not exist", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "reorderPhotoWithinSection",
      sectionIndex: 9,
      from: 0,
      to: 1,
    });
    expect(next).toBe(before);
  });

  it("removes a photo from the report, taking it out of its section and marking dirty", () => {
    const before = loaded(); // [ Photos(p1,p2) ]
    const next = photoReportBuilderReducer(before, {
      type: "removePhotoFromReport",
      photoId: "p1",
    });
    expect(next.sections[0].photo_ids).toEqual(["p2"]);
    expect(next.dirty).toBe(true);
  });

  it("ignores removing a photo that is not in the report", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "removePhotoFromReport",
      photoId: "not-in-report",
    });
    expect(next).toBe(before);
  });

  it("bumps the revision on a section edit so an in-flight save cannot strand it", () => {
    const before = loaded();
    expect(
      photoReportBuilderReducer(before, { type: "addSection", id: "s2" })
        .revision,
    ).toBeGreaterThan(before.revision);
    expect(
      photoReportBuilderReducer(before, {
        type: "assignPhotoToSection",
        photoId: "p9",
        sectionIndex: 0,
      }).revision,
    ).toBeGreaterThan(before.revision);
  });

  it("does not mutate the state it was handed", () => {
    const before = loaded();
    photoReportBuilderReducer(before, { type: "setTitle", title: "Edited" });
    photoReportBuilderReducer(before, {
      type: "setSectionHeading",
      index: 0,
      heading: "Edited",
    });
    expect(before.title).toBe("Photo Report #1");
    expect(before.sections[0].title).toBe("Photos");
    expect(before.dirty).toBe(false);
  });

  it("ignores an edit to a section index that does not exist", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "setSectionHeading",
      index: 5,
      heading: "Nowhere",
    });
    expect(next).toBe(before);
  });
});

describe("cover page editor (#551)", () => {
  it("seeds the cover with all five blocks on and no photo by default", () => {
    // A loaded report carries a resolved cover (the resolver supplies the
    // job-photo fallback and the all-on block defaults); the builder brain just
    // seeds whatever it is handed. With nothing provided it is all-on, no photo.
    expect(loaded().cover).toEqual({
      logo: true,
      customer: true,
      propertyAddress: true,
      pointOfContact: true,
      insurance: true,
      coverPhotoId: null,
    });
  });

  it("seeds the cover from the report's resolved cover, without marking dirty", () => {
    // The component resolves the cover (report snapshot → Job cover photo →
    // defaults) and hands it in; the builder seeds it verbatim. Loading is not
    // an edit, so the report is not dirty.
    const state = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [{ title: "Photos", description: "", photo_ids: [] }],
      cover: {
        logo: false,
        customer: true,
        propertyAddress: true,
        pointOfContact: false,
        insurance: true,
        coverPhotoId: "job-photo-1",
      },
    });
    expect(state.cover).toEqual({
      logo: false,
      customer: true,
      propertyAddress: true,
      pointOfContact: false,
      insurance: true,
      coverPhotoId: "job-photo-1",
    });
    expect(state.dirty).toBe(false);
  });

  it("setCoverPhoto chooses the cover photo, marking dirty and bumping the revision", () => {
    const before = loaded();
    const next = photoReportBuilderReducer(before, {
      type: "setCoverPhoto",
      photoId: "p2",
    });
    expect(next.cover.coverPhotoId).toBe("p2");
    // The block toggles are untouched.
    expect(next.cover.logo).toBe(true);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBeGreaterThan(before.revision);
  });

  it("treats re-choosing the cover photo it already has as a no-op", () => {
    // Seed a report whose cover photo is already p2; re-picking p2 must change
    // nothing — same state object back, not dirty (mirrors the assign no-op).
    const before = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [{ title: "Photos", description: "", photo_ids: [] }],
      cover: { ...DEFAULT_COVER_BLOCKS, coverPhotoId: "p2" },
    });
    const next = photoReportBuilderReducer(before, {
      type: "setCoverPhoto",
      photoId: "p2",
    });
    expect(next).toBe(before);
  });

  it("toggleCoverField turns a block off, marking dirty and bumping the revision", () => {
    const before = loaded(); // all blocks on
    const next = photoReportBuilderReducer(before, {
      type: "toggleCoverField",
      field: "insurance",
    });
    expect(next.cover.insurance).toBe(false);
    // The other blocks and the cover photo are untouched.
    expect(next.cover.logo).toBe(true);
    expect(next.cover.customer).toBe(true);
    expect(next.cover.coverPhotoId).toBe(null);
    expect(next.dirty).toBe(true);
    expect(next.revision).toBeGreaterThan(before.revision);
  });

  it("toggleCoverField flips a block back on when applied twice", () => {
    const off = photoReportBuilderReducer(loaded(), {
      type: "toggleCoverField",
      field: "logo",
    });
    expect(off.cover.logo).toBe(false);
    const onAgain = photoReportBuilderReducer(off, {
      type: "toggleCoverField",
      field: "logo",
    });
    expect(onAgain.cover.logo).toBe(true);
    expect(onAgain.dirty).toBe(true);
  });
});

describe("initBuilderState section ids (#467)", () => {
  it("backfills a stable id onto a loaded section that has none (legacy report)", () => {
    const state = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      // A report saved before #467: its section has no id.
      sections: [{ title: "Photos", description: "", photo_ids: [] }],
    });
    expect(typeof state.sections[0].id).toBe("string");
    expect(state.sections[0].id.length).toBeGreaterThan(0);
  });

  it("keeps a loaded section's existing id", () => {
    const state = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [
        { id: "kept", title: "Photos", description: "", photo_ids: [] },
      ],
    });
    expect(state.sections[0].id).toBe("kept");
  });

  it("gives distinct ids to multiple legacy sections so they reorder cleanly", () => {
    const state = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [
        { title: "A", description: "", photo_ids: [] },
        { title: "B", description: "", photo_ids: [] },
      ],
    });
    const ids = state.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps each backfilled id with its section across a reorder of a legacy report (AC3)", () => {
    // The full legacy path end to end: a pre-#467 report (no ids) loads, gets
    // distinct ids backfilled, then is reordered. Each section must carry its own
    // backfilled id to the new position — that stable identity riding with the
    // section is exactly what keeps React/dnd keys (and thus the caret) pinned.
    const state = initBuilderState({
      title: "R",
      report_date: "2026-06-04",
      sections: [
        { title: "A", description: "", photo_ids: [] },
        { title: "B", description: "", photo_ids: [] },
      ],
    });
    const [idA, idB] = state.sections.map((s) => s.id);
    expect(idA).not.toBe(idB);

    const next = photoReportBuilderReducer(state, {
      type: "reorderSection",
      from: 0,
      to: 1,
    });

    expect(next.sections.map((s) => s.title)).toEqual(["B", "A"]);
    // The id rides with the section, not the slot: B's id is now first, A's last.
    expect(next.sections.map((s) => s.id)).toEqual([idB, idA]);
  });
});

// Issue #400 — Photo Report Rework, Slice 2a.
//
// Tests for the pure "builder brain": turning a photo selection into the one
// default Section a new report starts with, and the reducer that holds the
// report while it is being edited (tracking what changed so auto-save knows
// when to fire).

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

describe("buildDefaultReportSections", () => {
  it("puts every selected photo into a single default section, in order", () => {
    expect(buildDefaultReportSections(["p1", "p2", "p3"])).toEqual([
      { title: "Photos", description: "", photo_ids: ["p1", "p2", "p3"] },
    ]);
  });

  it("still returns one (empty) section when nothing was selected", () => {
    expect(buildDefaultReportSections([])).toEqual([
      { title: "Photos", description: "", photo_ids: [] },
    ]);
  });

  it("copies the selection so later edits do not mutate the caller's array", () => {
    const selection = ["p1"];
    const sections = buildDefaultReportSections(selection);
    sections[0].photo_ids.push("p2");
    expect(selection).toEqual(["p1"]);
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

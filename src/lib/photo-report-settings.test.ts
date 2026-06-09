import { describe, expect, it } from "vitest";

import {
  REPORT_DEFAULT_SETTING_KEYS,
  companySettingsToReportDefault,
  resolveReportSettings,
} from "./photo-report-settings";

describe("resolveReportSettings", () => {
  it("falls back to the hardcoded defaults when nothing is stored (2-up, all toggles on, all cover blocks on)", () => {
    // A pre-0014 report has no stored settings and the Organization has no
    // Report layout default: the resolver must still return a complete look.
    // The last-resort defaults are 2 photos per page, every detail toggle on,
    // every cover block on, and no cover photo.
    const resolved = resolveReportSettings(null, null);

    expect(resolved.photosPerPage).toBe(2);
    expect(resolved.details).toEqual({
      sectionTitlePages: true,
      photoNumbers: true,
      capturedBy: true,
      location: true,
      dateCaptured: true,
      photoTags: true,
    });
    expect(resolved.cover).toEqual({
      logo: true,
      customer: true,
      propertyAddress: true,
      pointOfContact: true,
      insurance: true,
      coverPhotoId: null,
    });
  });

  it("uses the Organization default when the report has no stored settings of its own", () => {
    // A freshly-created report whose snapshot is absent reads as the
    // Organization's Report layout default (the seed it would have copied).
    const resolved = resolveReportSettings(null, {
      photosPerPage: 4,
      details: {
        sectionTitlePages: false,
        photoNumbers: true,
        capturedBy: false,
        location: true,
        dateCaptured: false,
        photoTags: true,
      },
    });

    expect(resolved.photosPerPage).toBe(4);
    expect(resolved.details).toEqual({
      sectionTitlePages: false,
      photoNumbers: true,
      capturedBy: false,
      location: true,
      dateCaptured: false,
      photoTags: true,
    });
  });

  it("falls through a partial Organization default field-by-field to the hardcoded defaults", () => {
    // The Organization default need not be complete: a field it omits falls
    // through to the hardcoded default (on / 2-up), never to "off".
    const resolved = resolveReportSettings(null, {
      details: { photoNumbers: false },
    });

    expect(resolved.photosPerPage).toBe(2); // omitted → hardcoded default
    expect(resolved.details).toEqual({
      sectionTitlePages: true,
      photoNumbers: false, // the one field the Org default set
      capturedBy: true,
      location: true,
      dateCaptured: true,
      photoTags: true,
    });
  });

  it("lets the report's own snapshot win over the Organization default, field-by-field", () => {
    // Once a report has its own snapshot, that is its look — editing the
    // Organization default never reaches back into it (snapshot model, ADR 0014).
    // A field the snapshot omits still falls through to the Org default.
    const resolved = resolveReportSettings(
      {
        report_settings: {
          photosPerPage: 3,
          capturedBy: false,
        },
      },
      {
        photosPerPage: 4,
        details: {
          sectionTitlePages: false,
          capturedBy: true,
          photoTags: false,
        },
      },
    );

    expect(resolved.photosPerPage).toBe(3); // snapshot wins over Org's 4
    expect(resolved.details).toEqual({
      sectionTitlePages: false, // snapshot silent → Org default
      photoNumbers: true, // silent in both → hardcoded default
      capturedBy: false, // snapshot wins over Org's true
      location: true,
      dateCaptured: true,
      photoTags: false, // snapshot silent → Org default
    });
  });

  it("normalizes a legacy 1-per-page value to 2, the retired layout's fallback (ADR 0014)", () => {
    // 1-per-page is dropped. A report or Organization still carrying 1 reads as
    // 2 — the hardcoded default — rather than falling through or rendering an
    // unsupported layout. This holds whether the value is a number or a string.
    expect(
      resolveReportSettings({ report_settings: { photosPerPage: 1 } }, { photosPerPage: 4 })
        .photosPerPage,
    ).toBe(2); // snapshot's retired 1 → 2, not the Org's 4
    expect(
      resolveReportSettings({ report_settings: { photosPerPage: "1" } }, null).photosPerPage,
    ).toBe(2);
    // (A legacy Organization default of 1 is normalized when the key-value rows
    // are parsed — see the companySettingsToReportDefault "legacy 1" test.)
  });

  it("accepts a string photos-per-page (JSONB / key-value rows arrive as strings)", () => {
    // The snapshot JSONB and the Organization key-value rows can carry "3" as a
    // string; the resolver coerces it to the numeric layout it names.
    expect(
      resolveReportSettings({ report_settings: { photosPerPage: "3" } }, null).photosPerPage,
    ).toBe(3);
  });

  it("ignores an out-of-range photos-per-page and falls through the precedence chain", () => {
    // A garbage or unsupported value (0, 5, "abc") is treated as absent, so the
    // next tier decides — never an unsupported layout reaching the renderer.
    expect(
      resolveReportSettings({ report_settings: { photosPerPage: 5 } }, { photosPerPage: 3 })
        .photosPerPage,
    ).toBe(3); // snapshot garbage → Org default
    expect(
      resolveReportSettings({ report_settings: { photosPerPage: "abc" } }, null).photosPerPage,
    ).toBe(2); // garbage with no Org default → hardcoded default
  });

  it("reads a report's own cover-block visibility, defaulting any omitted block to on", () => {
    // Cover config is per-report (no Organization tier): a block the report
    // hides stays hidden, and any block it leaves unset defaults on.
    const resolved = resolveReportSettings(
      { cover_config: { logo: false, insurance: false } },
      null,
    );

    expect(resolved.cover).toEqual({
      logo: false, // hidden by the report
      customer: true, // unset → default on
      propertyAddress: true,
      pointOfContact: true,
      insurance: false, // hidden by the report
      coverPhotoId: null,
    });
  });

  it("falls back to the Job's cover photo when the report has none of its own", () => {
    // A new report seeds its cover photo from the Job's (ADR 0014). Until the
    // report picks its own, the resolver fills in the Job's cover photo.
    expect(resolveReportSettings(null, null, "job-photo-1").cover.coverPhotoId).toBe(
      "job-photo-1",
    );
    expect(
      resolveReportSettings({ cover_photo_id: null }, null, "job-photo-1").cover.coverPhotoId,
    ).toBe("job-photo-1");
  });

  it("lets the report's own cover photo win over the Job's", () => {
    // Once the report picks a cover photo, that overrides the Job's seed.
    expect(
      resolveReportSettings({ cover_photo_id: "report-photo-9" }, null, "job-photo-1").cover
        .coverPhotoId,
    ).toBe("report-photo-9");
  });

  it("resolves the cover photo to null when neither the report nor the Job has one", () => {
    expect(resolveReportSettings(null, null).cover.coverPhotoId).toBe(null);
    expect(resolveReportSettings({ cover_photo_id: null }, null, null).cover.coverPhotoId).toBe(
      null,
    );
  });
});

describe("companySettingsToReportDefault", () => {
  it("parses the Organization key-value rows into a Report layout default", () => {
    // company_settings rows are strings; the photos-per-page key parses to a
    // number and the detail keys parse "true"/"false" to booleans.
    const def = companySettingsToReportDefault({
      [REPORT_DEFAULT_SETTING_KEYS.photosPerPage]: "3",
      [REPORT_DEFAULT_SETTING_KEYS.sectionTitlePages]: "false",
      [REPORT_DEFAULT_SETTING_KEYS.photoNumbers]: "true",
      [REPORT_DEFAULT_SETTING_KEYS.capturedBy]: "false",
      [REPORT_DEFAULT_SETTING_KEYS.location]: "true",
      [REPORT_DEFAULT_SETTING_KEYS.dateCaptured]: "false",
      [REPORT_DEFAULT_SETTING_KEYS.photoTags]: "true",
    });

    expect(def).toEqual({
      photosPerPage: 3,
      details: {
        sectionTitlePages: false,
        photoNumbers: true,
        capturedBy: false,
        location: true,
        dateCaptured: false,
        photoTags: true,
      },
    });
  });

  it("omits keys the Organization has not set, leaving them to fall through (read-tolerant)", () => {
    // An Organization that never configured a Report layout default produces an
    // empty default, which resolves to the hardcoded defaults.
    expect(companySettingsToReportDefault(null)).toEqual({});
    expect(companySettingsToReportDefault({})).toEqual({});

    const resolved = resolveReportSettings(null, companySettingsToReportDefault({}));
    expect(resolved.photosPerPage).toBe(2);
    expect(resolved.details.photoNumbers).toBe(true);

    // A partially-configured Organization carries only what it set.
    expect(
      companySettingsToReportDefault({
        [REPORT_DEFAULT_SETTING_KEYS.photosPerPage]: "4",
        [REPORT_DEFAULT_SETTING_KEYS.capturedBy]: "false",
      }),
    ).toEqual({ photosPerPage: 4, details: { capturedBy: false } });
  });

  it("normalizes a legacy 1-per-page Organization default to 2", () => {
    expect(
      companySettingsToReportDefault({
        [REPORT_DEFAULT_SETTING_KEYS.photosPerPage]: "1",
      }),
    ).toEqual({ photosPerPage: 2 });
  });
});

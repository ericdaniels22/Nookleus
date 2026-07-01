// src/lib/photo-report-settings.ts — the per-report Report Settings + Cover
// Page config core (ADR 0014, #549).
//
// A report carries its own snapshot of how it looks: photos-per-page, the six
// detail toggles, and the Cover Page config (which identifying blocks show, plus
// the chosen cover photo). A new report seeds these from the Organization's
// Report layout default; thereafter the report keeps its own copy, so editing
// the Organization default never rewrites a report that already exists (the same
// snapshot model as billing PDFs, ADR 0012). This module holds the pure pieces
// the feature resolves through — no I/O. Every function here is unit-tested.

import type { ReportPhotosPerPage } from "./types";

/** The six per-report detail toggles (ADR 0014). All default on. */
export interface ReportDetailToggles {
  sectionTitlePages: boolean;
  photoNumbers: boolean;
  capturedBy: boolean;
  location: boolean;
  dateCaptured: boolean;
  photoTags: boolean;
}

/** The five Cover Page block-visibility flags (ADR 0014). All default on. */
export interface CoverBlockVisibility {
  logo: boolean;
  customer: boolean;
  propertyAddress: boolean;
  pointOfContact: boolean;
  insurance: boolean;
}

/** A report's fully-resolved Cover Page config: block visibility + cover photo. */
export interface ResolvedCoverConfig extends CoverBlockVisibility {
  /** The photo printed on the cover, or null when none is chosen anywhere. */
  coverPhotoId: string | null;
}

/** A report's fully-resolved look: photos-per-page, details, and cover config. */
export interface ResolvedReportSettings {
  photosPerPage: ReportPhotosPerPage;
  details: ReportDetailToggles;
  cover: ResolvedCoverConfig;
  /**
   * Whether the report includes the Job's Sketch as dimensioned plan pages
   * (#868). Opt-in: unlike the detail toggles it defaults *off*, so a report
   * predating the feature never grows a plan page on its own.
   */
  includeSketchPlan: boolean;
}

/**
 * The Organization's Report layout default — the seed a new report copies (ADR
 * 0014). Every field is optional: an Organization that has set nothing, or only
 * some knobs, leaves the rest to fall through to the hardcoded defaults. It
 * carries no cover config; the cover is per-report only.
 */
export interface ReportLayoutDefault {
  photosPerPage?: ReportPhotosPerPage;
  details?: Partial<ReportDetailToggles>;
  /** The Organization's default for including the Sketch plan (#868). */
  includeSketchPlan?: boolean;
}

/**
 * The `report_settings` JSONB a report stores — photos-per-page plus the six
 * detail toggles. Every field is optional and read-tolerant: a pre-0014 row, or
 * a partial write, leaves fields absent and they fall through the precedence
 * chain. `photosPerPage` is typed loosely because JSONB and the legacy
 * 1-per-page value can arrive as a string or a number.
 */
export interface StoredReportSettingsJson extends Partial<ReportDetailToggles> {
  photosPerPage?: ReportPhotosPerPage | number | string | null;
  /** The report's own choice to include the Sketch plan (#868). */
  includeSketchPlan?: boolean | null;
}

/**
 * The slice of a `photo_reports` row this resolver reads: its own settings
 * snapshot, cover config, and cover photo. All read-tolerant — a pre-0014 row
 * has them all absent and reads as the Organization default / all-on cover.
 */
export interface StoredReportSettings {
  report_settings?: StoredReportSettingsJson | null;
  cover_config?: Partial<CoverBlockVisibility> | null;
  cover_photo_id?: string | null;
}

// The last-resort defaults: 2 photos per page, every detail toggle on, every
// cover block on, no cover photo. Used when a report has neither its own
// snapshot nor an Organization default (ADR 0014).
const DEFAULT_PHOTOS_PER_PAGE: ReportPhotosPerPage = 2;

const ALL_DETAILS_ON: ReportDetailToggles = {
  sectionTitlePages: true,
  photoNumbers: true,
  capturedBy: true,
  location: true,
  dateCaptured: true,
  photoTags: true,
};

const ALL_COVER_BLOCKS_ON: CoverBlockVisibility = {
  logo: true,
  customer: true,
  propertyAddress: true,
  pointOfContact: true,
  insurance: true,
};

const DETAIL_KEYS = Object.keys(ALL_DETAILS_ON) as (keyof ReportDetailToggles)[];
const COVER_BLOCK_KEYS = Object.keys(
  ALL_COVER_BLOCKS_ON,
) as (keyof CoverBlockVisibility)[];

/**
 * Coerce a stored photos-per-page value (number or string, from JSONB or a
 * key-value row) to a supported {@link ReportPhotosPerPage}. The retired
 * 1-per-page layout maps to 2 (ADR 0014); an out-of-range or unparseable value
 * returns undefined so the caller falls through the precedence chain.
 */
export function normalizePhotosPerPage(
  value: ReportPhotosPerPage | number | string | null | undefined,
): ReportPhotosPerPage | undefined {
  const n = Number(value);
  if (n === 1) return 2; // retired single-photo layout → the default
  if (n === 2 || n === 3 || n === 4) return n;
  return undefined;
}

/**
 * The `company_settings` key-value keys that hold the Organization's Report
 * layout default (ADR 0014, #549). `photosPerPage` reuses the pre-existing
 * `report_photos_per_page` key; the six detail toggles are new.
 */
export const REPORT_DEFAULT_SETTING_KEYS = {
  photosPerPage: "report_photos_per_page",
  sectionTitlePages: "report_detail_section_title_pages",
  photoNumbers: "report_detail_photo_numbers",
  capturedBy: "report_detail_captured_by",
  location: "report_detail_location",
  dateCaptured: "report_detail_date_captured",
  photoTags: "report_detail_photo_tags",
  includeSketchPlan: "report_include_sketch_plan",
} as const;

// Parse a key-value string into a boolean, or undefined when unset/unparseable
// so the field falls through the precedence chain rather than reading as "off".
function parseBool(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Build the Organization's {@link ReportLayoutDefault} from its `company_settings`
 * key-value rows (a flat string record). Unset or unparseable keys are omitted,
 * so a never-configured Organization yields an empty default that resolves to
 * the hardcoded defaults. A legacy 1-per-page value normalizes to 2.
 */
export function companySettingsToReportDefault(
  settings: Record<string, string | undefined> | null | undefined,
): ReportLayoutDefault {
  const result: ReportLayoutDefault = {};

  const photosPerPage = normalizePhotosPerPage(
    settings?.[REPORT_DEFAULT_SETTING_KEYS.photosPerPage],
  );
  if (photosPerPage !== undefined) result.photosPerPage = photosPerPage;

  const details: Partial<ReportDetailToggles> = {};
  for (const key of DETAIL_KEYS) {
    const parsed = parseBool(settings?.[REPORT_DEFAULT_SETTING_KEYS[key]]);
    if (parsed !== undefined) details[key] = parsed;
  }
  if (Object.keys(details).length > 0) result.details = details;

  const includeSketchPlan = parseBool(
    settings?.[REPORT_DEFAULT_SETTING_KEYS.includeSketchPlan],
  );
  if (includeSketchPlan !== undefined) result.includeSketchPlan = includeSketchPlan;

  return result;
}

/**
 * Resolve a report's effective look. Precedence, per field: the report's own
 * snapshot wins; else the Organization's Report layout default; else the
 * hardcoded defaults. Always returns a complete {@link ResolvedReportSettings} —
 * the builder and PDF engine must never face a report with "no look."
 *
 * The cover photo resolves the report's own choice first, then the Job's cover
 * photo (`jobCoverPhotoId` — the seed a new report copies, ADR 0014), then null.
 */
export function resolveReportSettings(
  reportStored: StoredReportSettings | null,
  organizationDefault: ReportLayoutDefault | null,
  jobCoverPhotoId: string | null = null,
): ResolvedReportSettings {
  const stored = reportStored?.report_settings;
  const orgDetails = organizationDefault?.details;

  const photosPerPage =
    normalizePhotosPerPage(stored?.photosPerPage) ??
    normalizePhotosPerPage(organizationDefault?.photosPerPage) ??
    DEFAULT_PHOTOS_PER_PAGE;

  // Per-field precedence: report snapshot > Organization default > hardcoded
  // default. A field absent (`undefined`) at one tier falls through, never "off".
  const details = {} as ReportDetailToggles;
  for (const key of DETAIL_KEYS) {
    details[key] = stored?.[key] ?? orgDetails?.[key] ?? ALL_DETAILS_ON[key];
  }

  // Cover config is per-report only (no Organization tier): each block the
  // report leaves unset defaults on.
  const storedCover = reportStored?.cover_config;
  const coverPhotoId = reportStored?.cover_photo_id ?? jobCoverPhotoId ?? null;
  const cover = { coverPhotoId } as ResolvedCoverConfig;
  for (const key of COVER_BLOCK_KEYS) {
    cover[key] = storedCover?.[key] ?? ALL_COVER_BLOCKS_ON[key];
  }

  // Same precedence as every other field, but the hardcoded default is off:
  // the Sketch plan is opt-in (#868). `?? false` also treats a stored null
  // (JSONB) as "unset → off".
  const includeSketchPlan =
    stored?.includeSketchPlan ??
    organizationDefault?.includeSketchPlan ??
    false;

  return { photosPerPage, details, cover, includeSketchPlan };
}

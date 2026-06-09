// src/lib/report-render-model.ts — the shared Photo Report render model (ADR
// 0014, #553).
//
// One pure place that assembles the *complete* input a PDF render needs from a
// report's resolved look. It owns every "should this show?" decision so the
// @react-pdf components stay dumb: they render exactly the fields the model
// hands them, with no toggle logic of their own.
//
// It folds three things together:
//   - structure: delegates page layout to `buildReportDocument` (cover, the
//     conditional Section Title Pages, photo pages bucketed 2/3/4, before/after
//     pair pages), threading the report's photos-per-page and Section-Title-Page
//     toggle through.
//   - the Cover Page: the resolved Cover Page data with hidden blocks removed,
//     plus the resolved cover photo (report's choice → Job's, decided upstream).
//   - each photo slot: its url and tags, and the per-photo detail fields gated
//     by the six toggles — number, captured-by, date captured, location (the
//     Job's property address), and tags.

import {
  buildReportDocument,
  type PhotoSlot,
  type ReportPhotoInput,
  type ReportSectionInput,
} from "./build-report-document";
import type {
  CoverPageData,
  InsuranceBlock,
  LogoVariant,
  PointOfContact,
} from "./cover-page-data";
import type { ResolvedReportSettings } from "./photo-report-settings";

/** A photo tag as the PDF renders it: a colored chip with a name. */
export interface RenderTag {
  name: string;
  color: string;
}

/**
 * A report photo as the render model consumes it: the planner's
 * {@link ReportPhotoInput} plus the resolved image url and its tags. The model
 * threads url and tags onto each slot; the planner ignores both.
 */
export interface RenderPhotoInput extends ReportPhotoInput {
  url: string | null;
  tags: RenderTag[];
}

/**
 * A single photo's slot, fully resolved for rendering. Every detail field is
 * already gated: a field is `null` (or `[]` for tags) precisely when its toggle
 * is off, so the component renders whatever is non-empty without deciding.
 * `caption` carries no toggle — it is content, always shown when present.
 */
export interface RenderSlot {
  photoId: string;
  url: string | null;
  /** The photo's number, or null when the photo-numbers toggle is off. */
  number: number | null;
  caption: string | null;
  /** Captured date, or null when the date-captured toggle is off. */
  dateCaptured: string | null;
  /** Captured-by name, or null when the captured-by toggle is off. */
  capturedBy: string | null;
  /** The Job's property address, or null when the location toggle is off. */
  location: string | null;
  /** The photo's tags, or [] when the tags toggle is off. */
  tags: RenderTag[];
  orientation: "portrait" | "landscape";
}

export type RenderPage =
  | { kind: "cover" }
  | { kind: "sectionDivider"; title: string; description: string | null }
  | {
      kind: "photoPage";
      sectionTitle: string;
      slots: RenderSlot[];
      photosPerPage: 2 | 3 | 4;
    }
  | {
      kind: "beforeAfterPair";
      sectionTitle: string;
      before: RenderSlot;
      after: RenderSlot;
    };

/**
 * The Cover Page, resolved for rendering. Each identifying block is the resolved
 * value when its visibility flag is on, or `null` when hidden — the component
 * renders only the non-null blocks.
 */
export interface RenderCover {
  title: string;
  logo: LogoVariant | null;
  customerName: string | null;
  propertyAddress: string | null;
  pointOfContact: PointOfContact | null;
  insurance: InsuranceBlock | null;
  coverPhotoUrl: string | null;
}

/** The complete, render-ready model for one Photo Report PDF. */
export interface ReportRenderModel {
  title: string;
  cover: RenderCover;
  pages: RenderPage[];
}

export interface BuildReportRenderModelArgs {
  title: string;
  sections: ReportSectionInput[];
  photos: Record<string, RenderPhotoInput>;
  settings: ResolvedReportSettings;
  /** The Cover Page data resolved from the Job + Company Settings. */
  coverData: CoverPageData;
  /** The resolved cover photo url (report's choice → Job's), or null. */
  coverPhotoUrl: string | null;
  /** The Job's property address, threaded onto each slot as `location`. */
  propertyAddress: string | null;
}

function buildSlot(
  slot: PhotoSlot,
  photos: Record<string, RenderPhotoInput>,
  details: ResolvedReportSettings["details"],
  location: string | null,
): RenderSlot {
  const photo = photos[slot.photoId];
  return {
    photoId: slot.photoId,
    url: photo?.url ?? null,
    number: details.photoNumbers ? slot.number : null,
    caption: slot.caption,
    dateCaptured: details.dateCaptured ? slot.takenAt : null,
    capturedBy: details.capturedBy ? slot.takenBy : null,
    location: details.location ? location : null,
    tags: details.photoTags ? (photo?.tags ?? []) : [],
    orientation: slot.orientation,
  };
}

function buildCover(args: BuildReportRenderModelArgs): RenderCover {
  const { coverData, settings, title, coverPhotoUrl } = args;
  const vis = settings.cover;
  return {
    title,
    logo: vis.logo ? coverData.logo : null,
    customerName: vis.customer ? coverData.customerName : null,
    propertyAddress: vis.propertyAddress ? coverData.propertyAddress : null,
    pointOfContact: vis.pointOfContact ? coverData.pointOfContact : null,
    insurance: vis.insurance ? coverData.insurance : null,
    coverPhotoUrl,
  };
}

export function buildReportRenderModel(
  args: BuildReportRenderModelArgs,
): ReportRenderModel {
  const { sections, photos, settings, title } = args;
  // Location is the Job's property address, shown identically on every photo
  // (there is no per-photo GPS). An empty address shows nothing.
  const location = args.propertyAddress?.trim() || null;
  const { details } = settings;

  const documentPages = buildReportDocument({
    sections,
    photos,
    photosPerPage: settings.photosPerPage,
    sectionTitlePages: details.sectionTitlePages,
  });

  const pages: RenderPage[] = documentPages.map((page) => {
    switch (page.kind) {
      case "cover":
        return { kind: "cover" };
      case "sectionDivider":
        return {
          kind: "sectionDivider",
          title: page.title,
          description: page.description,
        };
      case "photoPage":
        return {
          kind: "photoPage",
          sectionTitle: page.sectionTitle,
          photosPerPage: page.photosPerPage,
          slots: page.slots.map((s) => buildSlot(s, photos, details, location)),
        };
      case "beforeAfterPair":
        return {
          kind: "beforeAfterPair",
          sectionTitle: page.sectionTitle,
          before: buildSlot(page.before, photos, details, location),
          after: buildSlot(page.after, photos, details, location),
        };
    }
  });

  return { title, cover: buildCover(args), pages };
}

// Issue #401 — Photo Report Rework, Slice 2b (extends #400, Slice 2a).
//
// The pure "builder brain" for the in-Job Photo Report builder. It has no React
// in it on purpose: the component wraps `photoReportBuilderReducer` in
// `useReducer` and the auto-save effect reads `state.dirty` to decide when to
// persist. Keeping the state transitions here makes them trivially testable
// (dispatch an action, assert the next state) and reusable on the server (the
// create route uses `buildDefaultReportSections` to seed the draft row).
//
// Slice 2a seeded a report with a single default Section and supported editing
// the report title/date and a Section's heading + plain write-up. Slice 2b grows
// the action set to full Section management (add / remove / reorder) and photo
// assignment (assign a photo to a Section, which also covers adding it to the
// report and moving it between Sections; remove a photo from the report) — see
// `photo-report-drag.ts` for the dnd-kit drag-end → action mapping. Photos live
// only inside Sections (no holding pool); a photo lives in at most one Section.

import type { ReportSection } from "./build-initial-sections";

/** Heading the lone starter Section gets until the user renames it. */
const DEFAULT_SECTION_TITLE = "Photos";

/** Heading a freshly added (empty) Section gets until the user renames it. */
const NEW_SECTION_TITLE = "New section";

/**
 * Turn a photo selection into the one default Section a new report starts with
 * ("init from selection"). Always returns exactly one Section so the builder
 * has an invariant section to edit, even if the selection was empty.
 */
export function buildDefaultReportSections(photoIds: string[]): ReportSection[] {
  return [
    { title: DEFAULT_SECTION_TITLE, description: "", photo_ids: [...photoIds] },
  ];
}

/** The fields the builder edits, plus the dirty flag that drives auto-save. */
export interface PhotoReportBuilderState {
  title: string;
  /** Editable report date, a `YYYY-MM-DD` calendar date. */
  reportDate: string;
  sections: ReportSection[];
  /** True once an edit has happened that has not yet been persisted. */
  dirty: boolean;
  /**
   * Monotonic counter bumped on every edit. Auto-save captures the revision it
   * is writing and passes it back via `markSaved`; the dirty flag is only
   * cleared if no newer edit landed while the write was in flight. Without this,
   * an edit made during an in-flight save would be silently dropped (the save
   * of the older value would clear dirty and the newer value would never be
   * persisted).
   */
  revision: number;
}

/** The persisted shape the builder loads from / re-syncs to. */
export interface LoadedPhotoReport {
  title: string;
  report_date: string;
  sections: ReportSection[];
}

export type PhotoReportBuilderAction =
  | { type: "init"; report: LoadedPhotoReport }
  | { type: "setTitle"; title: string }
  | { type: "setReportDate"; reportDate: string }
  | { type: "setSectionHeading"; index: number; heading: string }
  | { type: "setSectionWriteup"; index: number; writeup: string }
  | { type: "addSection" }
  | { type: "removeSection"; index: number }
  | { type: "reorderSection"; from: number; to: number }
  | { type: "assignPhotoToSection"; photoId: string; sectionIndex: number }
  | { type: "removePhotoFromReport"; photoId: string }
  | { type: "markSaved"; revision: number };

/**
 * Seed builder state from a loaded (already-persisted) report row. A freshly
 * loaded report is not dirty — nothing has changed since it came off disk.
 */
export function initBuilderState(
  report: LoadedPhotoReport,
): PhotoReportBuilderState {
  return {
    title: report.title,
    reportDate: report.report_date,
    sections: report.sections,
    dirty: false,
    revision: 0,
  };
}

function isSectionIndex(
  state: PhotoReportBuilderState,
  index: number,
): boolean {
  return index >= 0 && index < state.sections.length;
}

export function photoReportBuilderReducer(
  state: PhotoReportBuilderState,
  action: PhotoReportBuilderAction,
): PhotoReportBuilderState {
  switch (action.type) {
    case "init":
      return initBuilderState(action.report);
    case "setTitle":
      return {
        ...state,
        title: action.title,
        dirty: true,
        revision: state.revision + 1,
      };
    case "setReportDate":
      return {
        ...state,
        reportDate: action.reportDate,
        dirty: true,
        revision: state.revision + 1,
      };
    case "setSectionHeading":
      if (!isSectionIndex(state, action.index)) return state;
      return {
        ...state,
        sections: state.sections.map((section, i) =>
          i === action.index ? { ...section, title: action.heading } : section,
        ),
        dirty: true,
        revision: state.revision + 1,
      };
    case "setSectionWriteup":
      if (!isSectionIndex(state, action.index)) return state;
      return {
        ...state,
        sections: state.sections.map((section, i) =>
          i === action.index
            ? { ...section, description: action.writeup }
            : section,
        ),
        dirty: true,
        revision: state.revision + 1,
      };
    case "addSection":
      return {
        ...state,
        sections: [
          ...state.sections,
          { title: NEW_SECTION_TITLE, description: "", photo_ids: [] },
        ],
        dirty: true,
        revision: state.revision + 1,
      };
    case "removeSection":
      // Removing a Section drops it and the photos it held from the report
      // (photos live only inside Sections — there is no holding pool). The
      // photos still exist on the Job, so they can be re-added later.
      if (!isSectionIndex(state, action.index)) return state;
      return {
        ...state,
        sections: state.sections.filter((_, i) => i !== action.index),
        dirty: true,
        revision: state.revision + 1,
      };
    case "reorderSection": {
      // Move a Section from one position to another, matching dnd-kit's
      // arrayMove: the dragged Section lands at the target index and the others
      // shift to fill the gap.
      const { from, to } = action;
      if (!isSectionIndex(state, from) || !isSectionIndex(state, to)) {
        return state;
      }
      if (from === to) return state;
      const sections = [...state.sections];
      const [moved] = sections.splice(from, 1);
      sections.splice(to, 0, moved);
      return {
        ...state,
        sections,
        dirty: true,
        revision: state.revision + 1,
      };
    }
    case "assignPhotoToSection": {
      // Place a photo into exactly one Section. This single action covers
      // adding a photo to the report (it was nowhere yet) and moving it between
      // Sections (it gets removed from wherever it was first), keeping the
      // invariant that a photo lives in at most one Section.
      if (!isSectionIndex(state, action.sectionIndex)) return state;
      // No-op when the photo already lives only in the target Section: there is
      // nothing to add or move, so leave state untouched (preserve referential
      // identity, don't dirty, don't reorder within the Section).
      const alreadyInTarget =
        state.sections[action.sectionIndex].photo_ids.includes(action.photoId);
      const inAnotherSection = state.sections.some(
        (section, i) =>
          i !== action.sectionIndex &&
          section.photo_ids.includes(action.photoId),
      );
      if (alreadyInTarget && !inAnotherSection) return state;
      const sections = state.sections.map((section, i) => {
        const without = section.photo_ids.filter((id) => id !== action.photoId);
        if (i === action.sectionIndex) {
          return { ...section, photo_ids: [...without, action.photoId] };
        }
        if (without.length === section.photo_ids.length) return section;
        return { ...section, photo_ids: without };
      });
      return {
        ...state,
        sections,
        dirty: true,
        revision: state.revision + 1,
      };
    }
    case "removePhotoFromReport": {
      // Take a photo out of whatever Section holds it (there is at most one).
      // Since photos live only inside Sections, this is the same as removing it
      // from the report. A no-op (photo not present) leaves state untouched so
      // it does not needlessly mark the report dirty.
      let removed = false;
      const sections = state.sections.map((section) => {
        if (!section.photo_ids.includes(action.photoId)) return section;
        removed = true;
        return {
          ...section,
          photo_ids: section.photo_ids.filter((id) => id !== action.photoId),
        };
      });
      if (!removed) return state;
      return {
        ...state,
        sections,
        dirty: true,
        revision: state.revision + 1,
      };
    }
    case "markSaved":
      // Only clear dirty if the write that just landed was for the *current*
      // revision. If an edit happened while the save was in flight, the state
      // is newer than what was persisted, so it stays dirty and auto-save fires
      // again for the newer value.
      if (action.revision !== state.revision) return state;
      return { ...state, dirty: false };
    default:
      return state;
  }
}

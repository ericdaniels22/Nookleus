// Issue #400 — Photo Report Rework, Slice 2a.
//
// The pure "builder brain" for the in-Job Photo Report builder. It has no React
// in it on purpose: the component wraps `photoReportBuilderReducer` in
// `useReducer` and the auto-save effect reads `state.dirty` to decide when to
// persist. Keeping the state transitions here makes them trivially testable
// (dispatch an action, assert the next state) and reusable on the server (the
// create route uses `buildDefaultReportSections` to seed the draft row).
//
// Slice 2a holds a single default Section containing all the selected photos and
// supports editing the report title/date and that section's heading + plain
// write-up. Full multi-Section management and photo assignment are slice 2b, so
// the action set is deliberately small and meant to grow.

import type { ReportSection } from "./build-initial-sections";

/** Heading the lone starter Section gets until the user renames it. */
const DEFAULT_SECTION_TITLE = "Photos";

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

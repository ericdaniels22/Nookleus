"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Eye,
  FileDown,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/jobs/photo-url";
import { generateReportPDF, renderReportPdfBlob } from "@/lib/generate-report-pdf";
import TiptapEditor from "@/components/tiptap-editor";
import ReportSettingsPanel from "@/components/report-settings-panel";
import { PdfPreviewFrame } from "@/components/documents/pdf-preview-frame";
import {
  initBuilderState,
  photoReportBuilderReducer,
  type PhotoReportBuilderState,
} from "@/lib/photo-report-builder";
import { resolvePhotoReportDragEnd } from "@/lib/photo-report-drag";
import { photoReportCollisionDetection } from "@/lib/photo-report-collision";
import { AddPhotosDialog } from "@/components/photo-report-add-photos-dialog";
import { measureWriteupFit, writeupLimitFor } from "@/lib/section-writeup-fit";
import {
  newSectionId,
  type ReportSection,
  type StoredReportSection,
} from "@/lib/build-initial-sections";
import {
  resolveReportSettings,
  type CoverBlockVisibility,
} from "@/lib/photo-report-settings";
import type { Photo, PhotoReport, ReportPhotosPerPage } from "@/lib/types";

// How long to wait after the last edit before persisting (mirrors the
// estimate builder's auto-save debounce).
const DEBOUNCE_MS = 2000;

// Over-limit write-ups are no longer hard-blocked (#550): the per-layout counter
// turning red is the only (soft) warning, so there is no "blocked" save state and
// no over-limit save gate — every edit saves/flushes/generates like any other.
type SaveStatus = "idle" | "saving" | "saved" | "error";

// The five identifying blocks the Cover Page editor can show or hide, in print
// order, paired with their user-facing label (#551). The canonical set and
// order come from ADR 0014 / CONTEXT.md ("logo, customer, property address,
// point of contact, insurance").
const COVER_BLOCKS: { field: keyof CoverBlockVisibility; label: string }[] = [
  { field: "logo", label: "Logo" },
  { field: "customer", label: "Customer" },
  { field: "propertyAddress", label: "Property address" },
  { field: "pointOfContact", label: "Point of contact" },
  { field: "insurance", label: "Insurance" },
];

// The fields a save persists, plus the revision that snapshot belongs to. Built
// in one place so the debounced auto-save and the Generate flush always persist
// exactly the same shape. (issue #441) Since #550 this also carries the report's
// settings snapshot (photos-per-page + the six detail toggles) so layout changes
// auto-save like every other edit.
function snapshotOf(state: PhotoReportBuilderState) {
  return {
    title: state.title,
    reportDate: state.reportDate,
    sections: state.sections,
    reportSettings: { photosPerPage: state.photosPerPage, ...state.details },
    cover: state.cover,
    revision: state.revision,
  };
}

// Split the in-memory resolved cover back into the two persisted columns: the
// five identifying-block flags go to `cover_config`, the chosen photo to
// `cover_photo_id`. Writing both on every save materializes the report's own
// cover snapshot — including the Job-cover fallback the builder seeded — on the
// first edit (ADR 0014 "freeze on first edit", #551).
function coverColumns(cover: PhotoReportBuilderState["cover"]) {
  const { coverPhotoId, ...blocks } = cover;
  return { cover_config: blocks, cover_photo_id: coverPhotoId };
}

interface PhotoReportBuilderProps {
  jobId: string;
  report: PhotoReport;
  /** All of the Job's photos, so any can be added to the report (#401). */
  photos: Photo[];
  supabaseUrl: string;
  /**
   * The Job's own cover photo, used as the fallback when the report has not
   * chosen its own (ADR 0014, #551). Optional and defaults to null so existing
   * call sites and tests that don't supply it still seed an all-on, no-photo
   * cover.
   */
  jobCoverPhotoId?: string | null;
}

export default function PhotoReportBuilder({
  jobId,
  report,
  photos,
  supabaseUrl,
  jobCoverPhotoId = null,
}: PhotoReportBuilderProps) {
  const [state, dispatch] = useReducer(
    photoReportBuilderReducer,
    {
      title: report.title,
      report_date: report.report_date,
      sections: report.sections as StoredReportSection[],
      // The report's own layout snapshot (#550): initBuilderState resolves it to
      // the chosen photos-per-page + detail toggles, falling back to the
      // hardcoded 2-per-page/all-on defaults when a pre-0014 row has none.
      report_settings: report.report_settings,
      // Seed the Cover Page editor with the report's fully-resolved cover: its
      // own snapshot if any, else the Job's cover photo, else all-on/no-photo.
      // The builder then persists whatever is in state, so the first edit
      // freezes this resolved cover into the report's own copy (#551).
      cover: resolveReportSettings(
        {
          report_settings: report.report_settings,
          cover_config: report.cover_config,
          cover_photo_id: report.cover_photo_id,
        },
        null,
        jobCoverPhotoId,
      ).cover,
    },
    initBuilderState,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [generating, setGenerating] = useState(false);
  // Whether the gear's Report Settings panel is open (#550). Purely ephemeral
  // UI state — the settings themselves live in the reducer and auto-save.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The path of the most recently generated PDF, surfaced as a persistent
  // "Open PDF" link the user taps (issue #442). Seeded from the report so a
  // PDF generated in an earlier session is retrievable on load without
  // regenerating.
  const [pdfPath, setPdfPath] = useState<string | null>(report.pdf_path);
  // The on-demand Preview pane (#554): the object URL of the most recently
  // rendered PDF blob while the pane is open, or null when closed. It changes
  // only when the author asks — a Preview/refresh click, never a keystroke — so
  // the pane shows the real report on demand, not a live re-render. See
  // handlePreview.
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  // Which pane the desktop rail has selected for the center editor (#548).
  // `null` means the pinned Cover Page. Purely ephemeral UI state — never in
  // the reducer, never persisted. Resolved against the live sections below so
  // a selection left dangling by a removed Section falls back to the cover.
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );
  const selectedId = state.sections.some((s) => s.id === selectedSectionId)
    ? selectedSectionId
    : null;
  // Which Section the "+ Add Photos" picker is adding into (#552), or null
  // while closed. Like selectedSectionId, purely ephemeral UI state. The dialog
  // mounts only while open, so every open starts with a fresh, empty selection.
  const [pickerSectionIndex, setPickerSectionIndex] = useState<number | null>(
    null,
  );

  // The latest edit revision, mirrored into a ref so the async save tail can
  // tell whether a newer edit landed while it was in flight (its own captured
  // `state` is stale by then). Without this, a slow save resolving after a newer
  // edit would flip the badge from "Saving…" back to "Saved" with stale state.
  const revisionRef = useRef(state.revision);
  // Holds the pending auto-save debounce timer so the Generate flush can cancel
  // it and write immediately, rather than racing the debounce. (issue #441)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const photosById = new Map(photos.map((p) => [p.id, p]));

  // Persist a builder snapshot. Shared by the debounced auto-save and the
  // Generate flush so both write the same way and report status the same way.
  // The snapshot is passed in (not closed over) so this function is stable and
  // always writes exactly what the caller decided to persist. Returns whether
  // the write succeeded, so a caller (Generate) can avoid producing a stale PDF
  // when the flush failed. (issue #441)
  const writeReport = useCallback(
    async (snapshot: ReturnType<typeof snapshotOf>): Promise<boolean> => {
      setSaveStatus("saving");
      const supabase = createClient();
      const { error } = await supabase
        .from("photo_reports")
        .update({
          title: snapshot.title,
          report_date: snapshot.reportDate,
          sections: snapshot.sections,
          report_settings: snapshot.reportSettings,
          ...coverColumns(snapshot.cover),
        })
        .eq("id", report.id);
      if (error) {
        setSaveStatus("error");
        return false;
      }
      dispatch({ type: "markSaved", revision: snapshot.revision });
      // Only claim "Saved" if no newer edit landed while this write was in
      // flight. If one did, its own effect run owns the status, so we must not
      // overwrite it with a stale success.
      if (snapshot.revision === revisionRef.current) {
        setSaveStatus("saved");
      }
      return true;
    },
    [report.id],
  );

  // Auto-save: a debounced write whenever the builder is dirty. The effect
  // captures the state (and its `revision`) as of the last edit and hands that
  // snapshot to `writeReport`, so we persist exactly that snapshot. If the user
  // edits again while this write is in flight, that edit bumps the revision and
  // reschedules its own save; `markSaved` then declines to clear dirty for the
  // older revision, so the newer edit is never lost.
  useEffect(() => {
    revisionRef.current = state.revision;
    if (!state.dirty) return;
    // A write-up that runs over its per-layout budget is no longer held back
    // (#550): it renders on its own full Section Title Page, so mild overflow is
    // tolerable (ADR 0014). The live counter turning red is the only warning;
    // the report saves like any other edit.
    const timer = setTimeout(() => {
      void writeReport(snapshotOf(state));
    }, DEBOUNCE_MS);
    saveTimerRef.current = timer;
    return () => clearTimeout(timer);
    // `state` is a fresh object on every dispatch, so this re-arms the debounce
    // on each edit; `report.id` is covered transitively through `writeReport`.
  }, [state, writeReport]);

  // Flush a pending edit when the page goes away. Two triggers share this one
  // function: an in-app unmount (#443, e.g. tapping "Back to job", easy on a
  // tablet) and a hard page-unload (#479: tab close / refresh / app-background).
  // The debounced auto-save above only persists on a 2s timer and its cleanup
  // merely clears that timer, so leaving within the window would otherwise drop
  // the last edit. The Supabase JS client can't ride a teardown — its fetch is
  // cancelled — so the flush fires a plain `keepalive: true` PUT at the #478
  // route, whose server-side `edit_jobs` + tenancy gating mirrors the debounced
  // write. The ref is rewritten every render so a trigger reads the freshest
  // snapshot, not the stale closure captured at mount.
  const flushOnUnmountRef = useRef<() => void>(() => {});
  flushOnUnmountRef.current = () => {
    if (!state.dirty) return;
    void fetch(`/api/jobs/${jobId}/reports/${report.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: state.title,
        report_date: state.reportDate,
        sections: state.sections,
        report_settings: { photosPerPage: state.photosPerPage, ...state.details },
        ...coverColumns(state.cover),
      }),
      keepalive: true,
    });
  };
  // Empty deps: the cleanup runs only on unmount (#443).
  useEffect(() => () => flushOnUnmountRef.current(), []);

  // Hard page-unload (#479): a real tab close / refresh / app-background tears
  // the page down without running React cleanup, so the unmount flush above
  // never fires. `pagehide` covers tab-close / refresh; `visibilitychange` to
  // "hidden" covers app-backgrounding (the common iOS exit, where pagehide is
  // unreliable). We flush only when the page is actually hidden — a change *to*
  // visible is the user returning, not leaving. The same flush ref is reused, so
  // the dirty guard still applies. Listeners are removed on
  // unmount so a torn-down builder can't keep flushing. iOS can fire both
  // visibilitychange→hidden AND pagehide in one teardown, re-running the flush;
  // the #478 PUT is idempotent and the flush no-ops once clean, so — as in #477
  // — no "already-flushed" guard is needed.
  useEffect(() => {
    const onPageHide = () => flushOnUnmountRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushOnUnmountRef.current();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const action = resolvePhotoReportDragEnd(event);
    if (action) dispatch(action);
  }

  // Photos already placed in a Section vs. the rest of the Job's photos, which
  // sit in the "not in the report" tray and can be dragged into any Section.
  const assignedIds = new Set(state.sections.flatMap((s) => s.photo_ids));
  const availablePhotos = photos.filter((p) => !assignedIds.has(p.id));

  // Both Generate and Preview render from the *persisted* row, but auto-save is
  // debounced — so a just-made edit may not be on disk yet. Flush it first
  // (cancelling the pending debounce) so the output reflects what is on screen.
  // Returns false — with a message already shown — when the flush failed, so the
  // caller bails rather than render a stale row. (issue #441)
  const flushPendingEdits = async (): Promise<boolean> => {
    if (!state.dirty) return true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const saved = await writeReport(snapshotOf(state));
    if (!saved) {
      toast.error("Couldn't save your latest edits — try again.");
      return false;
    }
    return true;
  };

  // Swap the preview to a freshly-rendered blob, or clear it (null). Always
  // revokes the object URL it replaces so the browser frees the stale blob
  // instead of leaking it for the tab's lifetime.
  const swapPreview = (blob: Blob | null) => {
    setPreviewSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blob ? URL.createObjectURL(blob) : null;
    });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      if (!(await flushPendingEdits())) return;
      const generatedPath = await generateReportPDF(report.id);
      setPdfPath(generatedPath);
      toast.success("PDF generated.");
    } catch {
      toast.error("Failed to generate PDF.");
    } finally {
      setGenerating(false);
    }
  };

  // Open (or refresh) the on-demand Preview pane (#554). Renders the report to a
  // PDF blob through the SAME shared producer Generate uses — so the preview is
  // byte-identical to the generated PDF — and feeds it to the in-app viewer as
  // an object URL. Fires only on an explicit click, never on edits.
  const handlePreview = async () => {
    try {
      if (!(await flushPendingEdits())) return;
      const blob = await renderReportPdfBlob(report.id);
      swapPreview(blob);
    } catch {
      toast.error("Failed to render preview.");
    }
  };

  // Dismiss the pane and revoke its object URL — the rendered PDF is freed
  // rather than held until the tab closes.
  const handleClosePreview = () => swapPreview(null);

  return (
    // The builder sits inside the normal AppShell chrome (#548 restored the
    // nav — the route is a BUILDER_ROUTE_PATTERNS entry now), so it flows with
    // the page instead of owning the viewport (the old full-screen h-dvh).
    <div className="bg-background">
      {/* Header bar */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Link
          href={`/jobs/${jobId}`}
          aria-label="Back to job"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          Back to job
        </Link>
        <div className="flex-1" />
        <span
          className={`text-xs text-right ${
            saveStatus === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "error" && "Save failed"}
        </span>
        {/* The gear opens the in-builder Report Settings panel (#550): photos
            per page + the six detail toggles. Preview (#554) renders the real
            report PDF on demand in a slide-over pane. */}
        <button
          type="button"
          aria-label="Report settings"
          onClick={() => setSettingsOpen(true)}
          className="hidden lg:inline-flex items-center rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
        >
          <Settings size={16} />
        </button>
        <button
          type="button"
          onClick={handlePreview}
          className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-1.5 text-sm font-semibold text-foreground hover:border-foreground/40 transition-colors"
        >
          <Eye size={14} />
          Preview
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5EA7] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#234b8a] transition-colors disabled:opacity-60"
        >
          {generating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FileDown size={14} />
          )}
          Generate PDF
        </button>
        {pdfPath && (
          <a
            href={`${supabaseUrl}/storage/v1/object/public/reports/${pdfPath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2B5EA7] px-4 py-1.5 text-sm font-semibold text-[#2B5EA7] hover:bg-[#2B5EA7]/10 transition-colors"
          >
            <FileDown size={14} />
            Open PDF
          </a>
        )}
      </header>

      {/* Body — on desktop (lg+) a multi-pane shell: the left rail beside the
          center editor. Below lg the rail is display-hidden and the original
          single-column phone builder flows unchanged. Both surfaces share one
          DndContext so rail drags and photo drags resolve through the same
          onDragEnd. */}
      <DndContext
        sensors={sensors}
        collisionDetection={photoReportCollisionDetection}
        onDragEnd={handleDragEnd}
      >
        <div className="lg:flex lg:items-start lg:gap-6 lg:px-4 lg:py-6">
          {/* Left rail (#548): Cover Page pinned, then the Sections. */}
          <aside
            data-testid="report-rail"
            className="hidden lg:block w-56 shrink-0 space-y-1"
          >
            <button
              type="button"
              aria-current={selectedId === null ? "true" : undefined}
              onClick={() => setSelectedSectionId(null)}
              className={cn(
                "w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                // Primary-tinted like the Section rows, so selected stays
                // distinguishable from a merely-hovered entry.
                selectedId === null
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted",
              )}
            >
              Cover Page
            </button>
            {/* Rail items are sortable under `rail-`-prefixed ids: they share
                the one DndContext with the center cards (dnd-kit forbids
                duplicate ids), and resolvePhotoReportDragEnd reads only
                data.current, so a rail drag resolves to the same
                reorderSection a center-card drag does. */}
            <SortableContext
              items={state.sections.map((s) => `rail-${s.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {state.sections.map((section, index) => (
                <RailSectionItem
                  key={section.id}
                  section={section}
                  index={index}
                  selected={selectedId === section.id}
                  onSelect={() => setSelectedSectionId(section.id)}
                />
              ))}
            </SortableContext>
            <button
              type="button"
              onClick={() => {
                // Add and jump straight into the new Section: the rail
                // highlight and the center editor both move onto it, so the
                // author can start typing immediately.
                const id = newSectionId();
                dispatch({ type: "addSection", id });
                setSelectedSectionId(id);
              }}
              className="inline-flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              <Plus size={15} />
              New Section
            </button>
          </aside>

          <div className="mx-auto max-w-3xl px-4 py-6 space-y-6 lg:mx-0 lg:flex-1 lg:min-w-0 lg:p-0">
            {/* Report meta — the Cover Page's center pane (#548). On desktop it
                shows only while the pinned Cover Page is selected; below lg the
                class is inert, so the phone builder always renders it. */}
            <div
              data-testid="report-meta"
              className={cn("space-y-3", selectedId !== null && "lg:hidden")}
            >
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Report title
                </span>
                <input
                  type="text"
                  aria-label="Report title"
                  value={state.title}
                  onChange={(e) =>
                    dispatch({ type: "setTitle", title: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="block w-48">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Report date
                </span>
                <input
                  type="date"
                  aria-label="Report date"
                  value={state.reportDate}
                  onChange={(e) => {
                    // Native date inputs can be cleared to "". report_date is a
                    // NOT NULL column, so never persist an empty date — ignore the
                    // change and keep the last valid one.
                    if (e.target.value) {
                      dispatch({
                        type: "setReportDate",
                        reportDate: e.target.value,
                      });
                    }
                  }}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>

              {/* Cover photo — pick one of the Job's photos to print on the
                  cover. Seeded with the report's resolved cover (Job-cover
                  fallback included); the chosen photo persists on the report's
                  own snapshot (#551). */}
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Cover photo
                </span>
                {photos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    This job has no photos to use as a cover.
                  </p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
                    {photos.map((photo) => {
                      const selected = state.cover.coverPhotoId === photo.id;
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          aria-pressed={selected}
                          aria-label={`Use ${
                            photo.caption || "this photo"
                          } as cover photo`}
                          onClick={() =>
                            dispatch({
                              type: "setCoverPhoto",
                              photoId: photo.id,
                            })
                          }
                          className={cn(
                            "aspect-square overflow-hidden rounded-lg ring-2 transition-shadow",
                            selected
                              ? "ring-primary"
                              : "ring-transparent hover:ring-border",
                          )}
                        >
                          <img
                            src={photoUrl(photo, supabaseUrl, "grid")}
                            alt={photo.caption || "Photo"}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Identifying blocks — show/hide each on the cover (#551). All
                  default on; the canonical set is logo, customer, property
                  address, point of contact, insurance (ADR 0014). */}
              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Show on cover
                </span>
                <div className="space-y-1.5">
                  {COVER_BLOCKS.map(({ field, label }) => (
                    <label
                      key={field}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={state.cover[field]}
                        onChange={() =>
                          dispatch({ type: "toggleCoverField", field })
                        }
                        className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/*
              Slice-2b drag wiring. Sections are keyed (React key + dnd-kit
              sortable id) off their stable `id` (#467), so editing a Section then
              reordering it keeps input focus/caret pinned to that Section and the
              reorder animates smoothly. Drop targeting uses
              photoReportCollisionDetection (#584): pointerWithin first, so a
              photo dropped anywhere within a Section card's bounds — including
              near the edge of a very tall card — lands in *that* Section, with
              closestCenter as the keyboard-drag fallback.
            */}
            {/* Sections */}
            <SortableContext
              items={state.sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {state.sections.map((section, index) => (
                  <SortableSection
                    key={section.id}
                    index={index}
                    section={section}
                    photosById={photosById}
                    supabaseUrl={supabaseUrl}
                    dispatch={dispatch}
                    photosPerPage={state.photosPerPage}
                    desktopSelected={selectedId === section.id}
                    onOpenPicker={() => setPickerSectionIndex(index)}
                  />
                ))}
              </div>
            </SortableContext>

            <button
              type="button"
              onClick={() => dispatch({ type: "addSection", id: newSectionId() })}
              // The phone surface's add affordance; on desktop the rail's
              // "+ New Section" covers it (#548), so it hides at lg+.
              className="lg:hidden inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              <Plus size={15} />
              Add section
            </button>

            {/* Photos not yet in the report — drag into a Section to add.
                Phone-only (#552): on desktop the "+ Add Photos" picker replaces
                the always-visible tray. */}
            <PhotoTray photos={availablePhotos} supabaseUrl={supabaseUrl} />
          </div>
        </div>
      </DndContext>

      {settingsOpen && (
        <ReportSettingsPanel
          photosPerPage={state.photosPerPage}
          details={state.details}
          dispatch={dispatch}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {/* On-demand Preview pane (#554): the real report PDF — byte-identical to
          Generate — rendered in the in-app viewer. Option B slide-over: a fixed
          right-anchored panel over a dimmed backdrop, identical at every width,
          overlaying the editor rather than reflowing it. Refresh re-runs the
          shared producer with the latest edits; the pane never re-renders on its
          own; the backdrop or ✕ dismisses it. */}
      {previewSrc && (
        <>
          <div
            data-testid="preview-backdrop"
            aria-hidden="true"
            onClick={handleClosePreview}
            className="fixed inset-0 z-40 bg-foreground/40"
          />
          <div
            role="dialog"
            aria-label="Report preview"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-card shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">
                Preview
              </span>
              <div className="flex-1" />
              <button
                type="button"
                aria-label="Refresh preview"
                onClick={handlePreview}
                className="inline-flex items-center rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                aria-label="Close preview"
                onClick={handleClosePreview}
                className="inline-flex items-center rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <PdfPreviewFrame src={previewSrc} title={state.title} />
            </div>
          </div>
        </>
      )}
      {/* The "+ Add Photos" picker (#552): adds a multi-selection of the Job's
          photos into the Section whose button opened it. */}
      {pickerSectionIndex !== null && (
        <AddPhotosDialog
          open
          onOpenChange={(open) => {
            if (!open) setPickerSectionIndex(null);
          }}
          photos={photos}
          sections={state.sections}
          sectionIndex={pickerSectionIndex}
          supabaseUrl={supabaseUrl}
          onAdd={(photoIds) => {
            dispatch({
              type: "addPhotosToSection",
              photoIds,
              sectionIndex: pickerSectionIndex,
            });
            setPickerSectionIndex(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RailSectionItem — a Section's entry in the desktop rail (#548): click the
// label to select it as the center pane, drag the grip to reorder. Select and
// drag are SEPARATE controls (the same split as the center cards'): dnd-kit's
// KeyboardSensor activates on Enter/Space through the sortable listeners and
// preventDefault()s the keydown, so fusing both onto one button would leave
// keyboard users unable to ever select a Section.
// ─────────────────────────────────────────────────────────────────────────────

function RailSectionItem({
  section,
  index,
  selected,
  onSelect,
}: {
  section: ReportSection;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    // Namespaced so the id can't collide with this Section's center card,
    // which registers under the bare `section.id` in the same DndContext.
    id: `rail-${section.id}`,
    data: { type: "section", index },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex w-full items-center rounded-lg transition-colors",
        // Selected is primary-tinted so it stays distinguishable from a
        // merely-hovered row (hover uses the muted background).
        selected ? "bg-primary/10" : "hover:bg-muted",
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate py-2 pl-3 text-left text-sm",
          selected
            ? "font-medium text-primary"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {section.title || "Untitled section"}
      </button>
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label="Drag to reorder section"
        className="cursor-grab touch-none px-2 py-2 text-muted-foreground/60 hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SortableSection — a draggable/reorderable Section that is also the drop target
// for photos dragged into it.
// ─────────────────────────────────────────────────────────────────────────────

function SortableSection({
  index,
  section,
  photosById,
  supabaseUrl,
  dispatch,
  photosPerPage,
  desktopSelected,
  onOpenPicker,
}: {
  index: number;
  section: ReportSection;
  photosById: Map<string, Photo>;
  supabaseUrl: string;
  dispatch: React.Dispatch<
    Parameters<typeof photoReportBuilderReducer>[1]
  >;
  /**
   * The report's chosen Photo Page density (#550). Sets the write-up character
   * budget the live counter reads — fewer photos per page leaves more room for
   * the intro write-up, so the cap is layout-dependent ({@link writeupLimitFor}).
   */
  photosPerPage: ReportPhotosPerPage;
  /**
   * Whether the desktop rail has this Section selected (#548). The center
   * editor shows one pane at a time, so an unselected card is `lg:hidden` —
   * inert below lg, where the phone builder still renders every Section.
   */
  desktopSelected: boolean;
  /** Open the "+ Add Photos" picker targeting this Section (#552). */
  onOpenPicker: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id, data: { type: "section", index } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function handleRemove() {
    if (
      section.photo_ids.length > 0 &&
      !window.confirm(
        "Delete this section? Its photos will be removed from the report (they stay on the job).",
      )
    ) {
      return;
    }
    dispatch({ type: "removeSection", index });
  }

  // Count only photos that still resolve to a real Photo: an id can dangle if
  // the photo was deleted from the Job after being added to the report, and the
  // grid skips those — so the label must not count them.
  const visibleCount = section.photo_ids.filter((id) =>
    photosById.has(id),
  ).length;

  // The write-up shares the Section Title Page with the layout, so its budget
  // depends on the chosen density (#550): writeupLimitFor maps photos-per-page
  // to the character cap (2→750, 3→400, 4→260). Going over no longer blocks the
  // save — the counter just turns red (ADR 0014).
  const fit = measureWriteupFit(
    section.description,
    writeupLimitFor(photosPerPage),
  );

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border border-border bg-card p-4 space-y-3",
        !desktopSelected && "lg:hidden",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Drag to reorder section"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
        <input
          type="text"
          aria-label="Section heading"
          value={section.title}
          onChange={(e) =>
            dispatch({
              type: "setSectionHeading",
              index,
              heading: e.target.value,
            })
          }
          placeholder="Section heading"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-base font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="button"
          aria-label="Remove section"
          onClick={handleRemove}
          className="text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Rich-text write-up (issue #403): the same TipTap editor used on
          Estimates / Invoices / contracts. Its HTML is stored in the Section's
          `description` and auto-saved like every other edit. */}
      <TiptapEditor
        content={section.description}
        onChange={(html) =>
          dispatch({
            type: "setSectionWriteup",
            index,
            writeup: html,
          })
        }
        placeholder="Write-up — what you found, what you did…"
      />

      {/* Live per-layout fit counter (#404, #550): measureWriteupFit against the
          density-dependent budget (writeupLimitFor). Red past the cap, never blocks. */}
      <p
        data-testid={`writeup-counter-${index}`}
        className={`text-xs ${
          fit.fits ? "text-muted-foreground" : "font-medium text-destructive"
        }`}
      >
        {fit.used} / {fit.limit} characters
        {!fit.fits && ` · ${-fit.remaining} over the limit`}
      </p>

      {/* Photos are sortable within their Section (#552): the items are the
          raw photo_ids (a dangling id still occupies its index, so photoIndex
          stays aligned with the reducer's photo_ids positions). rect strategy:
          this is a wrapping grid, not a vertical list. */}
      <SortableContext items={section.photo_ids} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
          {section.photo_ids.map((photoId, photoIndex) => {
            const photo = photosById.get(photoId);
            if (!photo) return null;
            return (
              <DraggablePhoto
                key={photoId}
                photo={photo}
                sectionIndex={index}
                photoIndex={photoIndex}
                supabaseUrl={supabaseUrl}
                dispatch={dispatch}
              />
            );
          })}
        </div>
      </SortableContext>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {visibleCount} photo{visibleCount === 1 ? "" : "s"}
          {/* The drag-here hint only makes sense where the tray exists (phone);
              on desktop the picker is the add affordance (#552). */}
          <span className="lg:hidden"> — drag photos here to add them</span>
        </p>
        <button
          type="button"
          onClick={onOpenPicker}
          className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
        >
          <Plus size={14} />
          Add Photos
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DraggablePhoto — a photo inside a Section: drag it within its Section to
// reorder (#552), drag it to another Section to move it, or remove it from the
// report. Sortable (so it is also a drop target), unlike the tray's photos —
// its id can't collide with a tray photo's because a photo is never in a
// Section and the tray at once.
// ─────────────────────────────────────────────────────────────────────────────

function DraggablePhoto({
  photo,
  sectionIndex,
  photoIndex,
  supabaseUrl,
  dispatch,
}: {
  photo: Photo;
  sectionIndex: number;
  /** This photo's position in its Section's photo_ids. */
  photoIndex: number;
  supabaseUrl: string;
  dispatch: React.Dispatch<
    Parameters<typeof photoReportBuilderReducer>[1]
  >;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: photo.id,
      data: { type: "photo", photoId: photo.id, sectionIndex, photoIndex },
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative aspect-square overflow-hidden rounded-lg"
    >
      <img
        src={photoUrl(photo, supabaseUrl, "grid")}
        alt={photo.caption || "Photo"}
        className="h-full w-full cursor-grab touch-none object-cover"
        {...attributes}
        {...listeners}
      />
      <button
        type="button"
        aria-label="Remove photo from report"
        onClick={() =>
          dispatch({ type: "removePhotoFromReport", photoId: photo.id })
        }
        className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PhotoTray — the Job's photos that are not yet in the report; drag one into a
// Section to add it. Phone-only (#552): on desktop the "+ Add Photos" picker is
// the add affordance, so the tray hides at lg+.
// ─────────────────────────────────────────────────────────────────────────────

function PhotoTray({
  photos,
  supabaseUrl,
}: {
  photos: Photo[];
  supabaseUrl: string;
}) {
  return (
    <div className="lg:hidden rounded-xl border border-border bg-muted/30 p-4">
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">
        Photos not in the report
      </h2>
      {photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Every photo on this job is already in the report.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
          {photos.map((photo) => (
            <TrayPhoto key={photo.id} photo={photo} supabaseUrl={supabaseUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrayPhoto({
  photo,
  supabaseUrl,
}: {
  photo: Photo;
  supabaseUrl: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: photo.id, data: { type: "photo", photoId: photo.id } });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="aspect-square overflow-hidden rounded-lg"
    >
      <img
        src={photoUrl(photo, supabaseUrl, "grid")}
        alt={photo.caption || "Photo"}
        className="h-full w-full cursor-grab touch-none object-cover"
        {...attributes}
        {...listeners}
      />
    </div>
  );
}

"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  FileDown,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase";
import { photoUrl } from "@/lib/jobs/photo-url";
import { generateReportPDF } from "@/lib/generate-report-pdf";
import TiptapEditor from "@/components/tiptap-editor";
import {
  initBuilderState,
  photoReportBuilderReducer,
} from "@/lib/photo-report-builder";
import { resolvePhotoReportDragEnd } from "@/lib/photo-report-drag";
import { measureWriteupFit } from "@/lib/section-writeup-fit";
import type { ReportSection } from "@/lib/build-initial-sections";
import type { Photo, PhotoReport } from "@/lib/types";

// How long to wait after the last edit before persisting (mirrors the
// estimate builder's auto-save debounce).
const DEBOUNCE_MS = 2000;

type SaveStatus = "idle" | "saving" | "saved" | "error" | "blocked";

interface PhotoReportBuilderProps {
  jobId: string;
  report: PhotoReport;
  /** All of the Job's photos, so any can be added to the report (#401). */
  photos: Photo[];
  supabaseUrl: string;
}

export default function PhotoReportBuilder({
  jobId,
  report,
  photos,
  supabaseUrl,
}: PhotoReportBuilderProps) {
  const [state, dispatch] = useReducer(
    photoReportBuilderReducer,
    {
      title: report.title,
      report_date: report.report_date,
      sections: report.sections as ReportSection[],
    },
    initBuilderState,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [generating, setGenerating] = useState(false);
  // The path of the most recently generated PDF, surfaced as a persistent
  // "Open PDF" link the user taps (issue #442). Seeded from the report so a
  // PDF generated in an earlier session is retrievable on load without
  // regenerating.
  const [pdfPath, setPdfPath] = useState<string | null>(report.pdf_path);

  // The latest edit revision, mirrored into a ref so the async save tail can
  // tell whether a newer edit landed while it was in flight (its own captured
  // `state` is stale by then). Without this, a slow valid save resolving after a
  // newer over-limit edit would flip the badge from "blocked" back to "Saved".
  const revisionRef = useRef(state.revision);

  const photosById = new Map(photos.map((p) => [p.id, p]));

  // Auto-save: a debounced write whenever the builder is dirty. The closure
  // captures the state (and its `revision`) as of the last edit, so we persist
  // exactly that snapshot and tell `markSaved` which revision it was. If the
  // user edits again while this write is in flight, that edit bumps the
  // revision and reschedules its own save; `markSaved` then declines to clear
  // dirty for the older revision, so the newer edit is never lost.
  useEffect(() => {
    revisionRef.current = state.revision;
    if (!state.dirty) return;
    const savedRevision = state.revision;
    // Save-time guard (issue #404): a write-up that overflows its one-page
    // intro must not be persisted. The whole report write is held back while any
    // Section is over the limit — the same measureWriteupFit the live counter
    // uses — so the report stays dirty and saves itself once trimmed back under.
    const overLimit = state.sections.some(
      (s) => !measureWriteupFit(s.description).fits,
    );
    const timer = setTimeout(async () => {
      if (overLimit) {
        setSaveStatus("blocked");
        return;
      }
      setSaveStatus("saving");
      const supabase = createClient();
      const { error } = await supabase
        .from("photo_reports")
        .update({
          title: state.title,
          report_date: state.reportDate,
          sections: state.sections,
        })
        .eq("id", report.id);
      if (error) {
        setSaveStatus("error");
        return;
      }
      dispatch({ type: "markSaved", revision: savedRevision });
      // Only claim "Saved" if no newer edit landed while this write was in
      // flight. If one did, its own effect run owns the status (e.g. it may have
      // set "blocked"), so we must not overwrite it with a stale success.
      if (savedRevision === revisionRef.current) {
        setSaveStatus("saved");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    state.dirty,
    state.title,
    state.reportDate,
    state.sections,
    state.revision,
    report.id,
  ]);

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

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const generatedPath = await generateReportPDF(report.id);
      setPdfPath(generatedPath);
      toast.success("PDF generated.");
    } catch {
      toast.error("Failed to generate PDF.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
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
            saveStatus === "blocked" || saveStatus === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "error" && "Save failed"}
          {saveStatus === "blocked" && "Can't save — write-up too long"}
        </span>
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
          {/* Report meta */}
          <div className="space-y-3">
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
          </div>

          {/*
            Slice-2b drag wiring. Two known low-severity follow-ups, left for a
            later slice (no data impact here, controlled inputs keep displayed
            values correct):
              - Sections are addressed by array index (React key + sortable id),
                because ReportSection has no stable id. A stable per-section id
                would smooth dnd reorder animations and keep input focus/caret
                pinned to a section across a reorder; it also touches the
                persisted sections shape, so it is deferred.
              - closestCenter targets the nearest section *center*; on very tall
                section cards a photo dropped near an edge can land in the
                neighbouring section. A pointer-based strategy would be more
                precise.
          */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {/* Sections */}
            <SortableContext
              items={state.sections.map((_, i) => `section-${i}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {state.sections.map((section, index) => (
                  <SortableSection
                    key={index}
                    index={index}
                    section={section}
                    photosById={photosById}
                    supabaseUrl={supabaseUrl}
                    dispatch={dispatch}
                  />
                ))}
              </div>
            </SortableContext>

            <button
              type="button"
              onClick={() => dispatch({ type: "addSection" })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              <Plus size={15} />
              Add section
            </button>

            {/* Photos not yet in the report — drag into a Section to add. */}
            <PhotoTray photos={availablePhotos} supabaseUrl={supabaseUrl} />
          </DndContext>
        </div>
      </div>
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
}: {
  index: number;
  section: ReportSection;
  photosById: Map<string, Photo>;
  supabaseUrl: string;
  dispatch: React.Dispatch<
    Parameters<typeof photoReportBuilderReducer>[1]
  >;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `section-${index}`, data: { type: "section", index } });

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

  // The write-up is capped to one PDF intro page (ADR 0009). measureWriteupFit
  // is the single source of truth shared with the save-time guard.
  const fit = measureWriteupFit(section.description);

  return (
    <section
      ref={setNodeRef}
      style={style}
      className="rounded-xl border border-border bg-card p-4 space-y-3"
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

      {/* Live one-page fit counter (issue #404), driven by measureWriteupFit. */}
      <p
        data-testid={`writeup-counter-${index}`}
        className={`text-xs ${
          fit.fits ? "text-muted-foreground" : "font-medium text-destructive"
        }`}
      >
        {fit.used} / {fit.limit} characters
        {!fit.fits && ` · ${-fit.remaining} over the limit`}
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {section.photo_ids.map((photoId) => {
          const photo = photosById.get(photoId);
          if (!photo) return null;
          return (
            <DraggablePhoto
              key={photoId}
              photo={photo}
              sectionIndex={index}
              supabaseUrl={supabaseUrl}
              dispatch={dispatch}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {visibleCount} photo{visibleCount === 1 ? "" : "s"} — drag photos here to
        add them
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DraggablePhoto — a photo inside a Section: drag it to another Section, or
// remove it from the report.
// ─────────────────────────────────────────────────────────────────────────────

function DraggablePhoto({
  photo,
  sectionIndex,
  supabaseUrl,
  dispatch,
}: {
  photo: Photo;
  sectionIndex: number;
  supabaseUrl: string;
  dispatch: React.Dispatch<
    Parameters<typeof photoReportBuilderReducer>[1]
  >;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: photo.id,
      data: { type: "photo", photoId: photo.id, sectionIndex },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
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
// Section to add it.
// ─────────────────────────────────────────────────────────────────────────────

function PhotoTray({
  photos,
  supabaseUrl,
}: {
  photos: Photo[];
  supabaseUrl: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
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

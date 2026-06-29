"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, GripVertical, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { photoUrl } from "@/lib/jobs/photo-url";
import {
  initShowcaseBuilderState,
  showcaseBuilderReducer,
  type ShowcaseBuilderState,
} from "@/lib/showcase-builder";
import type { Photo, Showcase } from "@/lib/types";

// How long to wait after the last edit before persisting (mirrors the Photo
// Report builder's auto-save debounce).
const DEBOUNCE_MS = 2000;

type SaveStatus = "idle" | "saving" | "saved" | "error";

// The fields a save persists, plus the revision that snapshot belongs to. Built
// in one place so the debounced auto-save and the unmount flush always persist
// exactly the same shape, in the snake_case the PUT route (and DB) expect.
function snapshotOf(state: ShowcaseBuilderState) {
  return {
    body: {
      title: state.title,
      write_up: state.writeUp,
      photo_ids: state.photoIds,
    },
    revision: state.revision,
  };
}

interface ShowcaseBuilderProps {
  jobId: string;
  showcase: Showcase;
  /** All of the Job's photos, so any can be added to the Showcase gallery. */
  photos: Photo[];
  supabaseUrl: string;
}

export default function ShowcaseBuilder({
  jobId,
  showcase,
  photos,
  supabaseUrl,
}: ShowcaseBuilderProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(showcaseBuilderReducer, showcase, () =>
    initShowcaseBuilderState(showcase),
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [deleting, setDeleting] = useState(false);

  // The latest edit revision, mirrored into a ref so an async save tail can tell
  // whether a newer edit landed while it was in flight (its captured `state` is
  // stale by then). Without this, a slow save resolving after a newer edit would
  // flip the badge from "Saving…" back to "Saved" with stale state.
  const revisionRef = useRef(state.revision);
  // Holds the pending auto-save debounce timer so a teardown flush can cancel it.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const photosById = new Map(photos.map((p) => [p.id, p]));
  // The chosen gallery in order, skipping any id that no longer resolves to a
  // real Photo (a photo deleted from the Job after being added drops out).
  const galleryPhotos = state.photoIds
    .map((id) => photosById.get(id))
    .filter((p): p is Photo => Boolean(p));
  // The Job's remaining photos — the "Add photos" pool. A photo is in exactly
  // one of the two grids at a time.
  const chosen = new Set(state.photoIds);
  const availablePhotos = photos.filter((p) => !chosen.has(p.id));

  // Persist a builder snapshot through the admin-gated PUT route (never a direct
  // client write) so the server re-runs the photo-ownership gate on every save —
  // a Showcase gallery must never hold another Job's photo, even if the client
  // is wrong. Shared by the debounced auto-save and the teardown flush so both
  // write the same shape. Returns whether the write succeeded.
  const writeShowcase = useCallback(
    async (snapshot: ReturnType<typeof snapshotOf>): Promise<boolean> => {
      setSaveStatus("saving");
      try {
        const res = await fetch(
          `/api/jobs/${jobId}/showcases/${showcase.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(snapshot.body),
          },
        );
        if (!res.ok) {
          setSaveStatus("error");
          return false;
        }
      } catch {
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
    [jobId, showcase.id],
  );

  // Auto-save: a debounced write whenever the builder is dirty. The effect
  // captures the state (and its `revision`) as of the last edit and hands that
  // snapshot to `writeShowcase`, so we persist exactly that snapshot. If the user
  // edits again while this write is in flight, that edit bumps the revision and
  // reschedules its own save; `markSaved` then declines to clear dirty for the
  // older revision, so the newer edit is never lost.
  useEffect(() => {
    revisionRef.current = state.revision;
    if (!state.dirty) return;
    const timer = setTimeout(() => {
      void writeShowcase(snapshotOf(state));
    }, DEBOUNCE_MS);
    saveTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [state, writeShowcase]);

  // Flush a pending edit when the page goes away. The debounced auto-save only
  // persists on a 2s timer and its cleanup merely clears that timer, so leaving
  // within the window would otherwise drop the last edit. A fetch can't ride a
  // React unmount or a hard page-unload — its request is cancelled — so the flush
  // fires a `keepalive: true` PUT, which the browser is allowed to complete after
  // teardown.
  const flushOnUnmountRef = useRef<() => void>(() => {});
  // Refresh the flush closure after every render (writing a ref during render is
  // disallowed) so any teardown trigger reads the freshest snapshot, not the
  // stale closure captured at mount.
  useEffect(() => {
    flushOnUnmountRef.current = () => {
      if (!state.dirty) return;
      void fetch(`/api/jobs/${jobId}/showcases/${showcase.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshotOf(state).body),
        keepalive: true,
      });
    };
  });
  // Empty deps: the cleanup runs only on unmount.
  useEffect(() => () => flushOnUnmountRef.current(), []);

  // Hard page-unload: a real tab close / refresh / app-background tears the page
  // down without running React cleanup, so the unmount flush above never fires.
  // `pagehide` covers tab-close / refresh; `visibilitychange` to "hidden" covers
  // app-backgrounding (the common iOS exit, where pagehide is unreliable). The
  // PUT is idempotent and the flush no-ops once clean, so firing on both is safe.
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
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = state.photoIds.indexOf(String(active.id));
    const to = state.photoIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    dispatch({ type: "reorderPhoto", from, to });
  }

  // Delete & start over (#613): soft-delete this Showcase into the recoverable
  // trash, freeing the Job's one-live-per-Job slot, then leave the builder — the
  // draft it was editing no longer exists in the live set. We flush nothing: the
  // row is being trashed, so a pending edit is moot.
  const handleDelete = async () => {
    if (
      !window.confirm(
        "Delete this showcase? It moves to the trash and the job can start a new one. You can restore it later.",
      )
    ) {
      return;
    }
    setDeleting(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/showcases/${showcase.id}/delete`,
        { method: "POST" },
      );
      if (!res.ok) {
        toast.error("Couldn't delete the showcase — try again.");
        setDeleting(false);
        return;
      }
      toast.success("Showcase moved to the trash.");
      router.push(`/jobs/${jobId}`);
    } catch {
      toast.error("Couldn't delete the showcase — try again.");
      setDeleting(false);
    }
  };

  return (
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
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-1.5 text-sm font-semibold text-muted-foreground hover:border-destructive/50 hover:text-destructive transition-colors disabled:opacity-60"
        >
          {deleting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
          Delete
        </button>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Title + write-up — the Showcase's story, typed by hand (#613). */}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Showcase title
          </span>
          <input
            type="text"
            aria-label="Showcase title"
            value={state.title}
            onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })}
            placeholder="e.g. Full kitchen remodel in Maplewood"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Write-up
          </span>
          <textarea
            aria-label="Showcase write-up"
            value={state.writeUp}
            onChange={(e) =>
              dispatch({ type: "setWriteUp", writeUp: e.target.value })
            }
            rows={6}
            placeholder="Tell the story of this job — what the customer needed, what you did, how it turned out."
            className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {/* The chosen gallery, in order. Drag a tile to reorder; the order is
              the order the Showcase reads. */}
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Gallery
              {galleryPhotos.length > 0 && (
                <span className="ml-1 font-normal">
                  · {galleryPhotos.length} photo
                  {galleryPhotos.length === 1 ? "" : "s"} · drag to reorder
                </span>
              )}
            </span>
            {galleryPhotos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                No photos chosen yet. Pick from the job&apos;s photos below.
              </p>
            ) : (
              <SortableContext
                items={state.photoIds}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {galleryPhotos.map((photo) => (
                    <GalleryPhoto
                      key={photo.id}
                      photo={photo}
                      supabaseUrl={supabaseUrl}
                      onRemove={() =>
                        dispatch({ type: "removePhoto", photoId: photo.id })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            )}
          </div>
        </DndContext>

        {/* The Job's remaining photos — click one to add it to the gallery. */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            Add from this job&apos;s photos
          </h2>
          {photos.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This job has no photos yet.
            </p>
          ) : availablePhotos.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every photo on this job is already in the showcase.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
              {availablePhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  aria-label={`Add ${photo.caption || "photo"} to the showcase`}
                  onClick={() => dispatch({ type: "addPhoto", photoId: photo.id })}
                  className="group relative aspect-square overflow-hidden rounded-lg ring-2 ring-transparent hover:ring-primary transition-shadow"
                >
                  <img
                    src={photoUrl(photo, supabaseUrl, "grid")}
                    alt={photo.caption || "Photo"}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/35 transition-colors">
                    <Plus
                      size={20}
                      className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GalleryPhoto — a chosen photo in the ordered gallery: drag the tile to reorder
// (#613), or remove it from the Showcase. Sortable so it is also its own drop
// target; the whole tile is the drag handle (a small grip badge hints at it),
// with a separate remove button that does not start a drag.
// ─────────────────────────────────────────────────────────────────────────────

function GalleryPhoto({
  photo,
  supabaseUrl,
  onRemove,
}: {
  photo: Photo;
  supabaseUrl: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id });

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
      <span
        aria-hidden="true"
        className="absolute left-1 top-1 rounded bg-black/45 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical size={12} />
      </span>
      <button
        type="button"
        aria-label="Remove photo from showcase"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <X size={12} />
      </button>
    </div>
  );
}

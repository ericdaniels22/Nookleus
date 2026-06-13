"use client";

// Issue #552 — Photo Report builder: the "+ Add Photos" picker.
//
// The desktop replacement for the always-visible drag tray: a modal listing ALL
// of the Job's photos, from which the author multi-selects to drop into the
// Section they are editing. A photo already in that Section is unselectable (it
// is already exactly where the picker would put it); a photo used in ANOTHER
// Section is selectable but marked with that Section's name — adding it moves
// it here (the one-Section invariant: a photo lives in at most one Section, so
// `addPhotosToSection` dedupes by removing it from wherever else it lived).
//
// Selection is kept as an ordered array, not a Set: the reducer appends in
// selection order, so the order the author picks in is the order the photos
// land in (and the order the PDF numbers them).
//
// Each tile has two affordances (spec: docs/superpowers/specs/
// 2026-06-10-add-photos-dialog-viewer-design.md): a top-right checkbox that
// toggles selection, and the photo body, which opens the fullscreen
// PickerPhotoViewer (a NESTED Base UI dialog — see that file's header).

import { useRef, useState } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/jobs/photo-url";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PickerPhotoViewer } from "@/components/photo-report-picker-viewer";
import type { ReportSection } from "@/lib/build-initial-sections";
import type { Photo, PhotoTag } from "@/lib/types";

/**
 * A Photo as the builder page fetches it for the picker: the Photos-tab join
 * shape, carrying the photo's tag assignment ids for client-side filtering
 * (the `Photo` type does not carry assignments).
 */
export type PickerPhoto = Photo & {
  photo_tag_assignments?: { tag_id: string }[];
};

// One calendar day of photos, in grid order. Keyed/labelled exactly like the
// Photos tab (job-photos-tab.tsx): key "yyyy-MM-dd", header "EEEE, MMMM do,
// yyyy". Local to the dialog — promote to @/lib/jobs/ only if a third
// consumer appears.
interface PhotoGroup {
  date: string;
  label: string;
  photos: Photo[];
}

function groupByDay(photos: Photo[]): PhotoGroup[] {
  return photos.reduce<PhotoGroup[]>((groups, photo) => {
    // Days are the date TAKEN; created_at covers rows from before taken_at
    // became always-populated (#622).
    const takenDate = new Date(photo.taken_at ?? photo.created_at);
    const dateKey = format(takenDate, "yyyy-MM-dd");
    const existing = groups.find((g) => g.date === dateKey);
    if (existing) {
      existing.photos.push(photo);
    } else {
      groups.push({
        date: dateKey,
        label: format(takenDate, "EEEE, MMMM do, yyyy"),
        photos: [photo],
      });
    }
    return groups;
  }, []);
}

export interface AddPhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All of the Job's photos, in the Job's order (newest first). */
  photos: PickerPhoto[];
  /** The report's live Sections, for marking photos already used. */
  sections: ReportSection[];
  /** The Section the picker adds into. */
  sectionIndex: number;
  supabaseUrl: string;
  /** The Organization's tag vocabulary; empty hides the Tags dropdown. */
  tags?: PhotoTag[];
  /** Hand the selection (in pick order) back to the builder to dispatch. */
  onAdd: (photoIds: string[]) => void;
}

export function AddPhotosDialog({
  open,
  onOpenChange,
  photos,
  sections,
  sectionIndex,
  supabaseUrl,
  tags = [],
  onAdd,
}: AddPhotosDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  // Any-of tag filter + sort toggle (spec §1). Filters never clear the
  // selection: a selected photo hidden by a filter stays in `selected` (a
  // cart being filled across filter views) and "Add N photos" still adds it.
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  // Index into the visible flat list of the photo open fullscreen; null = grid.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Initial/return focus target. Base UI's default — the first tabbable
  // element — is the Tags filter button, whose focus alone pops the CSS
  // focus-within dropdown open over the grid (and steals the first click),
  // both on dialog open and again when the fullscreen viewer closes.
  const gridRef = useRef<HTMLDivElement | null>(null);

  const target = sections[sectionIndex];
  const targetTitle = target?.title || "Untitled section";
  const inTarget = new Set(target?.photo_ids ?? []);
  // photoId → the title of the OTHER Section currently holding it.
  const usedElsewhere = new Map<string, string>();
  sections.forEach((section, i) => {
    if (i === sectionIndex) return;
    for (const id of section.photo_ids) {
      usedElsewhere.set(id, section.title || "Untitled section");
    }
  });

  function toggle(photoId: string) {
    setSelected((prev) =>
      prev.includes(photoId)
        ? prev.filter((id) => id !== photoId)
        : [...prev, photoId],
    );
  }

  // A day-check acts like clicking each of the day's unselected photos left
  // to right: append in grid order, preserving everyone's existing pick
  // numbers (ordered-selection semantics). Unchecking removes the day's
  // selectable photos wherever they sit in the pick order.
  function toggleGroup(groupPhotos: Photo[]) {
    const selectable = groupPhotos.filter((p) => !inTarget.has(p.id));
    const allSelected =
      selectable.length > 0 && selectable.every((p) => selected.includes(p.id));
    if (allSelected) {
      const dayIds = new Set(selectable.map((p) => p.id));
      setSelected((prev) => prev.filter((id) => !dayIds.has(id)));
    } else {
      setSelected((prev) => [
        ...prev,
        ...selectable.map((p) => p.id).filter((id) => !prev.includes(id)),
      ]);
    }
  }

  // The flat list the grid and the viewer both show: any-of tag filter, then
  // sort. Newest first is the order the page already supplies; oldest is its
  // mirror (reverses both group order and photo order within each day).
  const filtered =
    selectedTags.length === 0
      ? photos
      : photos.filter((photo) => {
          const tagIds = (photo.photo_tag_assignments ?? []).map(
            (a) => a.tag_id,
          );
          return selectedTags.some((t) => tagIds.includes(t));
        });
  const visiblePhotos = sortNewestFirst ? filtered : [...filtered].reverse();
  const viewerPhoto = viewerIndex !== null ? visiblePhotos[viewerIndex] : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape layering: while the viewer is open, any close request aimed
        // at the picker (an Escape falling through the dialog stack, an
        // outside press) closes the viewer instead — the first Escape can
        // never close the dialog. A second Escape (or ✕ / Cancel) then can.
        if (!next && viewerIndex !== null) {
          setViewerIndex(null);
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-4xl" initialFocus={gridRef}>
        <DialogHeader>
          <DialogTitle>Add photos</DialogTitle>
          <DialogDescription>
            Select photos to add to “{targetTitle}”. A photo used in another
            section moves here.
          </DialogDescription>
        </DialogHeader>

        {photos.length > 0 && (
          <div className="flex items-center gap-2">
            {tags.length > 0 && (
              <div className="group relative">
                <button
                  type="button"
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                >
                  Tags {selectedTags.length > 0 && `(${selectedTags.length})`} ▾
                </button>
                <div className="absolute left-0 top-full z-50 mt-1 hidden min-w-[200px] rounded-lg border border-border bg-card p-2 shadow-lg group-focus-within:block hover:block">
                  {tags.map((tag) => (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(tag.id)}
                        onChange={() =>
                          setSelectedTags((prev) =>
                            prev.includes(tag.id)
                              ? prev.filter((t) => t !== tag.id)
                              : [...prev, tag.id],
                          )
                        }
                        className="rounded"
                      />
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSortNewestFirst((v) => !v)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
            >
              {sortNewestFirst ? "Newest first" : "Oldest first"}
            </button>
          </div>
        )}

        <div
          ref={gridRef}
          tabIndex={-1}
          data-testid="picker-grid"
          className="max-h-[55vh] space-y-4 overflow-y-auto outline-none"
        >
          {visiblePhotos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {photos.length === 0
                ? "No photos on this job yet."
                : "No photos match the selected tags."}
            </p>
          ) : (
            groupByDay(visiblePhotos).map((group) => {
              const selectable = group.photos.filter(
                (p) => !inTarget.has(p.id),
              );
              const allSelected =
                selectable.length > 0 &&
                selectable.every((p) => selected.includes(p.id));
              return (
                <section key={group.date} data-testid={`picker-group-${group.date}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">
                      {group.label}
                    </h3>
                    <input
                      type="checkbox"
                      aria-label={`Select all photos from ${group.label}`}
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      onChange={() => toggleGroup(group.photos)}
                      className="rounded disabled:opacity-40"
                    />
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                    {group.photos.map((photo) => {
                      const isInTarget = inTarget.has(photo.id);
                      const elsewhere = usedElsewhere.get(photo.id);
                      const isSelected = selected.includes(photo.id);
                      return (
                        <div
                          key={photo.id}
                          data-testid={`picker-photo-${photo.id}`}
                          className={cn(
                            "group relative aspect-square overflow-hidden rounded-lg",
                            isSelected && "ring-2 ring-primary",
                            isInTarget && "opacity-50",
                          )}
                        >
                          <button
                            type="button"
                            aria-label="View photo"
                            onClick={() =>
                              setViewerIndex(
                                visiblePhotos.findIndex(
                                  (p) => p.id === photo.id,
                                ),
                              )
                            }
                            className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <img
                              src={photoUrl(photo, supabaseUrl, "grid")}
                              alt={photo.caption || "Photo"}
                              className="h-full w-full object-cover"
                            />
                          </button>
                          {!isInTarget && (
                            <button
                              type="button"
                              data-testid={`picker-select-${photo.id}`}
                              aria-pressed={isSelected}
                              aria-label={
                                isSelected ? "Deselect photo" : "Select photo"
                              }
                              onClick={() => toggle(photo.id)}
                              className={cn(
                                "absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "border-2 border-white/80 bg-black/30",
                              )}
                            >
                              {isSelected
                                ? selected.indexOf(photo.id) + 1
                                : null}
                            </button>
                          )}
                          {/* Used-elsewhere marking: which Section holds it now. */}
                          {isInTarget ? (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                              In this section
                            </span>
                          ) : elsewhere ? (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                              In {elsewhere}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => onAdd(selected)}
            className="gap-1.5"
          >
            <Plus size={14} />
            Add {selected.length} photo{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>

        {viewerIndex !== null && viewerPhoto && (
          <PickerPhotoViewer
            photos={visiblePhotos}
            index={viewerIndex}
            onIndexChange={setViewerIndex}
            supabaseUrl={supabaseUrl}
            selectedNumber={
              selected.includes(viewerPhoto.id)
                ? selected.indexOf(viewerPhoto.id) + 1
                : null
            }
            status={
              inTarget.has(viewerPhoto.id)
                ? "in-target"
                : usedElsewhere.has(viewerPhoto.id)
                  ? "elsewhere"
                  : "free"
            }
            elsewhereTitle={usedElsewhere.get(viewerPhoto.id)}
            onToggleSelect={toggle}
            onClose={() => setViewerIndex(null)}
            finalFocus={gridRef}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

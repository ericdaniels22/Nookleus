"use client";

// Issue #552 — Photo Report builder: the "+ Add Photos" picker.
//
// The desktop replacement for the always-visible drag tray: a modal listing ALL
// of the Job's photos, from which the author multi-selects to drop into the
// Section they are editing. A photo already in that Section is disabled (it is
// already exactly where the picker would put it); a photo used in ANOTHER
// Section is selectable but marked with that Section's name — adding it moves
// it here (the one-Section invariant: a photo lives in at most one Section, so
// `addPhotosToSection` dedupes by removing it from wherever else it lived).
//
// Selection is kept as an ordered array, not a Set: the reducer appends in
// selection order, so the order the author picks in is the order the photos
// land in (and the order the PDF numbers them).

import { useState } from "react";
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
import type { ReportSection } from "@/lib/build-initial-sections";
import type { Photo } from "@/lib/types";

export interface AddPhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All of the Job's photos, in the Job's order. */
  photos: Photo[];
  /** The report's live Sections, for marking photos already used. */
  sections: ReportSection[];
  /** The Section the picker adds into. */
  sectionIndex: number;
  supabaseUrl: string;
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
  onAdd,
}: AddPhotosDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add photos</DialogTitle>
          <DialogDescription>
            Select photos to add to “{targetTitle}”. A photo used in another
            section moves here.
          </DialogDescription>
        </DialogHeader>

        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No photos on this job yet.
          </p>
        ) : (
          <div className="grid max-h-[55vh] grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 overflow-y-auto">
            {photos.map((photo) => {
              const isInTarget = inTarget.has(photo.id);
              const elsewhere = usedElsewhere.get(photo.id);
              const isSelected = selected.includes(photo.id);
              return (
                <button
                  key={photo.id}
                  type="button"
                  data-testid={`picker-photo-${photo.id}`}
                  disabled={isInTarget}
                  aria-pressed={isSelected}
                  onClick={() => toggle(photo.id)}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isSelected && "ring-2 ring-primary",
                    isInTarget && "cursor-default opacity-50",
                  )}
                >
                  <img
                    src={photoUrl(photo, supabaseUrl, "grid")}
                    alt={photo.caption || "Photo"}
                    className="h-full w-full object-cover"
                  />
                  {isSelected && (
                    <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {selected.indexOf(photo.id) + 1}
                    </span>
                  )}
                  {/* Used-elsewhere marking: which Section holds it now. */}
                  {isInTarget ? (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                      In this section
                    </span>
                  ) : elsewhere ? (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                      In {elsewhere}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

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
      </DialogContent>
    </Dialog>
  );
}

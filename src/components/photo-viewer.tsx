"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Photo, PhotoTag } from "@/lib/types";
import { photoUrl } from "@/lib/jobs/photo-url";
import {
  orderPhotosForViewer,
  nextPhotoIndex,
  prevPhotoIndex,
  hasNext,
  hasPrev,
  indexAfterDelete,
} from "@/lib/jobs/photo-viewer-navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Save,
  Loader2,
  Check,
  Tag,
  Download,
  Trash2,
  Pencil,
  RotateCcw,
  X,
  MoreHorizontal,
  Star,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// How long the deleted Photo lingers — hidden but recoverable — before the
// permanent hard delete commits (#515). Matches the Undo toast's lifetime.
const UNDO_WINDOW_MS = 5000;

export default function PhotoViewer({
  open,
  onOpenChange,
  photos,
  initialPhotoIndex,
  allTags,
  supabaseUrl,
  coverPhotoId,
  onUpdated,
  onAnnotate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: Photo[];
  initialPhotoIndex: number;
  allTags: PhotoTag[];
  supabaseUrl: string;
  coverPhotoId: string | null;
  onUpdated: () => void;
  onAnnotate: (photo: Photo, url: string) => void;
}) {
  // Navigation runs over the Job's Photos newest-first and continuous across
  // the grid's date dividers (#515) — the dividers are display context, not
  // navigation stops. `removedIds` hides a Photo the instant its delete is
  // confirmed while the real delete waits out the Undo window, so the viewer
  // advances immediately and Undo can bring it straight back.
  const ordered = useMemo(() => orderPhotosForViewer(photos), [photos]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visiblePhotos = useMemo(
    () => ordered.filter((p) => !removedIds.has(p.id)),
    [ordered, removedIds],
  );

  const initialId = photos[initialPhotoIndex]?.id ?? null;
  const [currentIndex, setCurrentIndex] = useState(0);
  // Seed the position when the viewer opens on a Photo. Keyed on the opened
  // Photo (not the `photos` array) so a background refetch doesn't yank the
  // user back to where they started.
  useEffect(() => {
    if (!open) return;
    setRemovedIds(new Set());
    const idx = ordered.findIndex((p) => p.id === initialId);
    setCurrentIndex(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialId]);

  const safeIndex = Math.min(currentIndex, visiblePhotos.length - 1);
  const currentPhoto = visiblePhotos[safeIndex];
  const isCover = !!currentPhoto && currentPhoto.id === coverPhotoId;

  const goNext = () =>
    setCurrentIndex(nextPhotoIndex(safeIndex, visiblePhotos.length));
  const goPrev = () => setCurrentIndex(prevPhotoIndex(safeIndex));

  // Deletes still inside their Undo window, keyed by Photo id. Each holds the
  // pending commit timer and the Photo, so a commit (on window-elapse) or an
  // undo (clear timer) can run without re-deriving it from the list.
  const pendingDeletes = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; photo: Photo }>
  >(new Map());

  // On unmount, commit any deletes still in their Undo window so a confirmed
  // delete isn't silently lost when the user leaves the Job.
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      pending.forEach(({ timer, photo }) => {
        clearTimeout(timer);
        const supabase = createClient();
        void supabase.storage.from("photos").remove([photo.storage_path]);
        void supabase.from("photos").delete().eq("id", photo.id);
      });
      pending.clear();
    };
  }, []);

  // Touch swipe: a horizontal drag past the threshold steps between Photos —
  // left for the next (older), right for the previous (newer).
  const SWIPE_THRESHOLD = 50;
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (dx <= -SWIPE_THRESHOLD) goNext();
    else if (dx >= SWIPE_THRESHOLD) goPrev();
  };

  const [caption, setCaption] = useState("");
  const [beforeAfterRole, setBeforeAfterRole] = useState<
    "before" | "after" | null
  >(null);
  const [assignedTagIds, setAssignedTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [hasOriginalBackup, setHasOriginalBackup] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingCover, setSettingCover] = useState(false);

  async function fetchTags(photoId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("photo_tag_assignments")
      .select("tag_id")
      .eq("photo_id", photoId);
    if (data) {
      setAssignedTagIds(data.map((d: { tag_id: string }) => d.tag_id));
    }
  }

  // The viewer can restore the un-annotated/un-cropped original when either a
  // crop `-original` backup exists in storage or the Photo carries annotations.
  async function checkOriginalBackup(p: Photo) {
    const supabase = createClient();
    const backupPath = p.storage_path.replace(/\.[^.]+$/, "-original$&");
    const { data: backupData } = await supabase.storage.from("photos").list(
      backupPath.substring(0, backupPath.lastIndexOf("/")),
      { search: backupPath.substring(backupPath.lastIndexOf("/") + 1) },
    );
    const hasCropBackup =
      !!backupData && backupData.some((f) => backupPath.endsWith(f.name));
    setHasOriginalBackup(hasCropBackup || !!p.annotated_path);
  }

  // Seed the editable fields from the opened Photo (re-seed if it changes).
  useEffect(() => {
    if (currentPhoto) {
      setCaption(currentPhoto.caption || "");
      setBeforeAfterRole(currentPhoto.before_after_role);
      setConfirmDelete(false);
      fetchTags(currentPhoto.id);
      checkOriginalBackup(currentPhoto);
    }
  }, [currentPhoto?.id]);

  async function handleRestoreOriginal() {
    if (!currentPhoto) return;
    setRestoring(true);
    const supabase = createClient();

    try {
      // Restore the crop backup if one exists.
      const backupPath = currentPhoto.storage_path.replace(
        /\.[^.]+$/,
        "-original$&",
      );
      const { data: backupData } = await supabase.storage.from("photos").list(
        backupPath.substring(0, backupPath.lastIndexOf("/")),
        { search: backupPath.substring(backupPath.lastIndexOf("/") + 1) },
      );
      const hasCropBackup =
        !!backupData && backupData.some((f) => backupPath.endsWith(f.name));

      if (hasCropBackup) {
        const { data: backupBlob } = await supabase.storage
          .from("photos")
          .download(backupPath);
        if (backupBlob) {
          await supabase.storage
            .from("photos")
            .upload(currentPhoto.storage_path, backupBlob, {
              upsert: true,
              contentType: backupBlob.type,
            });
          await supabase.storage.from("photos").remove([backupPath]);
        }
      }

      // Drop the annotated render if one exists.
      if (currentPhoto.annotated_path) {
        await supabase.storage.from("photos").remove([currentPhoto.annotated_path]);
        await supabase
          .from("photos")
          .update({ annotated_path: null })
          .eq("id", currentPhoto.id);
      }

      // Drop the annotation records.
      await supabase
        .from("photo_annotations")
        .delete()
        .eq("photo_id", currentPhoto.id);

      toast.success("Photo restored to original.");
      setHasOriginalBackup(false);
      onOpenChange(false);
      onUpdated();
    } catch (err) {
      console.error("Failed to restore original:", err);
      toast.error("Failed to restore original photo.");
    }
    setRestoring(false);
  }

  // Escape closes the viewer (mirrors the Annotator's window keydown pattern).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Arrow keys move between Photos, mirroring the on-screen arrows. Kept apart
  // from the Escape handler so its deps track the current position; the step
  // logic is inlined so the listener never closes over a stale index.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        setCurrentIndex(nextPhotoIndex(safeIndex, visiblePhotos.length));
      } else if (e.key === "ArrowLeft") {
        setCurrentIndex(prevPhotoIndex(safeIndex));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, safeIndex, visiblePhotos.length]);

  function toggleTag(tagId: string) {
    setAssignedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
    );
  }

  async function handleSave() {
    if (!currentPhoto) return;
    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("photos")
      .update({
        caption: caption || null,
        before_after_role: beforeAfterRole,
      })
      .eq("id", currentPhoto.id);

    if (error) {
      toast.error("Failed to update photo.");
      setSaving(false);
      return;
    }

    // Sync tags: delete all existing, re-insert current (modal parity).
    await supabase
      .from("photo_tag_assignments")
      .delete()
      .eq("photo_id", currentPhoto.id);

    if (assignedTagIds.length > 0) {
      const orgId = await getActiveOrganizationId(supabase);
      await supabase.from("photo_tag_assignments").insert(
        assignedTagIds.map((tagId) => ({
          organization_id: orgId,
          photo_id: currentPhoto.id,
          tag_id: tagId,
        })),
      );
    }

    toast.success("Photo updated.");
    setSaving(false);
    onUpdated();
  }

  // Download the original-quality image. Reuses the grid's download route
  // (signed URL of the clean original — storage_path, never the annotated copy).
  async function handleDownload() {
    if (!currentPhoto) return;
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/jobs/${currentPhoto.job_id}/photos/download`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: [currentPhoto.id] }),
        },
      );
      const { urls } = (await res.json()) as {
        urls: { url: string; filename: string }[];
      };
      const first = urls[0];
      if (first) {
        const a = document.createElement("a");
        a.href = first.url;
        a.download = first.filename;
        a.click();
      }
    } catch {
      toast.error("Failed to download photo.");
    }
    setDownloading(false);
  }

  // Promote the current Photo to the Job's cover. Uses the existing direct
  // write the grid's star uses (jobs.cover_photo_id), keyed off this Photo's
  // job_id so the viewer stays self-contained.
  async function handleSetCover() {
    if (!currentPhoto) return;
    setSettingCover(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ cover_photo_id: currentPhoto.id })
      .eq("id", currentPhoto.job_id);
    setSettingCover(false);
    setMoreOpen(false);
    if (error) {
      toast.error("Failed to set cover photo.");
      return;
    }
    toast.success("Cover photo updated.");
    onUpdated();
  }

  // Delete is deferred behind an Undo window (#515). Confirming hides the Photo
  // and advances to the next (or closes on the last) immediately, then shows an
  // Undo toast; the permanent hard delete — storage object + photos row, which
  // cascades tag assignments + annotations — commits only once the window
  // elapses. Because there is no recycle bin, deferral is what makes the delete
  // recoverable: Undo cancels the pending commit before it ever runs.
  function commitDelete(photo: Photo) {
    pendingDeletes.current.delete(photo.id);
    void (async () => {
      const supabase = createClient();
      await supabase.storage.from("photos").remove([photo.storage_path]);
      const { error } = await supabase
        .from("photos")
        .delete()
        .eq("id", photo.id);
      if (error) {
        // The delete didn't take — surface the Photo again.
        toast.error("Failed to delete photo.");
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.delete(photo.id);
          return next;
        });
        return;
      }
      onUpdated();
    })();
  }

  function undoDelete(photo: Photo) {
    const pending = pendingDeletes.current.get(photo.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingDeletes.current.delete(photo.id);
    }
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(photo.id);
      return next;
    });
  }

  function handleConfirmDelete() {
    if (!currentPhoto) return;
    const photo = currentPhoto;
    const outcome = indexAfterDelete(safeIndex, visiblePhotos.length);

    setConfirmDelete(false);
    setMoreOpen(false);
    setRemovedIds((prev) => new Set(prev).add(photo.id));
    if (outcome.close) onOpenChange(false);
    else setCurrentIndex(outcome.index);

    const timer = setTimeout(() => commitDelete(photo), UNDO_WINDOW_MS);
    pendingDeletes.current.set(photo.id, { timer, photo });

    toast("Photo deleted", {
      action: { label: "Undo", onClick: () => undoDelete(photo) },
      duration: UNDO_WINDOW_MS,
    });
  }

  if (!open || !currentPhoto) return null;

  const displayUrl = photoUrl(currentPhoto, supabaseUrl, "full");
  const toolbarBtn =
    "inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/50 text-white transition-colors";

  return (
    <div className="fixed inset-0 z-[90] flex bg-black">
      {/* Photo, centered + letterboxed on black, with the action toolbar over it */}
      <div
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={displayUrl}
          alt={currentPhoto.caption || "Photo"}
          className="max-w-full max-h-full object-contain"
        />

        {/* Prev / next — newest-first, continuous across the grid's date
            dividers, clamped at the ends (#515). */}
        {hasPrev(safeIndex) && (
          <button
            type="button"
            aria-label="Previous photo"
            title="Previous photo"
            onClick={goPrev}
            className={cn(
              toolbarBtn,
              "absolute left-3 top-1/2 -translate-y-1/2 hover:bg-black/70",
            )}
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {hasNext(safeIndex, visiblePhotos.length) && (
          <button
            type="button"
            aria-label="Next photo"
            title="Next photo"
            onClick={goNext}
            className={cn(
              toolbarBtn,
              "absolute right-3 top-1/2 -translate-y-1/2 hover:bg-black/70",
            )}
          >
            <ChevronRight size={22} />
          </button>
        )}

        {/* Close back to the Job */}
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={() => onOpenChange(false)}
          className={cn(toolbarBtn, "absolute top-3 left-3 hover:bg-black/70")}
        >
          <X size={18} />
        </button>

        {/* Cover badge — mirrors the grid's gold "Cover" pill so the viewer
            indicates when the current Photo is the Job's cover. */}
        {isCover && (
          <div
            className="absolute top-3 left-14 flex items-center gap-1 h-9 px-2.5 rounded-full bg-[#F5A623] text-white text-xs font-semibold"
            title="Current cover photo"
          >
            <Star size={13} fill="currentColor" />
            Cover
          </div>
        )}

        {/* Toolbar over the photo */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <button
            type="button"
            aria-label="Edit"
            title="Edit"
            onClick={() =>
              onAnnotate(currentPhoto, photoUrl(currentPhoto, supabaseUrl, "full"))
            }
            className={cn(toolbarBtn, "hover:bg-black/70")}
          >
            <Pencil size={18} />
          </button>
          <button
            type="button"
            aria-label="Download"
            title="Download"
            onClick={handleDownload}
            disabled={downloading}
            className={cn(toolbarBtn, "hover:bg-black/70 disabled:opacity-50")}
          >
            {downloading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Download size={18} />
            )}
          </button>
          <button
            type="button"
            aria-label="Delete"
            title="Delete"
            onClick={() => {
              setConfirmDelete(true);
              setMoreOpen(false);
            }}
            className={cn(toolbarBtn, "hover:bg-[#C41E2A]")}
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            aria-label="More"
            title="More"
            onClick={() => {
              setMoreOpen((o) => !o);
              setConfirmDelete(false);
            }}
            className={cn(toolbarBtn, "hover:bg-black/70")}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {/* ⋯ More menu — scaffolding for the less-frequent actions. Set as
            cover lives here; later slices add Share, Save to device, Duplicate. */}
        {moreOpen && (
          <div className="absolute top-14 right-3 bg-white rounded-lg shadow-lg p-1.5 min-w-[180px] flex flex-col">
            <button
              type="button"
              onClick={handleSetCover}
              disabled={settingCover || isCover}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[#1A1A1A] hover:bg-gray-100 rounded-md transition-colors disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {settingCover ? (
                <Loader2 size={14} className="animate-spin" />
              ) : isCover ? (
                <Check size={14} className="text-[#085041]" />
              ) : (
                <Star size={14} />
              )}
              {isCover ? "Cover photo" : "Set as cover"}
            </button>
          </div>
        )}

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="absolute top-14 right-3 bg-white rounded-lg shadow-lg p-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="text-sm text-white bg-[#C41E2A] hover:bg-[#A3171F] px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-sm text-[#666666] hover:text-[#1A1A1A]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Always-visible side panel (desktop) carries the modal's fields */}
      <aside className="w-[340px] shrink-0 bg-white border-l border-gray-200 overflow-y-auto p-4 space-y-4">
        {/* Caption */}
        <div>
          <label
            htmlFor="photo-viewer-caption"
            className="block text-sm font-medium text-[#666666] mb-1.5"
          >
            Caption
          </label>
          <Input
            id="photo-viewer-caption"
            aria-label="Caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Describe this photo..."
          />
        </div>

        {/* Before / After */}
        <div>
          <label className="block text-sm font-medium text-[#666666] mb-1.5">
            Before / After
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setBeforeAfterRole(beforeAfterRole === "before" ? null : "before")
              }
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                beforeAfterRole === "before"
                  ? "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/20"
                  : "bg-white text-[#666666] border-gray-200",
              )}
            >
              Before
            </button>
            <button
              type="button"
              onClick={() =>
                setBeforeAfterRole(beforeAfterRole === "after" ? null : "after")
              }
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                beforeAfterRole === "after"
                  ? "bg-[#E1F5EE] text-[#085041] border-[#085041]/20"
                  : "bg-white text-[#666666] border-gray-200",
              )}
            >
              After
            </button>
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-[#666666] mb-1.5">
            <Tag size={14} className="inline mr-1 -mt-0.5" />
            Tags
          </label>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => {
              const selected = assignedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1",
                    selected
                      ? "text-white border-transparent"
                      : "bg-white text-[#666666] border-gray-200 hover:border-gray-300",
                  )}
                  style={
                    selected
                      ? { backgroundColor: tag.color, borderColor: tag.color }
                      : undefined
                  }
                >
                  {selected && <Check size={10} />}
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Read-only metadata */}
        <div className="text-xs text-[#999999] space-y-1 pt-2 border-t border-gray-100">
          <p>
            Uploaded:{" "}
            {format(new Date(currentPhoto.created_at), "MMM d, yyyy 'at' h:mm a")}
          </p>
          <p>By: {currentPhoto.taken_by}</p>
          {currentPhoto.file_size && (
            <p>Size: {(currentPhoto.file_size / 1024 / 1024).toFixed(1)} MB</p>
          )}
        </div>

        {/* Restore original (only when an annotation or crop backup exists) */}
        {hasOriginalBackup && (
          <div>
            <button
              type="button"
              onClick={handleRestoreOriginal}
              disabled={restoring}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#791F1F] hover:text-[#C41E2A] transition-colors disabled:opacity-50"
            >
              {restoring ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              Restore Original Photo
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center rounded-lg text-sm font-medium px-4 py-2 bg-[#C41E2A] hover:bg-[#A3171F] text-white transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin mr-1" />
            ) : (
              <Save size={14} className="mr-1" />
            )}
            Save Changes
          </button>
        </div>
      </aside>
    </div>
  );
}

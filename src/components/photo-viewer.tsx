"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Photo, PhotoTag } from "@/lib/types";
import { photoUrl } from "@/lib/jobs/photo-url";
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
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function PhotoViewer({
  open,
  onOpenChange,
  photos,
  initialPhotoIndex,
  allTags,
  supabaseUrl,
  onUpdated,
  onAnnotate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: Photo[];
  initialPhotoIndex: number;
  allTags: PhotoTag[];
  supabaseUrl: string;
  onUpdated: () => void;
  onAnnotate: (photo: Photo, url: string) => void;
}) {
  const currentPhoto = photos[initialPhotoIndex];

  const [caption, setCaption] = useState("");
  const [beforeAfterRole, setBeforeAfterRole] = useState<
    "before" | "after" | null
  >(null);
  const [assignedTagIds, setAssignedTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [hasOriginalBackup, setHasOriginalBackup] = useState(false);

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

  // Permanent hard delete: remove the storage object and the photos row (which
  // cascades tag assignments + annotations), then close the viewer (1A — no
  // advance-to-next, no recycle bin). Gated behind the confirm step.
  async function handleDelete() {
    if (!currentPhoto) return;
    setDeleting(true);
    const supabase = createClient();

    await supabase.storage.from("photos").remove([currentPhoto.storage_path]);

    const { error } = await supabase
      .from("photos")
      .delete()
      .eq("id", currentPhoto.id);

    if (error) {
      toast.error("Failed to delete photo.");
    } else {
      toast.success("Photo deleted.");
      onOpenChange(false);
      onUpdated();
    }
    setDeleting(false);
  }

  if (!open || !currentPhoto) return null;

  const displayUrl = photoUrl(currentPhoto, supabaseUrl, "full");
  const toolbarBtn =
    "inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/50 text-white transition-colors";

  return (
    <div className="fixed inset-0 z-[90] flex bg-black">
      {/* Photo, centered + letterboxed on black, with the action toolbar over it */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <img
          src={displayUrl}
          alt={currentPhoto.caption || "Photo"}
          className="max-w-full max-h-full object-contain"
        />

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
            onClick={() => setConfirmDelete(true)}
            className={cn(toolbarBtn, "hover:bg-[#C41E2A]")}
          >
            <Trash2 size={18} />
          </button>
        </div>

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="absolute top-14 right-3 bg-white rounded-lg shadow-lg p-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-white bg-[#C41E2A] hover:bg-[#A3171F] px-3 py-1 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {deleting && <Loader2 size={12} className="animate-spin" />}
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

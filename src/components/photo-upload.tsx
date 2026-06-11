"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { readTakenAt } from "@/lib/mobile/exif-read";
import { PhotoTag } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Upload, X, Loader2, ImageIcon, Check } from "lucide-react";
import { toast } from "sonner";

interface FilePreview {
  file: File;
  preview: string;
  caption: string;
  tags: string[];
  beforeAfterRole: "before" | "after" | null;
}

export default function PhotoUploadModal({
  open,
  onOpenChange,
  jobId,
  tags,
  onPhotosAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  tags: PhotoTag[];
  onPhotosAdded: () => void;
}) {
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(newFiles: FileList | File[]) {
    const fileArray = Array.from(newFiles).filter((f) =>
      f.type.startsWith("image/") || f.type.startsWith("video/")
    );

    if (fileArray.length === 0) {
      toast.error("Please select image or video files.");
      return;
    }

    const previews: FilePreview[] = fileArray.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      caption: "",
      tags: [],
      beforeAfterRole: null,
    }));

    setFiles((prev) => [...prev, ...previews]);
  }

  function removeFile(index: number) {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  function updateFile(index: number, updates: Partial<FilePreview>) {
    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    );
  }

  function toggleTag(fileIndex: number, tagId: string) {
    setFiles((prev) =>
      prev.map((f, i) => {
        if (i !== fileIndex) return f;
        const has = f.tags.includes(tagId);
        return {
          ...f,
          tags: has ? f.tags.filter((t) => t !== tagId) : [...f.tags, tagId],
        };
      })
    );
  }

  function toggleBeforeAfter(fileIndex: number, role: "before" | "after") {
    setFiles((prev) =>
      prev.map((f, i) => {
        if (i !== fileIndex) return f;
        return {
          ...f,
          beforeAfterRole: f.beforeAfterRole === role ? null : role,
        };
      })
    );
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, []);

  async function handleUpload() {
    if (files.length === 0) return;

    setUploading(true);
    const supabase = createClient();
    const orgId = await getActiveOrganizationId(supabase);
    let successCount = 0;

    // Fetch current user and their profile once (before the loop)
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", user!.id)
      .maybeSingle();

    for (const filePreview of files) {
      const ext = filePreview.file.name.split(".").pop()?.toLowerCase() || "jpg";
      // Path: {org_id}/{job_id}/{timestamp}-rand.ext — the org_id prefix
      // matches the post-18a rename layout (scripts/migrate-storage-paths.ts).
      const fileName = `${orgId}/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      // Upload to Supabase Storage
      const { error: storageError } = await supabase.storage
        .from("photos")
        .upload(fileName, filePreview.file);

      if (storageError) {
        console.error("Storage upload error:", storageError);
        toast.error(`Failed to upload ${filePreview.file.name}`);
        continue;
      }

      // Insert photo record
      const mediaType = filePreview.file.type.startsWith("video/")
        ? "video"
        : "photo";

      // Camera-roll uploads carry the capture date in EXIF (#622); without
      // one, lastModified is the best estimate the browser gives us. Videos
      // skip EXIF — exifr can't read their containers, and buffering a whole
      // video to find out is a memory hazard.
      const exifDate =
        mediaType === "photo" ? await readTakenAt(filePreview.file) : null;
      const takenAt =
        exifDate ??
        (filePreview.file.lastModified > 0
          ? new Date(filePreview.file.lastModified)
          : new Date());

      const { data: photoData, error: insertError } = await supabase
        .from("photos")
        .insert({
          organization_id: orgId,
          job_id: jobId,
          storage_path: fileName,
          uploaded_from: "web",
          caption: filePreview.caption || null,
          taken_at: takenAt.toISOString(),
          taken_by: profile?.full_name || user!.email || "unknown",
          media_type: mediaType,
          file_size: filePreview.file.size,
          before_after_role: filePreview.beforeAfterRole,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Photo insert error:", insertError);
        toast.error(`Failed to save ${filePreview.file.name}`);
        continue;
      }

      // Insert tag assignments
      if (filePreview.tags.length > 0 && photoData) {
        const tagAssignments = filePreview.tags.map((tagId) => ({
          organization_id: orgId,
          photo_id: photoData.id,
          tag_id: tagId,
        }));

        await supabase.from("photo_tag_assignments").insert(tagAssignments);
      }

      successCount++;
    }

    if (successCount > 0) {
      toast.success(
        `${successCount} photo${successCount !== 1 ? "s" : ""} uploaded.`
      );
      // Clean up previews
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setFiles([]);
      onOpenChange(false);
      onPhotosAdded();
    }

    setUploading(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Photos</DialogTitle>
        </DialogHeader>

        {/* Drop zone */}
        {files.length === 0 ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors",
              dragOver
                ? "border-[#2B5EA7] bg-[#E6F1FB]"
                : "border-gray-300 hover:border-gray-400 bg-gray-50"
            )}
          >
            <Upload
              size={40}
              className={cn(
                "mx-auto mb-3",
                dragOver ? "text-[#2B5EA7]" : "text-[#CCCCCC]"
              )}
            />
            <p className="text-sm font-medium text-[#666666]">
              Drag & drop photos here
            </p>
            <p className="text-xs text-[#999999] mt-1">
              or click to browse files
            </p>
          </div>
        ) : (
          <>
            {/* File previews */}
            <div className="space-y-4">
              {files.map((fp, index) => (
                <div
                  key={index}
                  className="bg-gray-50 rounded-xl border border-gray-200 p-3"
                >
                  <div className="flex gap-3">
                    {/* Thumbnail */}
                    <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
                      <img
                        src={fp.preview}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-[#1A1A1A] truncate">
                          {fp.file.name}
                        </p>
                        <button
                          onClick={() => removeFile(index)}
                          className="text-[#999999] hover:text-[#C41E2A] flex-shrink-0"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <p className="text-xs text-[#999999] mb-2">
                        {(fp.file.size / 1024 / 1024).toFixed(1)} MB
                      </p>

                      {/* Caption */}
                      <Input
                        value={fp.caption}
                        onChange={(e) =>
                          updateFile(index, { caption: e.target.value })
                        }
                        placeholder="Add a caption..."
                        className="text-sm h-8 mb-2"
                      />

                      {/* Before/After toggle */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-[#999999]">Type:</span>
                        <button
                          type="button"
                          onClick={() => toggleBeforeAfter(index, "before")}
                          className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium border transition-all",
                            fp.beforeAfterRole === "before"
                              ? "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/20"
                              : "bg-white text-[#666666] border-gray-200"
                          )}
                        >
                          Before
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleBeforeAfter(index, "after")}
                          className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium border transition-all",
                            fp.beforeAfterRole === "after"
                              ? "bg-[#E1F5EE] text-[#085041] border-[#085041]/20"
                              : "bg-white text-[#666666] border-gray-200"
                          )}
                        >
                          After
                        </button>
                      </div>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1">
                        {tags.map((tag) => {
                          const selected = fp.tags.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleTag(index, tag.id)}
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all flex items-center gap-0.5",
                                selected
                                  ? "text-white border-transparent"
                                  : "bg-white text-[#666666] border-gray-200"
                              )}
                              style={
                                selected
                                  ? {
                                      backgroundColor: tag.color,
                                      borderColor: tag.color,
                                    }
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
                  </div>
                </div>
              ))}
            </div>

            {/* Add more + Upload */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-[#2B5EA7] hover:underline"
              >
                + Add more photos
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="inline-flex items-center justify-center rounded-lg text-sm font-medium px-6 py-2.5 bg-[#C41E2A] hover:bg-[#A3171F] text-white transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload size={16} className="mr-2" />
                )}
                Upload {files.length} Photo{files.length !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

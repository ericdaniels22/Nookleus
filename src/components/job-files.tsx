"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { JobFile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Paperclip,
  Download,
  Pencil,
  Trash2,
  MoreVertical,
  Loader2,
  File as FileIcon,
  FileText,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import JobFilePreview from "@/components/job-file-preview";
import { uploadJobFiles } from "@/lib/jobs/upload-job-files";

interface UploadingFile {
  id: string;
  filename: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function iconForMime(mime: string) {
  if (mime === "application/pdf") return FileText;
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  )
    return FileSpreadsheet;
  if (mime.startsWith("text/") || mime.includes("document")) return FileText;
  return FileIcon;
}

export default function JobFiles({ jobId }: { jobId: string }) {
  const [files, setFiles] = useState<JobFile[]>([]);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [previewFile, setPreviewFile] = useState<JobFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/files`);
    if (!res.ok) return;
    const data = await res.json();
    setFiles(data);
  }, [jobId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList);
      if (arr.length === 0) return;

      const placeholders: UploadingFile[] = arr.map((f) => ({
        id: `${Date.now()}-${Math.random()}-${f.name}`,
        filename: f.name,
      }));
      setUploading((prev) => [...prev, ...placeholders]);

      try {
        // Direct-to-storage signed-URL upload — large photo reports no longer
        // stream through the 4.5 MB-capped serverless function.
        const { succeeded, failed } = await uploadJobFiles(jobId, arr);

        if (succeeded.length) {
          toast.success(
            succeeded.length === 1
              ? "File uploaded"
              : `${succeeded.length} files uploaded`
          );
        }
        // Surface the actual per-file reason (e.g. "File is too large to
        // upload.") instead of a bare filename list or a cryptic parse error.
        if (failed.length === 1) {
          toast.error(`${failed[0].filename}: ${failed[0].error}`);
        } else if (failed.length > 1) {
          toast.error(
            `Failed to upload ${failed.length} files: ${failed
              .map((f) => f.filename)
              .join(", ")}`
          );
        }

        await fetchFiles();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((prev) =>
          prev.filter((u) => !placeholders.some((p) => p.id === u.id))
        );
      }
    },
    [jobId, fetchFiles]
  );

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      uploadFiles(e.target.files);
      e.target.value = "";
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  async function handleRowClick(file: JobFile) {
    if (file.mime_type === "application/pdf") {
      setPreviewFile(file);
    } else {
      await downloadFile(file);
    }
  }

  async function downloadFile(file: JobFile) {
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${file.id}/url`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const a = document.createElement("a");
      a.href = data.url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  function startRename(file: JobFile) {
    setRenamingId(file.id);
    setRenameValue(file.filename);
  }

  async function saveRename(file: JobFile) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === file.filename) {
      setRenamingId(null);
      return;
    }
    setRenamingId(null);
    // Optimistic
    setFiles((prev) =>
      prev.map((f) => (f.id === file.id ? { ...f, filename: trimmed } : f))
    );
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Rename failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed");
      // Revert
      await fetchFiles();
    }
  }

  async function confirmDelete(file: JobFile) {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${file.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      toast.success("File deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">
          <Paperclip size={16} className="inline mr-2 -mt-0.5" />
          Files ({files.length})
        </h3>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + Upload Files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-lg transition-colors",
          dragOver && "bg-primary/5"
        )}
      >
        {dragOver && (
          <div className="absolute inset-0 border-2 border-dashed border-primary rounded-lg flex items-center justify-center bg-primary/5 pointer-events-none z-10">
            <p className="text-sm font-medium text-primary">
              Drop files to upload
            </p>
          </div>
        )}

        {files.length === 0 && uploading.length === 0 ? (
          <div className="text-center py-8">
            <Paperclip
              size={40}
              className="mx-auto text-muted-foreground/40 mb-2"
            />
            <p className="text-sm text-muted-foreground/60">No files yet.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">
              Drop files here or click Upload Files above.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {uploading.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 py-2.5 px-2 text-sm"
              >
                <Loader2
                  size={18}
                  className="animate-spin text-muted-foreground flex-shrink-0"
                />
                <span className="flex-1 truncate text-muted-foreground">
                  {u.filename}
                </span>
                <span className="text-xs text-muted-foreground">
                  Uploading…
                </span>
              </li>
            ))}
            {files.map((file) => {
              const Icon = iconForMime(file.mime_type);
              const isRenaming = renamingId === file.id;
              return (
                <li
                  key={file.id}
                  className="group flex items-center gap-3 py-2.5 px-2 text-sm hover:bg-accent/50 rounded transition-colors"
                >
                  <Icon
                    size={18}
                    className="text-muted-foreground flex-shrink-0"
                  />
                  {isRenaming ? (
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(file)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(file);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-7 flex-1"
                    />
                  ) : (
                    <button
                      onClick={() => handleRowClick(file)}
                      className="flex-1 min-w-0 text-left truncate hover:underline"
                    >
                      {file.filename}
                    </button>
                  )}
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatSize(file.size_bytes)} ·{" "}
                    {format(new Date(file.created_at), "MMM d, yyyy")}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex items-center justify-center rounded-md h-7 w-7 p-0 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
                    >
                      <MoreVertical size={14} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => downloadFile(file)}>
                        <Download size={14} className="mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => startRename(file)}>
                        <Pencil size={14} className="mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeleteTarget(file)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 size={14} className="mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <JobFilePreview
        jobId={jobId}
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{deleteTarget?.filename}</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && confirmDelete(deleteTarget)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

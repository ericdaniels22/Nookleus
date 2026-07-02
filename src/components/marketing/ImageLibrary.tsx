"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MarketingAsset } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, Trash2, X as XIcon, ImageIcon } from "lucide-react";
import { format } from "date-fns";

const COMMON_TAGS = [
  "water-damage",
  "mold",
  "fire-smoke",
  "storm",
  "team",
  "equipment",
  "before-after-generic",
  "branded-graphic",
  "educational",
  "seasonal-spring",
  "seasonal-summer",
  "seasonal-fall",
  "seasonal-winter",
  "testimonial-bg",
  "logo",
  "community",
];

interface ImageLibraryProps {
  onRefresh?: () => void;
}

export default function ImageLibrary({ onRefresh }: ImageLibraryProps) {
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<MarketingAsset | null>(
    null
  );
  const [uploading, setUploading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newTags, setNewTags] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [customTagInput, setCustomTagInput] = useState("");

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedTags.length > 0) {
        params.set("tags", selectedTags.join(","));
      }
      const url = `/api/marketing/assets${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch assets");
      const data = await res.json();
      setAssets(data.assets || []);
    } catch {
      toast.error("Failed to load images");
    } finally {
      setLoading(false);
    }
  }, [selectedTags]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    pendingFileRef.current = file;
    setNewDescription("");
    setNewTags([]);
    setCustomTagInput("");
    setUploadDialogOpen(true);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  const handleUpload = async () => {
    const file = pendingFileRef.current;
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (newDescription.trim()) {
        formData.append("description", newDescription.trim());
      }
      if (newTags.length > 0) {
        formData.append("tags", newTags.join(","));
      }

      const res = await fetch("/api/marketing/assets", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      toast.success("Image uploaded successfully");
      setUploadDialogOpen(false);
      pendingFileRef.current = null;
      fetchAssets();
      onRefresh?.();
    } catch {
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this image?")) return;

    try {
      const res = await fetch(`/api/marketing/assets?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");

      toast.success("Image deleted");
      setSelectedAsset(null);
      fetchAssets();
      onRefresh?.();
    } catch {
      toast.error("Failed to delete image");
    }
  };

  const toggleFilterTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const toggleNewTag = (tag: string) => {
    setNewTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const tag = customTagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !newTags.includes(tag)) {
      setNewTags((prev) => [...prev, tag]);
    }
    setCustomTagInput("");
  };

  const imageUrl = (asset: MarketingAsset) =>
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/marketing-assets/${asset.storage_path}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Image Library</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110"
        >
          <Upload className="h-4 w-4" />
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Tag Filter */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {COMMON_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => toggleFilterTag(tag)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedTags.includes(tag)
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {tag}
          </button>
        ))}
        {selectedTags.length > 0 && (
          <button
            onClick={() => setSelectedTags([])}
            className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Image Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      ) : assets.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
          <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="mb-4 text-lg font-medium text-muted-foreground">
            No images yet
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110"
          >
            <Upload className="h-4 w-4" />
            Upload your first image
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => setSelectedAsset(asset)}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              <img
                src={imageUrl(asset)}
                alt={asset.description || asset.file_name}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                <span className="w-full truncate px-3 pb-3 text-left text-sm font-medium text-white">
                  {asset.file_name}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUploadDialogOpen(false);
            pendingFileRef.current = null;
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Image</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {pendingFileRef.current && (
              <p className="text-sm text-muted-foreground">
                File: {pendingFileRef.current.name}
              </p>
            )}

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Optional description..."
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Tag Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex flex-wrap gap-2">
                {COMMON_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleNewTag(tag)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      newTags.includes(tag)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>

              {/* Custom Tag Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                  placeholder="Add custom tag..."
                  className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={addCustomTag}
                  className="rounded-lg bg-muted px-3 py-1.5 text-sm font-medium hover:bg-muted/80"
                >
                  Add
                </button>
              </div>

              {/* Selected Tags */}
              {newTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {newTags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => toggleNewTag(tag)}
                        className="ml-0.5"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setUploadDialogOpen(false);
                  pendingFileRef.current = null;
                }}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog
        open={!!selectedAsset}
        onOpenChange={(open) => {
          if (!open) setSelectedAsset(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedAsset?.file_name}</DialogTitle>
          </DialogHeader>
          {selectedAsset && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg">
                <img
                  src={imageUrl(selectedAsset)}
                  alt={selectedAsset.description || selectedAsset.file_name}
                  className="h-auto w-full"
                />
              </div>

              {selectedAsset.description && (
                <p className="text-sm text-muted-foreground">
                  {selectedAsset.description}
                </p>
              )}

              {selectedAsset.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedAsset.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Uploaded {format(new Date(selectedAsset.created_at), "MMM d, yyyy")}
              </p>

              <div className="flex justify-end">
                <button
                  onClick={() => handleDelete(selectedAsset.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

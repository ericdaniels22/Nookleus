"use client";

import { useState, useEffect, useCallback } from "react";
import type { MarketingAsset } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ImageIcon } from "lucide-react";

interface ImagePickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (assetId: string) => void;
  onRemove?: () => void;
  currentImageId?: string | null;
}

export default function ImagePickerDialog({
  open,
  onClose,
  onSelect,
  onRemove,
  currentImageId,
}: ImagePickerDialogProps) {
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    const params = filterTag ? `?tags=${filterTag}` : "";
    const res = await fetch(`/api/marketing/assets${params}`);
    const data = await res.json();
    setAssets(data.assets || []);
    setLoading(false);
  }, [filterTag]);

  useEffect(() => {
    if (open) fetchAssets();
  }, [open, fetchAssets]);

  // Collect all unique tags
  const allTags = Array.from(
    new Set(assets.flatMap((a) => a.tags))
  ).sort();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose an Image</DialogTitle>
        </DialogHeader>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button
              onClick={() => setFilterTag(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                !filterTag
                  ? "bg-accent-tint text-accent-text border border-primary/30"
                  : "bg-muted text-muted-foreground border border-border hover:border-primary/30"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterTag === tag
                    ? "bg-accent-tint text-accent-text border border-primary/30"
                    : "bg-muted text-muted-foreground border border-border hover:border-primary/30"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        {currentImageId && onRemove && (
          <button
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="mb-4 text-sm text-destructive hover:text-destructive/80 transition-colors"
          >
            Remove current image
          </button>
        )}

        {/* Grid */}
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading images...</p>
        ) : assets.length === 0 ? (
          <div className="text-center py-12">
            <ImageIcon size={32} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No images in the library yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {assets.map((asset) => (
              <button
                key={asset.id}
                onClick={() => {
                  onSelect(asset.id);
                  onClose();
                }}
                className={`group relative aspect-square rounded-lg overflow-hidden border-2 transition-all hover:border-primary ${
                  asset.id === currentImageId
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border"
                }`}
              >
                <img
                  src={`${supabaseUrl}/storage/v1/object/public/marketing-assets/${asset.storage_path}`}
                  alt={asset.description || asset.file_name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-xs text-white truncate">{asset.file_name}</p>
                  {asset.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {asset.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {asset.id === currentImageId && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-xs text-primary-foreground font-bold">✓</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

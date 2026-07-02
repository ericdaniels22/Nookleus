"use client";

import { useState, useEffect, useCallback } from "react";
import type { MarketingDraft } from "@/lib/types";
import DraftCard from "./DraftCard";
import DraftDetailSheet from "./DraftDetailSheet";
import ImageLibrary from "./ImageLibrary";
import ImagePickerDialog from "./ImagePickerDialog";
import { toast } from "sonner";

const PLATFORMS = [
  { value: "", label: "All" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "gbp", label: "GBP" },
] as const;

export default function SocialMediaTab() {
  const [drafts, setDrafts] = useState<MarketingDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState("");
  const [showPosted, setShowPosted] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<MarketingDraft | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (platformFilter) params.set("platform", platformFilter);

    const res = await fetch(`/api/marketing/drafts?${params}`);
    const data = await res.json();
    setDrafts(data.drafts || []);
    setLoading(false);
  }, [platformFilter]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const filteredDrafts = showPosted
    ? drafts
    : drafts.filter((d) => d.status !== "posted");

  async function handleUpdateDraft(updated: MarketingDraft) {
    setDrafts((prev) =>
      prev.map((d) => (d.id === updated.id ? updated : d))
    );
    setSelectedDraft(updated);
  }

  async function handleDeleteDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setSelectedDraft(null);
  }

  async function handlePickImage(assetId: string) {
    if (!selectedDraft) return;
    try {
      const res = await fetch("/api/marketing/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedDraft.id, image_id: assetId }),
      });
      const data = await res.json();
      if (data.draft) {
        handleUpdateDraft(data.draft);
        toast.success("Image paired with draft.");
      }
    } catch {
      toast.error("Failed to pair image.");
    }
  }

  async function handleRemoveImage() {
    if (!selectedDraft) return;
    try {
      const res = await fetch("/api/marketing/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedDraft.id, image_id: null }),
      });
      const data = await res.json();
      if (data.draft) {
        handleUpdateDraft(data.draft);
        toast.success("Image removed.");
      }
    } catch {
      toast.error("Failed to remove image.");
    }
  }

  return (
    <div className="p-6 space-y-8">
      {/* Drafts Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Drafts</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showPosted}
              onChange={(e) => setShowPosted(e.target.checked)}
              className="rounded border-border"
            />
            Show Posted
          </label>
        </div>

        {/* Platform filter */}
        <div className="flex flex-wrap gap-2 mb-4">
          {PLATFORMS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPlatformFilter(p.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                platformFilter === p.value
                  ? "bg-accent-tint text-accent-text border border-primary/30"
                  : "bg-muted text-muted-foreground border border-border hover:border-primary/30"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Drafts grid */}
        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading drafts...</p>
        ) : filteredDrafts.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-sm text-muted-foreground mb-1">No drafts yet</p>
            <p className="text-xs text-muted-foreground/60">
              Ask the Marketing agent to create social media posts and they&apos;ll appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                onClick={() => setSelectedDraft(draft)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Image Library Section */}
      <ImageLibrary onRefresh={fetchDrafts} />

      {/* Draft Detail Sheet */}
      <DraftDetailSheet
        draft={selectedDraft}
        onClose={() => setSelectedDraft(null)}
        onUpdate={handleUpdateDraft}
        onDelete={handleDeleteDraft}
        onPickImage={() => setImagePickerOpen(true)}
      />

      {/* Image Picker Dialog */}
      <ImagePickerDialog
        open={imagePickerOpen}
        onClose={() => setImagePickerOpen(false)}
        onSelect={handlePickImage}
        onRemove={handleRemoveImage}
        currentImageId={selectedDraft?.image_id}
      />
    </div>
  );
}

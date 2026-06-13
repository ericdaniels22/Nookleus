"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase";
import { resolveCoverPhotoUrl } from "@/lib/jobs/cover-photo";
import type { Photo } from "@/lib/types";

interface JobCoverPickerProps {
  jobId: string;
  currentCoverPhotoId: string | null;
  supabaseUrl: string;
  onClose: () => void;
  onCoverChosen: (photo: Photo) => void;
}

/**
 * Modal photo picker for setting a job's cover photo from the Jobs tab
 * Comfortable view (#164) — the second entry point for a cover, alongside
 * the "Set as cover photo" action in the Photos tab. Lists that job's
 * photos; choosing one writes `jobs.cover_photo_id` and reports the
 * choice back to the row so it updates without a page reload.
 */
export default function JobCoverPicker({
  jobId,
  currentCoverPhotoId,
  supabaseUrl,
  onClose,
  onCoverChosen,
}: JobCoverPickerProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  // The id of the photo whose cover write is in flight, if any.
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    // setState lives in the .then() callback, not the effect body, so the
    // react-hooks/set-state-in-effect lint rule stays satisfied.
    const supabase = createClient();
    supabase
      .from("photos")
      .select("*")
      .eq("job_id", jobId)
      .order("taken_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .then(({ data }: { data: Photo[] | null }) => {
        setPhotos(data ?? []);
        setLoading(false);
      });
  }, [jobId]);

  // Promote the chosen photo to the job's cover. Writes jobs.cover_photo_id
  // directly, mirroring job-photos-tab.tsx's "Set as cover" action, then
  // hands the photo back so the Comfortable row updates without a reload.
  async function handleChoose(photo: Photo) {
    setSaving(photo.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ cover_photo_id: photo.id })
      .eq("id", jobId);
    setSaving(null);
    if (error) {
      toast.error("Failed to set cover photo.");
      return;
    }
    toast.success("Cover photo updated.");
    onCoverChosen(photo);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Choose cover photo"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-base font-semibold text-foreground">
            Choose cover photo
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-10">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        ) : photos.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No photos on this job yet. Add photos before choosing a cover.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 overflow-y-auto p-4 sm:grid-cols-4">
            {photos.map((photo) => {
              const isCurrent = photo.id === currentCoverPhotoId;
              return (
                <button
                  key={photo.id}
                  type="button"
                  aria-label={photo.caption ?? "Job photo"}
                  disabled={saving !== null}
                  onClick={() => handleChoose(photo)}
                  className={`relative overflow-hidden rounded-lg transition-transform hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 ${
                    isCurrent ? "ring-2 ring-[#F5A623]" : ""
                  }`}
                >
                  <img
                    src={resolveCoverPhotoUrl(photo, supabaseUrl) ?? ""}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                  {isCurrent && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-[#F5A623] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Current cover
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

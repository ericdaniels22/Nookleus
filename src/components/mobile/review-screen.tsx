"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, Tag as TagIcon, Trash2, Type, X } from "lucide-react";
import { CameraPreview } from "@capacitor-community/camera-preview";
import {
  deleteCapture,
  listSessionCaptures,
  updateSidecar,
} from "@/lib/mobile/capture-storage";
import type { PendingCapture } from "@/lib/mobile/capture-types";
import { usePhotoTags } from "@/lib/mobile/use-photo-tags";
import type { PhotoTag } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ReviewScreenProps {
  jobId: string;
  sessionId: string;
  onBackToCamera: () => void;
  onExit: () => void;
}

export default function ReviewScreen({
  jobId,
  sessionId,
  onBackToCamera,
  onExit,
}: ReviewScreenProps) {
  const [captures, setCaptures] = useState<PendingCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<PendingCapture | null>(null);
  const [batchPanel, setBatchPanel] = useState<"caption" | "tags" | null>(null);
  const [batchCaption, setBatchCaption] = useState("");
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const { tags: photoTags, loading: tagsLoading, error: tagsError } =
    usePhotoTags();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listSessionCaptures(jobId, sessionId);
      setCaptures(list);
    } finally {
      setLoading(false);
    }
  }, [jobId, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Defensive: the camera-preview plugin (toBack: true path) attaches a
  // UITapGestureRecognizer to the WKWebView and never removes it on stop().
  // If we entered the review screen with the camera still alive (e.g. Done
  // tapped before stopCamera resolved), the live feed remains rendered
  // behind the WebView and the tap recognizer can interfere with routing.
  // Force-stop on mount; ignore "already stopped" rejections.
  useEffect(() => {
    void CameraPreview.stop().catch(() => {});
  }, []);

  const handleDelete = useCallback(
    async (captureId: string) => {
      await deleteCapture(jobId, sessionId, captureId);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(captureId);
        return next;
      });
      if (expanded?.sidecar.client_capture_id === captureId) setExpanded(null);
      await refresh();
    },
    [expanded, jobId, refresh, sessionId],
  );

  const handleTileTap = (capture: PendingCapture) => {
    if (selectMode) {
      const id = capture.sidecar.client_capture_id;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setExpanded(capture);
  };

  const toggleSelectMode = () => {
    setSelectMode((prev) => {
      const next = !prev;
      if (!next) setSelected(new Set());
      return next;
    });
  };

  const allSelected = useMemo(() => {
    if (captures.length === 0) return false;
    return captures.every((c) => selected.has(c.sidecar.client_capture_id));
  }, [captures, selected]);

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(captures.map((c) => c.sidecar.client_capture_id)));
    }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selected);
    for (const id of ids) {
      await deleteCapture(jobId, sessionId, id);
    }
    setSelected(new Set());
    await refresh();
  };

  const openCaptionPanel = () => {
    if (selected.size === 0) return;
    const captionsInScope = captures
      .filter((c) => selected.has(c.sidecar.client_capture_id))
      .map((c) => c.sidecar.caption ?? "");
    const allEqual = captionsInScope.every((c) => c === captionsInScope[0]);
    setBatchCaption(allEqual ? captionsInScope[0] : "");
    setBatchPanel("caption");
  };

  const openTagsPanel = () => {
    if (selected.size === 0) return;
    const inScope = captures.filter((c) =>
      selected.has(c.sidecar.client_capture_id),
    );
    const intersection = inScope.reduce<string[] | null>((acc, c) => {
      if (acc === null) return [...c.sidecar.tag_ids];
      return acc.filter((id) => c.sidecar.tag_ids.includes(id));
    }, null);
    setBatchTags(intersection ?? []);
    setBatchPanel("tags");
  };

  const applyBatchCaption = async () => {
    const ids = Array.from(selected);
    for (const id of ids) {
      await updateSidecar(jobId, sessionId, id, {
        caption: batchCaption.trim() || null,
      });
    }
    setBatchPanel(null);
    await refresh();
  };

  const applyBatchTags = async () => {
    const ids = Array.from(selected);
    for (const id of ids) {
      await updateSidecar(jobId, sessionId, id, { tag_ids: batchTags });
    }
    setBatchPanel(null);
    await refresh();
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col bg-background text-foreground"
      style={{ touchAction: "manipulation" }}
    >
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(env(safe-area-inset-top),16px)]">
        <button
          type="button"
          onClick={onBackToCamera}
          className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-sm"
          aria-label="Back to camera"
        >
          <ChevronLeft className="h-4 w-4" />
          Camera
        </button>
        <div className="text-sm font-medium">
          {captures.length} {captures.length === 1 ? "photo" : "photos"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectMode}
            className={cn(
              "rounded-full px-3 py-2 text-sm",
              selectMode ? "bg-foreground text-background" : "bg-white/10 text-white",
            )}
          >
            {selectMode ? "Done" : "Select"}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Save &amp; exit
          </button>
        </div>
      </header>

      {selectMode && (
        <div className="flex items-center justify-between gap-3 border-y border-white/10 bg-white/5 px-4 py-2 text-sm">
          <button
            type="button"
            onClick={handleSelectAllToggle}
            className="text-white/80"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <span className="text-white/60">{selected.size} selected</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm opacity-70">
          Loading captures&hellip;
        </div>
      ) : captures.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm opacity-70">
            No photos in this session. Tap Camera to capture some, or Save
            &amp; exit to return to the job.
          </p>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-3 gap-3 overflow-y-auto p-3 [touch-action:pan-y]">
          {captures.map((capture) => (
            <ReviewTile
              key={capture.sidecar.client_capture_id}
              capture={capture}
              isSelected={selected.has(capture.sidecar.client_capture_id)}
              onTap={() => handleTileTap(capture)}
            />
          ))}
        </div>
      )}

      {selectMode && selected.size > 0 && batchPanel === null && (
        <footer className="flex items-center justify-around gap-2 border-t border-white/10 bg-black/90 px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          <FooterAction icon={<Type className="h-5 w-5" />} label="Caption" onClick={openCaptionPanel} />
          <FooterAction icon={<TagIcon className="h-5 w-5" />} label="Tag" onClick={openTagsPanel} />
          <FooterAction
            icon={<Trash2 className="h-5 w-5" />}
            label="Delete"
            onClick={handleBatchDelete}
            destructive
          />
        </footer>
      )}

      {batchPanel === "caption" && (
        <BatchPanel
          title={`Caption ${selected.size} ${selected.size === 1 ? "photo" : "photos"}`}
          onClose={() => setBatchPanel(null)}
          onSubmit={applyBatchCaption}
        >
          <textarea
            value={batchCaption}
            onChange={(e) => setBatchCaption(e.target.value)}
            placeholder="Caption applied to all selected photos"
            className="h-24 w-full resize-none rounded-md border border-white/30 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-ring"
          />
        </BatchPanel>
      )}

      {batchPanel === "tags" && (
        <BatchPanel
          title={`Tag ${selected.size} ${selected.size === 1 ? "photo" : "photos"}`}
          onClose={() => setBatchPanel(null)}
          onSubmit={applyBatchTags}
        >
          <div className="flex flex-wrap gap-2">
            {tagsLoading && (
              <span className="text-xs text-white/60">Loading tags&hellip;</span>
            )}
            {tagsError && !tagsLoading && (
              <span className="text-xs text-destructive">
                Couldn&apos;t load tags ({tagsError}).
              </span>
            )}
            {!tagsLoading &&
              !tagsError &&
              photoTags.length === 0 && (
                <span className="text-xs text-white/60">
                  No tags configured for this workspace yet.
                </span>
              )}
            {!tagsLoading &&
              photoTags.map((tag) => {
                const active = batchTags.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    onClick={() =>
                      setBatchTags((prev) =>
                        prev.includes(tag.id)
                          ? prev.filter((id) => id !== tag.id)
                          : [...prev, tag.id],
                      )
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-white/30 bg-transparent text-white",
                    )}
                    style={
                      active
                        ? { backgroundColor: tag.color, borderColor: tag.color, color: "white" }
                        : undefined
                    }
                  >
                    {tag.name}
                  </button>
                );
              })}
          </div>
        </BatchPanel>
      )}

      {expanded && !selectMode && (
        <ExpandedPhoto
          capture={expanded}
          tags={photoTags}
          onClose={() => setExpanded(null)}
          onDelete={() => handleDelete(expanded.sidecar.client_capture_id)}
        />
      )}
    </div>
  );
}

interface ReviewTileProps {
  capture: PendingCapture;
  isSelected: boolean;
  onTap: () => void;
}

// Plain block-level button as the tap target. Earlier versions used a
// position-absolute button inside a wrapper div, which collided with a
// known WebKit bug: hit-test bounds for absolute children of a scrollable
// container can desync from the scroll offset, causing taps to land on
// the wrong element once the grid scrolls. Side effect: swipe-to-delete
// is removed from this layout. Delete paths preserved: Select mode +
// batch delete in the footer; Delete button in the expanded photo view.
function ReviewTile({ capture, isSelected, onTap }: ReviewTileProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      style={{ touchAction: "manipulation" }}
      className="relative block aspect-square overflow-hidden rounded-md bg-muted"
    >
      <img
        src={capture.thumbnail_data_url}
        alt=""
        className="h-full w-full object-cover"
      />
      {isSelected && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/40">
          <Check className="h-10 w-10 text-white" />
        </div>
      )}
      {capture.sidecar.tag_ids.length > 0 && !isSelected && (
        <div className="absolute bottom-1 left-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium">
          {capture.sidecar.tag_ids.length} tag
          {capture.sidecar.tag_ids.length === 1 ? "" : "s"}
        </div>
      )}
    </button>
  );
}

function FooterAction({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-md px-4 py-1 text-xs font-medium",
        destructive ? "text-destructive" : "text-white",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function BatchPanel({
  title,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-[1010] rounded-t-2xl bg-black/95 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full bg-white/10 p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-4">{children}</div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function ExpandedPhoto({
  capture,
  tags,
  onClose,
  onDelete,
}: {
  capture: PendingCapture;
  tags: PhotoTag[];
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[1020] flex flex-col bg-black/95 text-white">
      <header className="flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),16px)]">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/10 px-3 py-2 text-sm"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 rounded-full bg-destructive/90 px-3 py-2 text-sm"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </header>
      <div className="flex flex-1 items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={capture.thumbnail_data_url}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      </div>
      {(capture.sidecar.caption || capture.sidecar.tag_ids.length > 0) && (
        <footer className="flex flex-col gap-2 border-t border-white/10 bg-black/95 px-5 py-3 text-sm">
          {capture.sidecar.caption && <p>{capture.sidecar.caption}</p>}
          {capture.sidecar.tag_ids.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {capture.sidecar.tag_ids.map((tagId) => {
                const tag = tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <span
                    key={tagId}
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                );
              })}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

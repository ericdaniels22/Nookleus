"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, Tag as TagIcon, Trash2, Type, X } from "lucide-react";
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

const SWIPE_DELETE_THRESHOLD = 80;

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
    <div className="fixed inset-0 z-[1000] flex flex-col bg-black text-white">
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
              selectMode ? "bg-white text-black" : "bg-white/10 text-white",
            )}
          >
            {selectMode ? "Done" : "Select"}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-emerald-500 px-3 py-2 text-sm font-medium text-black"
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
        <div className="grid flex-1 grid-cols-3 gap-1 overflow-y-auto p-1">
          {captures.map((capture) => (
            <ReviewTile
              key={capture.sidecar.client_capture_id}
              capture={capture}
              isSelected={selected.has(capture.sidecar.client_capture_id)}
              selectMode={selectMode}
              onTap={() => handleTileTap(capture)}
              onSwipeDelete={() => handleDelete(capture.sidecar.client_capture_id)}
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
            className="h-24 w-full resize-none rounded-md border border-white/30 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-white"
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
              <span className="text-xs text-red-300">
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
                        ? "border-white bg-white text-black"
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
  selectMode: boolean;
  onTap: () => void;
  onSwipeDelete: () => void;
}

function ReviewTile({
  capture,
  isSelected,
  selectMode,
  onTap,
  onSwipeDelete,
}: ReviewTileProps) {
  const [drag, setDrag] = useState(0);
  const [pointerDownX, setPointerDownX] = useState<number | null>(null);
  const [pointerMoved, setPointerMoved] = useState(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (selectMode) return;
    setPointerDownX(e.clientX);
    setPointerMoved(false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerDownX === null) return;
    const dx = e.clientX - pointerDownX;
    if (Math.abs(dx) > 4) setPointerMoved(true);
    setDrag(dx < 0 ? Math.max(dx, -SWIPE_DELETE_THRESHOLD - 24) : 0);
  };

  const handlePointerUp = () => {
    if (drag <= -SWIPE_DELETE_THRESHOLD) {
      setDrag(0);
      setPointerDownX(null);
      onSwipeDelete();
      return;
    }
    if (!pointerMoved) {
      // Treat as a tap.
      onTap();
    }
    setDrag(0);
    setPointerDownX(null);
  };

  const showDeleteHint = drag <= -16;

  return (
    <div className="relative aspect-square overflow-hidden bg-white/5">
      {showDeleteHint && (
        <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-red-600">
          <Trash2 className="h-5 w-5 text-white" />
        </div>
      )}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          setDrag(0);
          setPointerDownX(null);
        }}
        style={{ transform: `translateX(${drag}px)` }}
        className="absolute inset-0 touch-pan-y bg-black"
      >
        <img
          src={capture.thumbnail_data_url}
          alt=""
          className="h-full w-full object-cover"
        />
        {isSelected && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/40">
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
    </div>
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
        destructive ? "text-red-400" : "text-white",
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
          className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
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
          className="flex items-center gap-1 rounded-full bg-red-600/90 px-3 py-2 text-sm"
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

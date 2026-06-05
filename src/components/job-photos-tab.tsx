"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Photo, PhotoTag, PhotoReportTemplate } from "@/lib/types";
import { photoUrl } from "@/lib/jobs/photo-url";
import { photoLoadPriority } from "@/lib/jobs/photo-load-priority";
import { format } from "date-fns";
import { Loader2, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import PhotoUploadModal from "@/components/photo-upload";
import JSZip from "jszip";

interface JobPhotosTabProps {
  jobId: string;
  tags: PhotoTag[];
  supabaseUrl: string;
  coverPhotoId: string | null;
  onPhotosAdded: () => void;
  onPhotoUpdated: () => void;
  onCoverPhotoChanged: () => void;
  onSelectPhoto: (photo: Photo) => void;
}

const PAGE_SIZE = 50;

// Top-first loading (#394): eagerly load a generous first-row batch of the
// newest date group so the top of the grid paints immediately; the rest stay
// lazy. The grid uses CSS auto-fill, so the real column count flexes with
// width — 8 covers a full row on desktop for both view sizes, and is only a
// few rows on mobile (still just the top of the screen). Over-covering is
// harmless: eager loading is a hint, and the win is not lazy-loading the top.
const EAGER_FIRST_ROW = 8;

export default function JobPhotosTab({
  jobId,
  tags,
  supabaseUrl,
  coverPhotoId,
  onPhotosAdded,
  onPhotoUpdated,
  onCoverPhotoChanged,
  onSelectPhoto,
}: JobPhotosTabProps) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewSize, setViewSize] = useState<"compact" | "comfortable">("compact");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  // Bulk action states
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);
  // Create-report template picker (#405): the "Create report" action opens a
  // small menu (Blank + the Organization's Photo Report templates). Templates
  // are loaded lazily the first time the menu opens.
  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const [reportTemplates, setReportTemplates] = useState<PhotoReportTemplate[]>(
    [],
  );
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // Cover photo: id of the photo whose "Set as cover" write is in flight
  const [settingCover, setSettingCover] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPhotos = useCallback(async (offset: number, append: boolean) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);

    const supabase = createClient();
    let query = supabase
      .from("photos")
      .select("*, photo_tag_assignments(tag_id)")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (startDate) query = query.gte("created_at", startDate);
    if (endDate) query = query.lte("created_at", endDate + "T23:59:59");
    if (selectedUsers.length > 0) query = query.in("taken_by", selectedUsers);

    const { data } = await query;
    const fetched = (data || []) as (Photo & { photo_tag_assignments?: { tag_id: string }[] })[];

    // Client-side tag filter
    let filtered: Photo[] = fetched;
    if (selectedTags.length > 0) {
      filtered = fetched.filter((p) => {
        const photoTagIds = (p.photo_tag_assignments || []).map((a) => a.tag_id);
        return selectedTags.some((t) => photoTagIds.includes(t));
      });
    }

    if (append) {
      setPhotos((prev) => [...prev, ...filtered]);
    } else {
      setPhotos(filtered);
    }
    setHasMore(fetched.length === PAGE_SIZE);
    setLoading(false);
    setLoadingMore(false);
  }, [jobId, startDate, endDate, selectedUsers, selectedTags]);

  // Initial load + reset on filter change
  useEffect(() => {
    setPhotos([]);
    setHasMore(true);
    setSelectedIds(new Set());
    fetchPhotos(0, false);
  }, [fetchPhotos]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          fetchPhotos(photos.length, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, photos.length, fetchPhotos]);

  // Group photos by date
  const groupedPhotos = photos.reduce<{ date: string; label: string; photos: Photo[] }[]>(
    (groups, photo) => {
      const dateKey = format(new Date(photo.created_at), "yyyy-MM-dd");
      const existing = groups.find((g) => g.date === dateKey);
      if (existing) {
        existing.photos.push(photo);
      } else {
        groups.push({
          date: dateKey,
          label: format(new Date(photo.created_at), "EEEE, MMMM do, yyyy"),
          photos: [photo],
        });
      }
      return groups;
    },
    []
  );

  // Unique users for filter
  const uniqueUsers = [...new Set(photos.map((p) => p.taken_by))].sort();

  // Selection helpers
  const toggleSelect = (photoId: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedRef.current) {
        const allIds = photos.map((p) => p.id);
        const startIdx = allIds.indexOf(lastClickedRef.current);
        const endIdx = allIds.indexOf(photoId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = lo; i <= hi; i++) next.add(allIds[i]);
        }
      } else {
        if (next.has(photoId)) next.delete(photoId);
        else next.add(photoId);
      }
      lastClickedRef.current = photoId;
      return next;
    });
  };

  const toggleGroupSelect = (groupPhotos: Photo[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const groupIds = groupPhotos.map((p) => p.id);
      const allSelected = groupIds.every((id) => next.has(id));
      if (allSelected) {
        groupIds.forEach((id) => next.delete(id));
      } else {
        groupIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const isGroupSelected = (groupPhotos: Photo[]) =>
    groupPhotos.length > 0 && groupPhotos.every((p) => selectedIds.has(p.id));

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  // Bulk handlers
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    const res = await fetch(`/api/jobs/${jobId}/photos/bulk`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds: ids }),
    });
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
      setDeleteConfirm(false);
      onPhotoUpdated();
    }
  };

  const handleBulkTag = async (tagId: string, action: "add" | "remove") => {
    const ids = Array.from(selectedIds);
    await fetch(`/api/jobs/${jobId}/photos/bulk-tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds: ids, tagIds: [tagId], action }),
    });
    fetchPhotos(0, false);
    setSelectedIds(new Set());
    setTagPopoverOpen(false);
    onPhotoUpdated();
  };

  const handleBulkDownload = async () => {
    setDownloading(true);
    const ids = Array.from(selectedIds);
    const res = await fetch(`/api/jobs/${jobId}/photos/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds: ids }),
    });
    const { urls } = await res.json() as { urls: { url: string; filename: string }[] };

    const zip = new JSZip();
    await Promise.all(
      urls.map(async ({ url, filename }) => {
        const blob = await fetch(url).then((r) => r.blob());
        zip.file(filename, blob);
      })
    );

    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = `photos-${jobId.slice(0, 8)}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDownloading(false);
    setSelectedIds(new Set());
  };

  // Lazily load the Organization's Photo Report templates for the create-report
  // picker (#405). RLS scopes the read to the active Organization. Loaded once,
  // the first time the menu opens.
  const loadReportTemplates = useCallback(async () => {
    if (templatesLoaded) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("photo_report_templates")
      .select("id, name")
      .order("name", { ascending: true });
    setReportTemplates((data as PhotoReportTemplate[]) ?? []);
    setTemplatesLoaded(true);
  }, [templatesLoaded]);

  // Create a Photo Report from the selected photos (#400, #405). Server-side so
  // the report is numbered per Job and stamped with the real preparer; an
  // optional template seeds its boilerplate Sections (the selected photos are
  // appended as a Photos section). On success we open the full-screen, Job-scoped
  // builder.
  const handleCreateReport = async (templateId: string | null = null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setReportMenuOpen(false);
    setCreatingReport(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoIds: ids,
          ...(templateId ? { templateId } : {}),
        }),
      });
      if (!res.ok) {
        toast.error("Failed to create report.");
        setCreatingReport(false);
        return;
      }
      const { report } = (await res.json()) as { report: { id: string } };
      router.push(`/jobs/${jobId}/reports/${report.id}`);
    } catch {
      toast.error("Failed to create report.");
      setCreatingReport(false);
    }
  };

  // Promote a photo to be the job's cover. Writes jobs.cover_photo_id
  // directly, mirroring the single-field job updates in job-detail.tsx.
  const handleSetCover = async (photoId: string) => {
    setSettingCover(photoId);
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ cover_photo_id: photoId })
      .eq("id", jobId);
    setSettingCover(null);
    if (error) {
      toast.error("Failed to set cover photo.");
      return;
    }
    toast.success("Cover photo updated.");
    onCoverPhotoChanged();
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {/* Users dropdown */}
        <div className="relative group">
          <button className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground flex items-center gap-1.5 hover:border-muted-foreground/40 transition-colors">
            Users {selectedUsers.length > 0 && `(${selectedUsers.length})`} ▾
          </button>
          <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[180px] z-50 hidden group-focus-within:block hover:block">
            {uniqueUsers.map((user) => (
              <label key={user} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <input
                  type="checkbox"
                  checked={selectedUsers.includes(user)}
                  onChange={() => {
                    setSelectedUsers((prev) =>
                      prev.includes(user) ? prev.filter((u) => u !== user) : [...prev, user]
                    );
                  }}
                  className="rounded"
                />
                {user}
              </label>
            ))}
            {uniqueUsers.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">No users yet</p>
            )}
          </div>
        </div>
        {/* Tags dropdown */}
        <div className="relative group">
          <button className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground flex items-center gap-1.5 hover:border-muted-foreground/40 transition-colors">
            Tags {selectedTags.length > 0 && `(${selectedTags.length})`} ▾
          </button>
          <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[200px] z-50 hidden group-focus-within:block hover:block">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag.id)}
                  onChange={() => {
                    setSelectedTags((prev) =>
                      prev.includes(tag.id) ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]
                    );
                  }}
                  className="rounded"
                />
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex-1" />

        {/* View toggle */}
        <button
          onClick={() => setViewSize((v) => (v === "compact" ? "comfortable" : "compact"))}
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground hover:border-muted-foreground/40 transition-colors"
        >
          {viewSize === "compact" ? "Comfortable" : "Compact"}
        </button>

        {/* Upload */}
        <button
          onClick={() => setUploadOpen(true)}
          className="px-4 py-1.5 rounded-lg bg-[#2B5EA7] text-white text-sm font-semibold flex items-center gap-1.5 hover:bg-[#234b8a] transition-colors"
        >
          <Plus size={14} />
          Upload Photos
        </button>
      </div>

      <PhotoUploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        jobId={jobId}
        tags={tags}
        onPhotosAdded={() => {
          onPhotosAdded();
          fetchPhotos(0, false);
        }}
      />

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#2B5EA7] text-white rounded-xl mb-4 text-sm sticky top-0 z-40">
          <span className="font-semibold">{selectedIds.size} photos selected</span>
          <div className="relative">
            <button
              className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
              onClick={() => setTagPopoverOpen(!tagPopoverOpen)}
            >
              Tag
            </button>
            {tagPopoverOpen && (
              <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[200px] z-50">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">Apply tag to selected:</p>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => handleBulkTag(tag.id, "add")}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded cursor-pointer"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
              onClick={() => {
                const next = !reportMenuOpen;
                setReportMenuOpen(next);
                if (next) loadReportTemplates();
              }}
              disabled={creatingReport}
            >
              {creatingReport ? "Creating..." : "Create report"}
            </button>
            {reportMenuOpen && (
              <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[220px] z-50 text-foreground">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
                  Start from…
                </p>
                <button
                  onClick={() => handleCreateReport(null)}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
                >
                  Blank report
                </button>
                {reportTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleCreateReport(t.id)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
                  >
                    {t.name}
                  </button>
                ))}
                {templatesLoaded && reportTemplates.length === 0 && (
                  <p className="text-xs text-muted-foreground/60 px-2 py-1.5">
                    No templates yet — add them in Settings → Photo Report
                    Templates.
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
            onClick={handleBulkDownload}
            disabled={downloading}
          >
            {downloading ? "Zipping..." : "Download"}
          </button>
          <button
            className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
            onClick={() => setDeleteConfirm(true)}
          >
            Delete
          </button>
          <div className="flex-1" />
          <button
            className="opacity-70 hover:opacity-100 transition-opacity text-xs"
            onClick={() => setSelectedIds(new Set())}
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-xl border border-border p-6 max-w-sm shadow-xl">
            <h3 className="text-base font-semibold text-foreground mb-2">Delete {selectedIds.size} photos?</h3>
            <p className="text-sm text-muted-foreground mb-4">This cannot be undone. Photos and their annotations will be permanently deleted.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 rounded-lg bg-[#C41E2A] text-white text-sm font-medium hover:bg-[#a01823] transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No photos found.</p>
          {(startDate || endDate || selectedUsers.length > 0 || selectedTags.length > 0) && (
            <button
              className="text-sm text-[#2B5EA7] hover:underline mt-2"
              onClick={() => {
                setStartDate("");
                setEndDate("");
                setSelectedUsers([]);
                setSelectedTags([]);
              }}
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div>
          {groupedPhotos.map((group, groupIndex) => (
            <div key={group.date} className="mb-6">
              {/* Date header */}
              <div className="flex items-center gap-2.5 mb-3">
                <input
                  type="checkbox"
                  checked={isGroupSelected(group.photos)}
                  onChange={() => toggleGroupSelect(group.photos)}
                  className="w-4 h-4 rounded border-2 border-muted-foreground/30 accent-[#2B5EA7] cursor-pointer"
                />
                <span className="text-[15px] font-semibold text-foreground">{group.label}</span>
              </div>
              {/* Photo grid */}
              <div
                className="grid gap-2.5"
                style={{
                  gridTemplateColumns: viewSize === "compact"
                    ? "repeat(auto-fill, minmax(120px, 1fr))"
                    : "repeat(auto-fill, minmax(160px, 1fr))",
                }}
              >
                {group.photos.map((photo, index) => {
                  const isSelected = selectedIds.has(photo.id);
                  const isCover = photo.id === coverPhotoId;
                  // Only the newest group (groupIndex 0) has a visible top row;
                  // every other group passes 0 columns, so all its images stay
                  // lazy.
                  const imgPriority = photoLoadPriority(
                    index,
                    groupIndex === 0 ? EAGER_FIRST_ROW : 0,
                  );
                  return (
                    <div key={photo.id} className="cursor-pointer">
                      <div
                        className={`aspect-square rounded-lg overflow-hidden relative transition-transform hover:scale-[1.03] ${
                          isSelected
                            ? "ring-[3px] ring-[#2B5EA7]"
                            : isCover
                            ? "ring-[3px] ring-[#F5A623]"
                            : ""
                        }`}
                        onClick={(e) => {
                          if (e.shiftKey || selectedIds.size > 0) {
                            toggleSelect(photo.id, e.shiftKey);
                          } else {
                            onSelectPhoto(photo);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          toggleSelect(photo.id, false);
                        }}
                      >
                        <img
                          src={photoUrl(photo, supabaseUrl, "grid")}
                          alt={photo.caption || "Photo"}
                          className="w-full h-full object-cover"
                          loading={imgPriority.loading}
                          fetchPriority={imgPriority.fetchPriority}
                        />
                        {/* User avatar */}
                        <div className="absolute bottom-1.5 left-1.5 w-6 h-6 rounded-full bg-[#2B5EA7] border-2 border-white flex items-center justify-center">
                          <span className="text-[9px] font-bold text-white">{getInitials(photo.taken_by)}</span>
                        </div>
                        {/* Cover photo control */}
                        {isCover ? (
                          <div
                            className="absolute top-1.5 left-1.5 flex items-center gap-1 h-6 px-1.5 rounded-full bg-[#F5A623] text-white text-[10px] font-semibold"
                            title="Current cover photo"
                          >
                            <Star size={11} fill="currentColor" />
                            Cover
                          </div>
                        ) : (
                          <button
                            type="button"
                            title="Set as cover photo"
                            aria-label="Set as cover photo"
                            disabled={settingCover === photo.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetCover(photo.id);
                            }}
                            className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/70 transition-colors disabled:opacity-60"
                          >
                            {settingCover === photo.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Star size={12} />
                            )}
                          </button>
                        )}
                        {/* Selection checkmark */}
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#2B5EA7] flex items-center justify-center">
                            <span className="text-white text-[10px]">✓</span>
                          </div>
                        )}
                      </div>
                      {/* Meta */}
                      <div className="pt-1 px-0.5">
                        <span className="text-[11px] text-muted-foreground">
                          {format(new Date(photo.created_at), "h:mm a")}
                        </span>
                        <span className="text-[11px] text-muted-foreground/60"> · </span>
                        <span className="text-[11px] text-muted-foreground/60">{photo.taken_by}</span>
                        <div className="flex gap-1 mt-0.5">
                          {photo.before_after_role === "before" && (
                            <span className="text-[9px] px-1 py-0 rounded bg-[#FCEBEB] text-[#791F1F]">Before</span>
                          )}
                          {photo.before_after_role === "after" && (
                            <span className="text-[9px] px-1 py-0 rounded bg-[#E1F5EE] text-[#085041]">After</span>
                          )}
                          {photo.annotated_path && (
                            <span className="text-[9px] px-1 py-0 rounded bg-[#dbeafe] text-[#2B5EA7]">Edited</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

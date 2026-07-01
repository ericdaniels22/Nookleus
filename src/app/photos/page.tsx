"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { photoUrl } from "@/lib/jobs/photo-url";
import { Photo, PhotoTag, Job } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Camera,
  Search,
  Image as ImageIcon,
  Calendar,
  MapPin,
  Filter,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import Link from "next/link";

type PhotoWithJob = Photo & { job: Pick<Job, "id" | "job_number" | "property_address"> };

export default function PhotosPage() {
  const [photos, setPhotos] = useState<PhotoWithJob[]>([]);
  const [tags, setTags] = useState<PhotoTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Pick<Job, "id" | "job_number" | "property_address">[]>([]);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [photosRes, tagsRes, jobsRes] = await Promise.all([
      supabase
        .from("photos")
        .select("*, job:jobs!job_id(id, job_number, property_address)")
        .order("taken_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase.from("photo_tags").select("*").order("name"),
      supabase
        .from("jobs")
        .select("id, job_number, property_address")
        .order("created_at", { ascending: false }),
    ]);

    if (photosRes.data) setPhotos(photosRes.data as PhotoWithJob[]);
    if (tagsRes.data) setTags(tagsRes.data as PhotoTag[]);
    if (jobsRes.data) setJobs(jobsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = photos.filter((p) => {
    if (selectedJob && p.job_id !== selectedJob) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchCaption = p.caption?.toLowerCase().includes(q);
      const matchJob = p.job?.job_number?.toLowerCase().includes(q);
      const matchAddress = p.job?.property_address?.toLowerCase().includes(q);
      if (!matchCaption && !matchJob && !matchAddress) return false;
    }
    return true;
  });

  const totalPhotos = photos.length;
  const jobsWithPhotos = new Set(photos.map((p) => p.job_id)).size;

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground/60">Loading photos...</div>
    );
  }

  return (
    <div className="max-w-7xl animate-fade-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground">
            <span>Photos</span>
          </h1>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} across{" "}
            {jobsWithPhotos} job{jobsWithPhotos !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Photos" value={totalPhotos} icon={Camera} />
        <StatCard label="Jobs with Photos" value={jobsWithPhotos} icon={MapPin} />
        <StatCard
          label="This Week"
          value={
            photos.filter((p) => {
              const d = new Date(p.created_at);
              const now = new Date();
              const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              return d >= weekAgo;
            }).length
          }
          icon={Calendar}
        />
        <StatCard label="Tags" value={tags.length} icon={Filter} />
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border border-border p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by caption, job number, or address..."
              className="pl-9"
            />
          </div>
          {/* Job filter */}
          <select
            value={selectedJob || ""}
            onChange={(e) => setSelectedJob(e.target.value || null)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            <option value="">All Jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_number} — {j.property_address}
              </option>
            ))}
          </select>
        </div>

        {/* Tag pills */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => setSelectedTag(null)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                !selectedTag
                  ? "bg-accent-tint text-accent-text border-transparent"
                  : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
              )}
            >
              All
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() =>
                  setSelectedTag(selectedTag === tag.id ? null : tag.id)
                }
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                  selectedTag === tag.id
                    ? "text-white border-transparent"
                    : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
                )}
                style={
                  selectedTag === tag.id
                    ? { backgroundColor: tag.color, borderColor: tag.color }
                    : undefined
                }
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Photo grid */}
      {filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <ImageIcon size={48} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground/60 text-lg font-medium">No photos yet</p>
          <p className="text-muted-foreground/40 text-sm mt-1">
            Photos will appear here once uploaded to a job.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((photo) => (
            <Link
              key={photo.id}
              href={`/jobs/${photo.job_id}`}
              className="group bg-card rounded-xl border border-border overflow-hidden hover:shadow-md transition-all"
            >
              <div className="aspect-square bg-muted relative overflow-hidden">
                <img
                  src={photoUrl(photo, supabaseUrl, "grid")}
                  alt={photo.caption || "Job photo"}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                {photo.before_after_role && (
                  <Badge
                    className={cn(
                      "absolute top-2 left-2 text-[10px] px-1.5 py-0 rounded",
                      photo.before_after_role === "before"
                        ? "bg-[#FCEBEB] text-[#791F1F]"
                        : "bg-[#E1F5EE] text-[#085041]"
                    )}
                  >
                    {photo.before_after_role === "before" ? "Before" : "After"}
                  </Badge>
                )}
                {photo.annotated_path && (
                  <div className="absolute bottom-2 right-2 bg-black/60 rounded px-1.5 py-0.5 flex items-center gap-1">
                    <Pencil size={10} className="text-white" />
                    <span className="text-[10px] text-white font-medium">Edited</span>
                  </div>
                )}
              </div>
              <div className="p-3">
                {photo.caption && (
                  <p className="text-sm text-foreground font-medium truncate">
                    {photo.caption}
                  </p>
                )}
                <p className="text-xs text-primary font-mono mt-1">
                  {photo.job?.job_number}
                </p>
                <p className="text-xs text-muted-foreground/60 truncate">
                  {photo.job?.property_address}
                </p>
                <p className="text-xs text-muted-foreground/40 mt-1">
                  {format(new Date(photo.created_at), "MMM d, yyyy")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="rounded-lg p-5 bg-card border border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-[22px] font-semibold tabular-nums mt-1 text-foreground">{value}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-accent-tint flex items-center justify-center">
          <Icon size={22} className="text-accent-text" />
        </div>
      </div>
    </div>
  );
}

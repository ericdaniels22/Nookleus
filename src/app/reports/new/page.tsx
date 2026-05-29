"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  Photo,
  Job,
  PhotoTag,
  PhotoReportTemplate,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  ImageIcon,
  GripVertical,
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildInitialSections,
  type ReportSection,
} from "@/lib/build-initial-sections";
import { toast } from "sonner";
import Link from "next/link";

type Step = 1 | 2 | 3;

export default function NewReportPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-muted-foreground/60">Loading...</div>}>
      <NewReportPageInner />
    </Suspense>
  );
}

function NewReportPageInner() {
  const searchParams = useSearchParams();
  const jobIdParam = searchParams.get("jobId");

  // Data
  const [jobs, setJobs] = useState<Pick<Job, "id" | "job_number" | "property_address" | "claim_number" | "insurance_company">[]>([]);
  const [templates, setTemplates] = useState<PhotoReportTemplate[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tags, setTags] = useState<PhotoTag[]>([]);
  const [photoTags, setPhotoTags] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  // Form state
  const [step, setStep] = useState<Step>(1);
  const [selectedJobId, setSelectedJobId] = useState<string>(jobIdParam ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [reportTitle, setReportTitle] = useState("Photo Report");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [saving, setSaving] = useState(false);

  // Filters for photo selection
  const [photoSearch, setPhotoSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // Fetch jobs + templates on mount
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const [jobsRes, templatesRes, tagsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, job_number, property_address, claim_number, insurance_company")
          .order("created_at", { ascending: false }),
        supabase
          .from("photo_report_templates")
          .select("*")
          .order("name"),
        supabase.from("photo_tags").select("*").order("name"),
      ]);
      if (jobsRes.data) setJobs(jobsRes.data);
      if (templatesRes.data) setTemplates(templatesRes.data as PhotoReportTemplate[]);
      if (tagsRes.data) setTags(tagsRes.data as PhotoTag[]);
      setLoading(false);
    })();
  }, []);

  // Fetch photos when job changes
  const fetchPhotos = useCallback(async () => {
    if (!selectedJobId) {
      setPhotos([]);
      setPhotoTags({});
      return;
    }
    const supabase = createClient();
    const [photosRes, assignmentsRes] = await Promise.all([
      supabase
        .from("photos")
        .select("*")
        .eq("job_id", selectedJobId)
        .eq("media_type", "photo")
        .order("created_at", { ascending: true }),
      supabase
        .from("photo_tag_assignments")
        .select("photo_id, tag_id"),
    ]);

    if (photosRes.data) setPhotos(photosRes.data as Photo[]);

    // Build photo->tag lookup
    if (assignmentsRes.data) {
      const lookup: Record<string, string[]> = {};
      for (const a of assignmentsRes.data) {
        if (!lookup[a.photo_id]) lookup[a.photo_id] = [];
        lookup[a.photo_id].push(a.tag_id);
      }
      setPhotoTags(lookup);
    }
  }, [selectedJobId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  // Choosing a preset pre-fills the section editor from it. A preset only seeds
  // section titles/descriptions — it no longer drives the report title or
  // photos-per-page (photos-per-page is a global setting now; see #361).
  function applyTemplate(templateId: string) {
    // Re-clicking the already-selected preset is a no-op — it would otherwise
    // wipe any edits the user made to the seeded sections.
    if (templateId === selectedTemplateId) return;
    // Picking a preset replaces the current sections wholesale. When the user
    // already has sections (hand-added or seeded from another preset), confirm
    // before discarding that work.
    if (
      sections.length > 0 &&
      !window.confirm(
        "Replace the current sections with this preset? Sections you added or edited will be lost.",
      )
    ) {
      return;
    }
    setSelectedTemplateId(templateId);
    const tmpl = templates.find((t) => t.id === templateId);
    setSections(buildInitialSections(tmpl));
  }

  // Photo filtering
  const filteredPhotos = photos.filter((p) => {
    if (photoSearch) {
      const q = photoSearch.toLowerCase();
      if (!p.caption?.toLowerCase().includes(q)) return false;
    }
    if (roleFilter && p.before_after_role !== roleFilter) return false;
    if (tagFilter && !photoTags[p.id]?.includes(tagFilter)) return false;
    return true;
  });

  function togglePhoto(id: string) {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedPhotoIds(new Set(filteredPhotos.map((p) => p.id)));
  }

  function selectNone() {
    setSelectedPhotoIds(new Set());
  }

  // Section management
  function addPhotoToSection(sectionIndex: number, photoId: string) {
    setSections((prev) => {
      const updated = [...prev];
      // Remove from any other section first
      updated.forEach((s, i) => {
        if (i !== sectionIndex) {
          s.photo_ids = s.photo_ids.filter((id) => id !== photoId);
        }
      });
      // Add to target section if not already there
      if (!updated[sectionIndex].photo_ids.includes(photoId)) {
        updated[sectionIndex] = {
          ...updated[sectionIndex],
          photo_ids: [...updated[sectionIndex].photo_ids, photoId],
        };
      }
      return updated;
    });
  }

  function removePhotoFromSection(sectionIndex: number, photoId: string) {
    setSections((prev) => {
      const updated = [...prev];
      updated[sectionIndex] = {
        ...updated[sectionIndex],
        photo_ids: updated[sectionIndex].photo_ids.filter((id) => id !== photoId),
      };
      return updated;
    });
  }

  // Manual section editing — add, rename, edit description, remove. These let a
  // report be built entirely by hand, with no preset selected.
  function addSection() {
    setSections((prev) => [...prev, { title: "", description: "", photo_ids: [] }]);
  }

  function updateSectionField(
    index: number,
    field: "title" | "description",
    value: string,
  ) {
    setSections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  }

  function removeSection(index: number) {
    setSections((prev) => prev.filter((_, i) => i !== index));
  }

  function autoAssign() {
    // Distribute selected photos evenly across sections
    const ids = Array.from(selectedPhotoIds);
    if (ids.length === 0 || sections.length === 0) return;

    const perSection = Math.ceil(ids.length / sections.length);
    setSections((prev) =>
      prev.map((s, i) => ({
        ...s,
        photo_ids: ids.slice(i * perSection, (i + 1) * perSection),
      }))
    );
    toast.success("Photos distributed across sections");
  }

  // Save as draft
  async function handleSave() {
    if (!selectedJobId) {
      toast.error("Select a job");
      return;
    }
    if (!reportTitle.trim()) {
      toast.error("Enter a report title");
      return;
    }
    if (sections.length === 0) {
      toast.error("Add at least one section");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("photo_reports")
      .insert({
        organization_id: await getActiveOrganizationId(supabase),
        job_id: selectedJobId,
        template_id: selectedTemplateId || null,
        title: reportTitle.trim(),
        sections: sections,
        status: "draft",
      })
      .select("id")
      .single();

    if (error) {
      toast.error("Failed to save report");
      console.error(error);
    } else {
      toast.success("Report saved as draft");
      window.location.href = `/reports`;
    }
    setSaving(false);
  }

  function getPublicUrl(storagePath: string) {
    return `${supabaseUrl}/storage/v1/object/public/photos/${storagePath}`;
  }

  // Step validation. A preset is no longer required to advance — a report needs
  // a job and at least one section (preset-seeded or added by hand). The
  // "at least one section" rule is also re-checked at save time.
  function canProceedToStep2() {
    return Boolean(selectedJobId) && sections.length > 0;
  }

  function canProceedToStep3() {
    return selectedPhotoIds.size > 0;
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground/60">Loading...</div>
    );
  }

  return (
    <div className="max-w-6xl animate-fade-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/reports"
          className="text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-3xl font-extrabold text-foreground">
            <span className="gradient-text">Generate Photo Report</span>
          </h1>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            Step {step} of 3
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[
          { num: 1 as Step, label: "Setup" },
          { num: 2 as Step, label: "Select Photos" },
          { num: 3 as Step, label: "Assign to Sections" },
        ].map((s, i) => (
          <div key={s.num} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={cn(
                  "w-8 h-px",
                  step >= s.num ? "bg-primary" : "bg-border"
                )}
              />
            )}
            <button
              onClick={() => {
                if (s.num === 1) setStep(1);
                else if (s.num === 2 && canProceedToStep2()) setStep(2);
                else if (s.num === 3 && canProceedToStep2() && canProceedToStep3()) setStep(3);
              }}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                step === s.num
                  ? "bg-[image:var(--gradient-primary)] text-white shadow-sm"
                  : step > s.num
                  ? "bg-[#E1F5EE] text-[#085041]"
                  : "bg-muted text-muted-foreground/60"
              )}
            >
              {step > s.num ? <Check size={12} /> : s.num}
              {s.label}
            </button>
          </div>
        ))}
      </div>

      {/* STEP 1: Setup */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Job selection */}
          <div className="bg-card rounded-xl border border-border p-5">
            <label className="block text-sm font-semibold text-foreground mb-2">
              Select Job
            </label>
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="">Choose a job...</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_number} — {j.property_address}
                </option>
              ))}
            </select>
            {selectedJobId && (
              <p className="text-xs text-muted-foreground/60 mt-2">
                {photos.length} photo{photos.length !== 1 ? "s" : ""} available
              </p>
            )}
          </div>

          {/* Section preset selection — optional. Pre-fills section
              titles/descriptions only; sections can also be built by hand. */}
          <div className="bg-card rounded-xl border border-border p-5">
            <label className="block text-sm font-semibold text-foreground mb-1">
              Section Preset{" "}
              <span className="font-normal text-muted-foreground/60">
                (optional)
              </span>
            </label>
            <p className="text-xs text-muted-foreground/60 mb-3">
              Pre-fill sections from a saved preset, or build them by hand below.
            </p>
            {templates.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground/60">
                  No presets yet — add sections by hand below, or{" "}
                  <Link
                    href="/reports/templates"
                    className="text-primary hover:underline"
                  >
                    create a preset
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => applyTemplate(tmpl.id)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all",
                      selectedTemplateId === tmpl.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/30 bg-card"
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {tmpl.name}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5 capitalize">
                      {tmpl.audience} &middot;{" "}
                      {(tmpl.sections as unknown[]).length} sections
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Manual section editor — add / rename / edit description / remove.
              Works whether sections were seeded from a preset or started empty. */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-foreground">
                Sections
              </label>
              <span className="text-xs text-muted-foreground/60">
                {sections.length} section{sections.length !== 1 ? "s" : ""}
              </span>
            </div>
            {sections.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 mb-3">
                No sections yet. Add one below — or pick a preset above — to start
                building your report.
              </p>
            ) : (
              <div className="space-y-3 mb-3">
                {sections.map((section, si) => (
                  <div
                    key={si}
                    className="rounded-lg border border-border p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground/60 w-5 shrink-0">
                        {si + 1}.
                      </span>
                      <Input
                        value={section.title}
                        onChange={(e) =>
                          updateSectionField(si, "title", e.target.value)
                        }
                        placeholder="Section title"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeSection(si)}
                        aria-label="Remove section"
                        className="text-muted-foreground/60 hover:text-red-600 transition-colors p-1.5"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <Input
                      value={section.description}
                      onChange={(e) =>
                        updateSectionField(si, "description", e.target.value)
                      }
                      placeholder="Description (optional)"
                      className="ml-7"
                    />
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addSection}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            >
              <Plus size={14} />
              Add section
            </button>
          </div>

          {/* Report title — always available, defaults to "Photo Report" */}
          <div className="bg-card rounded-xl border border-border p-5">
            <label className="block text-sm font-semibold text-foreground mb-2">
              Report Title
            </label>
            <Input
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="Enter report title..."
            />
          </div>

          {/* Next button */}
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!canProceedToStep2()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Select Photos
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Select Photos */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex flex-col sm:flex-row gap-3 mb-3">
              <div className="relative flex-1">
                <Filter
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <Input
                  value={photoSearch}
                  onChange={(e) => setPhotoSearch(e.target.value)}
                  placeholder="Filter by caption..."
                  className="pl-9"
                />
              </div>
              <select
                value={roleFilter || ""}
                onChange={(e) => setRoleFilter(e.target.value || null)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">All Roles</option>
                <option value="before">Before</option>
                <option value="after">After</option>
              </select>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTagFilter(null)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                    !tagFilter
                      ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                      : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
                  )}
                >
                  All
                </button>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() =>
                      setTagFilter(tagFilter === tag.id ? null : tag.id)
                    }
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                      tagFilter === tag.id
                        ? "text-white border-transparent"
                        : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
                    )}
                    style={
                      tagFilter === tag.id
                        ? { backgroundColor: tag.color }
                        : undefined
                    }
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground/60">
                {selectedPhotoIds.size} of {photos.length} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={selectAll}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Select All
                </button>
                <button
                  onClick={selectNone}
                  className="text-xs text-muted-foreground/60 hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Photo grid */}
          {filteredPhotos.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <ImageIcon size={48} className="mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground/60">No photos match your filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {filteredPhotos.map((photo) => {
                const isSelected = selectedPhotoIds.has(photo.id);
                return (
                  <button
                    key={photo.id}
                    onClick={() => togglePhoto(photo.id)}
                    className={cn(
                      "aspect-square rounded-lg overflow-hidden relative group border-2 transition-all",
                      isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-transparent hover:border-primary/30"
                    )}
                  >
                    <img
                      src={getPublicUrl(
                        photo.annotated_path || photo.storage_path
                      )}
                      alt={photo.caption || "Photo"}
                      className="w-full h-full object-cover"
                    />
                    {/* Selection indicator */}
                    <div
                      className={cn(
                        "absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                        isSelected
                          ? "bg-primary border-primary"
                          : "bg-white/80 border-white/80 group-hover:border-primary/50"
                      )}
                    >
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                    {/* Caption */}
                    {photo.caption && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
                        <p className="text-[9px] text-white truncate">
                          {photo.caption}
                        </p>
                      </div>
                    )}
                    {/* Before/After badge */}
                    {photo.before_after_role && (
                      <Badge
                        className={cn(
                          "absolute top-1.5 left-1.5 text-[8px] px-1 py-0 rounded",
                          photo.before_after_role === "before"
                            ? "bg-[#FCEBEB] text-[#791F1F]"
                            : "bg-[#E1F5EE] text-[#085041]"
                        )}
                      >
                        {photo.before_after_role === "before"
                          ? "Before"
                          : "After"}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent transition-colors"
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!canProceedToStep3()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Assign to Sections
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Assign Photos to Sections */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Auto-assign button */}
          <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {selectedPhotoIds.size} photos selected &middot;{" "}
                {sections.length} sections
              </p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Drag photos into sections below, or auto-distribute evenly.
              </p>
            </div>
            <button
              onClick={autoAssign}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#6C5CE7] text-white hover:bg-[#5B4DB5] transition-colors"
            >
              Auto-Assign
            </button>
          </div>

          {/* Sections with photo assignment */}
          {sections.map((section, si) => {
            const assignedPhotos = section.photo_ids
              .map((id) => photos.find((p) => p.id === id))
              .filter(Boolean) as Photo[];
            const unassigned = Array.from(selectedPhotoIds).filter(
              (id) => !sections.some((s) => s.photo_ids.includes(id))
            );

            return (
              <div
                key={si}
                className="bg-card rounded-xl border border-border p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {si + 1}. {section.title}
                    </h4>
                    {section.description && (
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        {section.description}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground/40">
                    {assignedPhotos.length} photo
                    {assignedPhotos.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Assigned photos */}
                {assignedPhotos.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {assignedPhotos.map((photo) => (
                      <div
                        key={photo.id}
                        className="relative w-20 h-20 rounded-lg overflow-hidden group"
                      >
                        <img
                          src={getPublicUrl(
                            photo.annotated_path || photo.storage_path
                          )}
                          alt={photo.caption || "Photo"}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() =>
                            removePhotoFromSection(si, photo.id)
                          }
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={8} />
                        </button>
                        {photo.caption && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                            <p className="text-[7px] text-white truncate">
                              {photo.caption}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-border rounded-lg py-4 text-center mb-3">
                    <p className="text-xs text-muted-foreground/40">
                      No photos assigned yet
                    </p>
                  </div>
                )}

                {/* Add from unassigned */}
                {unassigned.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground/60 mb-1.5">
                      Add unassigned photos:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {unassigned.slice(0, 12).map((id) => {
                        const photo = photos.find((p) => p.id === id);
                        if (!photo) return null;
                        return (
                          <button
                            key={id}
                            onClick={() => addPhotoToSection(si, id)}
                            className="w-12 h-12 rounded overflow-hidden border border-border hover:border-primary transition-colors relative"
                          >
                            <img
                              src={getPublicUrl(
                                photo.annotated_path || photo.storage_path
                              )}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 flex items-center justify-center transition-colors">
                              <Plus
                                size={12}
                                className="text-white opacity-0 group-hover:opacity-100"
                              />
                            </div>
                          </button>
                        );
                      })}
                      {unassigned.length > 12 && (
                        <span className="text-[10px] text-muted-foreground/60 self-center ml-1">
                          +{unassigned.length - 12} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Navigation + Save */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent transition-colors"
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
            >
              <FileText size={16} />
              {saving ? "Saving..." : "Save Draft Report"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

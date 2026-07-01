"use client";

// Issue #405 — Photo Report Rework: Photo Report template management lives in
// Settings now that the standalone /reports area is gone (ADR 0009). This tab
// lists the Organization's templates, opens the builder to create / edit them,
// deletes them, and seeds the Findings + Work Performed defaults. A template is
// a reusable set of Sections (heading + boilerplate write-up) that seeds a new
// report from the Job Photos tab; "preset" is the retired alias (CONTEXT.md).

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { PhotoReportTemplate } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Layers, Plus, Search, Pencil, Trash2, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import ReportTemplateBuilder from "@/components/report-template-builder";
import { DEFAULT_PHOTO_REPORT_TEMPLATES } from "@/lib/photo-report-template-defaults";

export function PhotoReportTemplatesTab() {
  const [templates, setTemplates] = useState<PhotoReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<PhotoReportTemplate | null>(null);
  // Bumped on every open so the builder re-mounts and its form reseeds from
  // `editingTemplate` — the builder's useState initializers run once per mount,
  // so a persistently-mounted builder would otherwise keep the previous (or
  // empty) template's data (issue #440). Keying the always-mounted builder this
  // way preserves the dialog's open/close animation and focus restoration.
  const [builderSession, setBuilderSession] = useState(0);
  const [seeding, setSeeding] = useState(false);

  const fetchTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("photo_report_templates")
      .select("*")
      .eq("organization_id", await getActiveOrganizationId(supabase))
      .order("created_at", { ascending: false });

    if (data) setTemplates(data as PhotoReportTemplate[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const supabase = createClient();
    const { error } = await supabase
      .from("photo_report_templates")
      .delete()
      .eq("id", id)
      .eq("organization_id", await getActiveOrganizationId(supabase));

    if (error) {
      toast.error("Failed to delete template");
    } else {
      toast.success("Template deleted");
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
    setDeleting(null);
  }

  function handleEdit(template: PhotoReportTemplate) {
    setEditingTemplate(template);
    setBuilderOpen(true);
    setBuilderSession((n) => n + 1);
  }

  function handleCreate() {
    setEditingTemplate(null);
    setBuilderOpen(true);
    setBuilderSession((n) => n + 1);
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    const supabase = createClient();
    const orgId = await getActiveOrganizationId(supabase);
    const seeded = DEFAULT_PHOTO_REPORT_TEMPLATES.map((t) => ({
      ...t,
      organization_id: orgId,
    }));
    const { error } = await supabase
      .from("photo_report_templates")
      .insert(seeded);

    if (error) {
      toast.error("Failed to create default templates");
      console.error(error);
    } else {
      toast.success(
        `${seeded.length} default template${seeded.length !== 1 ? "s" : ""} created`,
      );
      fetchTemplates();
    }
    setSeeding(false);
  }

  const filtered = templates.filter((t) => {
    if (!search) return true;
    return t.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Photo Report Templates
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reusable Sections (headings + boilerplate write-up) that seed a new
            Photo Report. Starting a report from a template stays fully editable.
          </p>
        </div>
        <div className="flex gap-2">
          {templates.length === 0 && !loading && (
            <button
              type="button"
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-border bg-card text-[#6C5CE7] hover:bg-[#F3F0FF] transition-colors disabled:opacity-50"
            >
              <Sparkles size={16} />
              {seeding ? "Creating..." : "Add Defaults"}
            </button>
          )}
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Plus size={16} />
            New Template
          </button>
        </div>
      </div>

      {/* Search */}
      {templates.length > 0 && (
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="pl-9"
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground/60">
          Loading templates...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Layers size={40} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground/60 font-medium">
            {templates.length === 0
              ? "No templates yet"
              : "No templates match your search"}
          </p>
          {templates.length === 0 && (
            <p className="text-muted-foreground/40 text-sm mt-1">
              Create a template or add the Findings / Work Performed starters.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((template) => {
            const sections = (template.sections as unknown[]) || [];
            return (
              <div
                key={template.id}
                className="bg-card rounded-xl border border-border p-4 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#F3F0FF]">
                      <Layers size={20} className="text-[#6C5CE7]" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">
                        {template.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground/60">
                          {sections.length} section
                          {sections.length !== 1 ? "s" : ""}
                        </span>
                        <span className="text-xs text-muted-foreground/40">
                          Created{" "}
                          {format(new Date(template.created_at), "MMM d, yyyy")}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      aria-label={`Edit ${template.name}`}
                      onClick={() => handleEdit(template)}
                      className="p-2 rounded-lg text-muted-foreground/60 hover:text-primary hover:bg-accent transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${template.name}`}
                      onClick={() => handleDelete(template.id, template.name)}
                      disabled={deleting === template.id}
                      className="p-2 rounded-lg text-muted-foreground/60 hover:text-destructive hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ReportTemplateBuilder
        key={builderSession}
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) setEditingTemplate(null);
        }}
        onSaved={fetchTemplates}
        editTemplate={editingTemplate}
      />
    </div>
  );
}

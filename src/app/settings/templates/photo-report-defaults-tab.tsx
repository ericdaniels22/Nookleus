"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase";
import type { PhotoReportTemplate } from "@/lib/types";

export function PhotoReportDefaultsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<PhotoReportTemplate[]>([]);

  const [defaultTemplateId, setDefaultTemplateId] = useState("");
  const [preparerName, setPreparerName] = useState("");
  const [photosPerPage, setPhotosPerPage] = useState("2");
  const [footerText, setFooterText] = useState("");

  const fetchData = useCallback(async () => {
    const [settingsRes, templatesRes] = await Promise.all([
      fetch("/api/settings/company"),
      createClient().from("photo_report_templates").select("*").order("name"),
    ]);

    if (settingsRes.ok) {
      const data = await settingsRes.json();
      setDefaultTemplateId(data.default_report_template || "");
      setPreparerName(data.report_preparer_name || "");
      setPhotosPerPage(data.report_photos_per_page || "2");
      setFooterText(data.report_footer_text || "");
    }

    if (templatesRes.data) {
      setTemplates(templatesRes.data as PhotoReportTemplate[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSave() {
    setSaving(true);
    const res = await fetch("/api/settings/company", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_report_template: defaultTemplateId,
        report_preparer_name: preparerName,
        report_photos_per_page: photosPerPage,
        report_footer_text: footerText,
      }),
    });

    if (res.ok) {
      toast.success("Report defaults saved");
    } else {
      toast.error("Failed to save");
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Report Defaults</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Default settings for new photo reports.
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Default Template
          </label>
          <select
            value={defaultTemplateId}
            onChange={(e) => setDefaultTemplateId(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
          >
            <option value="">None (start blank)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Default Preparer Name
          </label>
          <Input
            value={preparerName}
            onChange={(e) => setPreparerName(e.target.value)}
            placeholder="Eric Daniels"
          />
          <p className="text-[10px] text-muted-foreground mt-1">Auto-fills on new reports</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Default Photos Per Page
          </label>
          <div className="flex gap-2">
            {["1", "2", "4"].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPhotosPerPage(n)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  photosPerPage === n
                    ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                    : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
                }`}
              >
                {n} per page
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Footer Text
          </label>
          <Textarea
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="Custom footer text shown on all report pages..."
            rows={2}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? "Saving..." : "Save Defaults"}
        </button>
      </div>
    </div>
  );
}

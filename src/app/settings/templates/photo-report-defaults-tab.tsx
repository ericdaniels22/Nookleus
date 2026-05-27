"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

// PRD #326 — Photo Report Rework, Slice 6 (#332). The tab used to expose
// four knobs; it now exposes only photos-per-page (1 / 2 / 4, default 2).
// The dropped values (default template, preparer name, footer text) live
// in `company_settings` as key/value rows and are deleted by migration.
export function PhotoReportDefaultsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photosPerPage, setPhotosPerPage] = useState("2");

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/settings/company");
    if (res.ok) {
      const data = await res.json();
      setPhotosPerPage(data.report_photos_per_page || "2");
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
        report_photos_per_page: photosPerPage,
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
            Photos Per Page
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

"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  REPORT_DEFAULT_SETTING_KEYS,
  companySettingsToReportDefault,
  type ReportDetailToggles,
} from "@/lib/photo-report-settings";

// Issue #550 — the Organization's Report layout default (ADR 0014): the seed
// every new report copies. The tab exposes photos-per-page (2 / 3 / 4 — the
// 1-per-page layout was retired) plus the six detail toggles (Section Title
// Pages, Photo numbers, Captured by, Location, Date captured, Photo tags), all
// default on. Each knob is a `company_settings` key/value row under
// REPORT_DEFAULT_SETTING_KEYS; Save writes every key as a string so a new
// report's seed is fully specified, never partially defaulted.

const PHOTOS_PER_PAGE_OPTIONS = ["2", "3", "4"] as const;

// The six detail toggles in display order, with the canonical report labels.
const DETAIL_FIELDS: { field: keyof ReportDetailToggles; label: string }[] = [
  { field: "sectionTitlePages", label: "Section Title Pages" },
  { field: "photoNumbers", label: "Photo numbers" },
  { field: "capturedBy", label: "Captured by" },
  { field: "location", label: "Location" },
  { field: "dateCaptured", label: "Date captured" },
  { field: "photoTags", label: "Photo tags" },
];

const ALL_DETAILS_ON: ReportDetailToggles = {
  sectionTitlePages: true,
  photoNumbers: true,
  capturedBy: true,
  location: true,
  dateCaptured: true,
  photoTags: true,
};

export function PhotoReportDefaultsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photosPerPage, setPhotosPerPage] = useState("2");
  const [details, setDetails] = useState<ReportDetailToggles>(ALL_DETAILS_ON);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/settings/company");
    if (res.ok) {
      const data = await res.json();
      setPhotosPerPage(data.report_photos_per_page || "2");
      // Unset keys fall through to the all-on defaults; a saved "false" reads
      // back as off (parsing handled by companySettingsToReportDefault).
      const saved = companySettingsToReportDefault(data).details;
      setDetails({ ...ALL_DETAILS_ON, ...saved });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSave() {
    setSaving(true);
    const body: Record<string, string> = {
      [REPORT_DEFAULT_SETTING_KEYS.photosPerPage]: photosPerPage,
    };
    for (const { field } of DETAIL_FIELDS) {
      body[REPORT_DEFAULT_SETTING_KEYS[field]] = String(details[field]);
    }

    const res = await fetch("/api/settings/company", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

      <div className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Photos Per Page
          </label>
          <div className="flex gap-2">
            {PHOTOS_PER_PAGE_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={photosPerPage === n}
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
          <span className="block text-xs font-medium text-muted-foreground mb-1">
            Show on photos
          </span>
          <div className="space-y-1">
            {DETAIL_FIELDS.map(({ field, label }) => (
              <label
                key={field}
                className="flex cursor-pointer items-center justify-between rounded-lg px-1 py-2 text-sm text-foreground hover:bg-muted/50"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={details[field]}
                  onChange={() =>
                    setDetails((prev) => ({ ...prev, [field]: !prev[field] }))
                  }
                  className="h-4 w-4 accent-primary"
                />
              </label>
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

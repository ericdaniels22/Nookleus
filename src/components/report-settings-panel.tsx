"use client";

// Issue #550 — the in-builder Report Settings panel behind the top-bar gear.
//
// A thin, controlled slide-over over the report's resolved layout: it shows the
// chosen Photos-per-page density (2 / 3 / 4) and the six detail toggles (ADR
// 0014), and turns each click into the matching builder action
// (`setPhotosPerPage` / `toggleReportField`). It holds no state of its own — the
// reducer owns the settings and auto-save persists them — so editing here flows
// through exactly the same path as every other builder edit. The configurable
// Photo Page Header (Left / Center / Right) of the original sketch was dropped
// (#550); it is intentionally not here.

import { useEffect } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PhotoReportBuilderAction } from "@/lib/photo-report-builder";
import type { ReportDetailToggles } from "@/lib/photo-report-settings";
import type { ReportPhotosPerPage } from "@/lib/types";

const PHOTOS_PER_PAGE_OPTIONS: ReportPhotosPerPage[] = [2, 3, 4];

// The six detail toggles in display order, with the labels the report uses for
// each (the canonical names from #550 / ADR 0014).
const DETAIL_FIELDS: { field: keyof ReportDetailToggles; label: string }[] = [
  { field: "sectionTitlePages", label: "Section Title Pages" },
  { field: "photoNumbers", label: "Photo numbers" },
  { field: "capturedBy", label: "Captured by" },
  { field: "location", label: "Location" },
  { field: "dateCaptured", label: "Date captured" },
  { field: "photoTags", label: "Photo tags" },
];

interface ReportSettingsPanelProps {
  photosPerPage: ReportPhotosPerPage;
  details: ReportDetailToggles;
  dispatch: React.Dispatch<PhotoReportBuilderAction>;
  onClose: () => void;
}

export default function ReportSettingsPanel({
  photosPerPage,
  details,
  dispatch,
  onClose,
}: ReportSettingsPanelProps) {
  // Escape closes the dialog from anywhere — the standard modal affordance
  // (WCAG 2.1 Level A). A document-level listener catches it wherever focus
  // sits; the keydown bubbles, so a key pressed inside the panel reaches it too.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop — click anywhere off the panel to dismiss. It is purely
          decorative (aria-hidden): keyboard users dismiss via Escape (above) or
          the header's Close button, so it stays out of the tab/reader order. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Report settings"
        className="relative z-10 flex h-full w-80 max-w-[90vw] flex-col overflow-y-auto border-l border-border bg-card shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Report Settings
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-6 px-4 py-4">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Photos per page
            </span>
            <div className="flex gap-2">
              {PHOTOS_PER_PAGE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={photosPerPage === n}
                  onClick={() =>
                    dispatch({ type: "setPhotosPerPage", photosPerPage: n })
                  }
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                    photosPerPage === n
                      ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                      : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm",
                  )}
                >
                  {n} per page
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Show on photos
            </span>
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
                    dispatch({ type: "toggleReportField", field })
                  }
                  className="h-4 w-4 accent-primary"
                />
              </label>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

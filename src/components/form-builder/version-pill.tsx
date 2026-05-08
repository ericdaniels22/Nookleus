"use client";

import { useEffect, useRef, useState } from "react";
import { Check, AlertTriangle, History, Loader2, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import type { SaveStatus } from "./use-form-config";

interface VersionRow {
  version: number;
  created_by: string | null;
  created_at: string;
}

export function VersionPill({
  status,
  onRetry,
  onRestoreSuccess,
}: {
  status: SaveStatus;
  onRetry: () => void;
  onRestoreSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function loadVersions() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/intake-form/versions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch {
      toast.error("Failed to load version history");
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(version: number) {
    if (!confirm(`Restore form to version ${version}? This adds a new version with the old config — nothing is deleted.`)) {
      return;
    }
    try {
      const res = await fetch("/api/settings/intake-form/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Restored from version ${version}`);
      setOpen(false);
      onRestoreSuccess();
    } catch {
      toast.error("Restore failed");
    }
  }

  function StatusBadge() {
    switch (status.kind) {
      case "saving":
        return (
          <>
            <Loader2 size={12} className="animate-spin" />
            <span>Saving…</span>
          </>
        );
      case "dirty":
        return <span className="text-muted-foreground">Unsaved changes</span>;
      case "error":
        return (
          <>
            <AlertTriangle size={12} className="text-destructive" />
            <span className="text-destructive">Save failed</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              className="underline ml-1"
            >
              Retry
            </button>
          </>
        );
      case "idle":
        return (
          <>
            <Check size={12} className="text-emerald-500" />
            <span>Saved</span>
          </>
        );
    }
  }

  function togglePill() {
    if (!open) loadVersions();
    setOpen(!open);
  }

  return (
    <div ref={ref} className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={togglePill}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePill();
          }
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-card hover:bg-muted/50 transition-colors cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40"
      >
        <StatusBadge />
        <History size={12} className="text-muted-foreground ml-1" />
      </div>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-popover shadow-lg z-50">
          <div className="px-3 py-2 border-b border-border">
            <h4 className="text-xs font-semibold text-foreground">Version History</h4>
            <p className="text-[11px] text-muted-foreground">
              Last 20 saved versions. Restoring creates a new version.
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading && (
              <div className="text-center text-xs text-muted-foreground py-4">Loading…</div>
            )}
            {!loading && versions && versions.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-4">No history yet.</div>
            )}
            {!loading &&
              versions?.map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">
                      Version {v.version}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                      {v.created_by ? ` · ${v.created_by}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(v.version)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
                    title="Restore this version"
                  >
                    <RotateCcw size={11} />
                    Restore
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

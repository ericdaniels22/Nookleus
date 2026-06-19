"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { rankPickerJobs, type PickerJob } from "@/lib/job-picker";
import ClockInConfirmation from "@/components/time/clock-in-confirmation";

// The active-Job picker (issue #701, AC2). Opened from the home-screen control,
// it loads the Jobs a worker can clock into plus their recently-clocked order,
// filters/ranks them as the worker types (the pure rankPickerJobs), and on
// selection raises the full-screen confirmation that commits the clock-in.

interface ClockableJobsResponse {
  jobs: PickerJob[];
  recentJobIds: string[];
}

export default function ClockInPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<PickerJob[]>([]);
  const [recentJobIds, setRecentJobIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PickerJob | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset for the next open so a stale query/selection never lingers.
      setQuery("");
      setSelected(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/time/clockable-jobs");
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as ClockableJobsResponse;
        if (cancelled) return;
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setRecentJobIds(Array.isArray(data.recentJobIds) ? data.recentJobIds : []);
      } catch {
        if (!cancelled) {
          setJobs([]);
          setRecentJobIds([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const ranked = rankPickerJobs(jobs, { query, recentJobIds });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clock in to a Job</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <Search size={16} className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by address, customer, or Job number…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                Loading Jobs…
              </p>
            ) : ranked.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                {jobs.length === 0 ? "No active Jobs" : "No matching Jobs"}
              </p>
            ) : (
              <ul className="flex flex-col">
                {ranked.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(job)}
                      className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left hover:bg-muted/60"
                    >
                      <span className="font-medium text-foreground">
                        {job.property_address}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Job {job.job_number}
                        {job.contact?.full_name ? ` · ${job.contact.full_name}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {selected && (
        <ClockInConfirmation
          job={selected}
          onClose={(started) => {
            setSelected(null);
            if (started) onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

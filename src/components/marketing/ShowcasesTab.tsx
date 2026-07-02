"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Megaphone, Images, Loader2, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { requestCreateShowcase } from "@/lib/showcase-create-request";
import { toast } from "sonner";

// The Showcases tab of the Marketing area (#613). Two lists, both served by
// GET /api/marketing/showcases:
//   * "Ready to showcase" — recently-completed Jobs with no Showcase yet, the
//     nudge. One click creates a blank draft and drops the admin in its builder.
//   * "Your showcases" — the Org's live Showcases, each linking to its builder.

interface ShowcaseJob {
  id: string;
  job_number: string | null;
  contact?: { full_name: string | null } | null;
}

interface ShowcaseRow {
  id: string;
  job_id: string;
  title: string | null;
  status: "draft" | "published";
  photo_ids: string[];
  job?: ShowcaseJob | null;
}

interface NudgeRow {
  id: string;
  job_number: string | null;
  updated_at: string;
  contact?: { full_name: string | null } | null;
}

function jobLabel(
  jobNumber: string | null | undefined,
  contact: { full_name: string | null } | null | undefined,
): string {
  const name = contact?.full_name?.trim();
  return name || jobNumber || "Untitled job";
}

export default function ShowcasesTab() {
  const router = useRouter();
  const [showcases, setShowcases] = useState<ShowcaseRow[]>([]);
  const [nudges, setNudges] = useState<NudgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  // The Job id whose "Create showcase" is mid-flight, so only its button spins.
  const [creatingJobId, setCreatingJobId] = useState<string | null>(null);

  const fetchShowcases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/marketing/showcases");
      // A 403/500 still carries a JSON body, so res.json() wouldn't throw — guard
      // on res.ok so a real backend error surfaces the toast instead of silently
      // rendering the "No showcases yet" empty state as if the load succeeded.
      if (!res.ok) throw new Error("Failed to load showcases");
      const data = await res.json();
      setShowcases(data.showcases || []);
      setNudges(data.nudges || []);
    } catch {
      toast.error("Couldn't load showcases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShowcases();
  }, [fetchShowcases]);

  async function createFromNudge(jobId: string) {
    setCreatingJobId(jobId);
    try {
      const created = await requestCreateShowcase(jobId);
      router.push(`/jobs/${jobId}/showcases/${created.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't create the showcase.",
      );
      setCreatingJobId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Loading showcases...
      </p>
    );
  }

  return (
    <div className="p-6 space-y-8">
      {/* Nudge: recently-completed Jobs with no Showcase yet. */}
      {nudges.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Ready to showcase
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            These jobs wrapped up recently and don&apos;t have a showcase yet.
          </p>
          <div className="space-y-2">
            {nudges.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:border-primary/30 transition-colors"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {jobLabel(job.job_number, job.contact)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Completed {format(new Date(job.updated_at), "MMM d, yyyy")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => createFromNudge(job.id)}
                  disabled={creatingJobId === job.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-tint px-3 py-1.5 text-sm font-medium text-accent-text border border-primary/30 hover:brightness-125 transition-colors disabled:opacity-60"
                >
                  {creatingJobId === job.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Megaphone size={14} />
                      Create showcase
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The Org's live Showcases. */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Your showcases
        </h2>
        {showcases.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <Images className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm text-muted-foreground mb-1">No showcases yet</p>
            <p className="text-xs text-muted-foreground/60">
              Pick a completed job above and build its story from the job&apos;s
              photos.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {showcases.map((showcase) => (
              <Link
                key={showcase.id}
                href={`/jobs/${showcase.job_id}/showcases/${showcase.id}`}
                className="group rounded-xl border bg-card p-4 transition hover:border-primary/30"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Badge
                    variant={showcase.status === "published" ? undefined : "outline"}
                    className={
                      showcase.status === "published"
                        ? "bg-accent-tint text-accent-text border-primary/30"
                        : undefined
                    }
                  >
                    {showcase.status === "published" ? "Published" : "Draft"}
                  </Badge>
                  <ArrowRight
                    size={16}
                    className="text-muted-foreground/40 group-hover:text-accent-text transition-colors"
                  />
                </div>
                <p className="truncate text-sm font-medium text-foreground">
                  {showcase.title || "Untitled showcase"}
                </p>
                <p className="truncate text-xs text-muted-foreground mt-0.5">
                  {jobLabel(showcase.job?.job_number, showcase.job?.contact)}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  {showcase.photo_ids.length}{" "}
                  {showcase.photo_ids.length === 1 ? "photo" : "photos"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

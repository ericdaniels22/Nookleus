"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  deriveShowcasePublishState,
  type ShowcasePublishView,
} from "@/lib/website/showcase-publish-state";
import type { Showcase } from "@/lib/types";

// #606 — the publish controls in the Showcase builder. A Showcase is pushed to
// the Organization's public WordPress site as one post in the Projects category;
// this panel owns the publish state badge, the live-post link, the one-click
// consent affirmation that gates Publish (AC#1), and the distinct, visible error
// the route hands back (AC#5). The heavy lifting — the privacy scrub, the
// create-vs-update, the error mapping — all lives server-side in the publish
// route; the panel renders its outcome.

interface ShowcasePublishPanelProps {
  jobId: string;
  showcase: Showcase;
}

export default function ShowcasePublishPanel({
  jobId,
  showcase,
}: ShowcasePublishPanelProps) {
  const [view, setView] = useState<ShowcasePublishView>(() =>
    deriveShowcasePublishState(showcase),
  );
  const [consent, setConsent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // The route hands back a distinct, actionable message per failure (revoked
  // credential vs unreachable site vs a privacy-scrub block) — render it
  // verbatim so the admin sees exactly which thing to fix (AC#5).
  const [error, setError] = useState<{
    message: string;
    violations?: { field: string; match: string }[];
  } | null>(null);

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/showcases/${showcase.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent: true }),
        },
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setView(data as ShowcasePublishView);
        return;
      }
      setError({
        message:
          (data && typeof data.message === "string" && data.message) ||
          "Couldn't publish this Showcase. Try again.",
        violations: data?.violations,
      });
    } catch {
      setError({ message: "Couldn't reach the server. Try again." });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Website
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {view.state === "published" ? "Published" : "Draft"}
        </span>
        {view.state === "published" && view.liveUrl && (
          <a
            href={view.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-[#2B5EA7] hover:underline"
          >
            View live post
          </a>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>I have the customer&apos;s OK to show these photos</span>
      </label>

      <button
        type="button"
        onClick={handlePublish}
        disabled={!consent || publishing}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {publishing && <Loader2 size={14} className="animate-spin" />}
        {view.state === "published" ? "Re-publish" : "Publish"}
      </button>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <p>{error.message}</p>
          {error.violations && error.violations.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {error.violations.map((v, i) => (
                <li key={`${v.field}-${i}`}>{v.match}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

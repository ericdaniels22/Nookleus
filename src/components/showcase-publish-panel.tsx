"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  deriveShowcasePublishState,
  type ShowcasePublishView,
} from "@/lib/website/showcase-publish-state";
import {
  deriveShowcaseGbpPublishState,
  type ShowcaseGbpPublishView,
} from "@/lib/google/showcase-gbp-state";
import type { Showcase } from "@/lib/types";

// #606 / #609 — the publish controls in the Showcase builder. A Showcase is
// pushed to TWO independent channels: the Organization's public WordPress site
// (one post in the Projects category) and its Google Business Profile (one local
// post with a lead photo). Each channel is its own labeled row with its own
// state badge, live-post link, Publish button, and distinct error (AC#3, AC#5),
// but both share the SINGLE one-click consent affirmation that gates publishing
// (AC#4 — the same customer-OK gate). The heavy lifting — the privacy scrub, the
// create-vs-update, the error mapping — lives server-side in each publish route;
// the panel renders the outcome of whichever channel was acted on.

interface ShowcasePublishPanelProps {
  jobId: string;
  showcase: Showcase;
}

type PublishError = {
  message: string;
  violations?: { field: string; match: string }[];
} | null;

export default function ShowcasePublishPanel({
  jobId,
  showcase,
}: ShowcasePublishPanelProps) {
  const [view, setView] = useState<ShowcasePublishView>(() =>
    deriveShowcasePublishState(showcase),
  );
  const [gbpView, setGbpView] = useState<ShowcaseGbpPublishView>(() =>
    deriveShowcaseGbpPublishState(showcase),
  );
  const [consent, setConsent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [gbpPublishing, setGbpPublishing] = useState(false);
  // The route hands back a distinct, actionable message per failure (revoked
  // credential vs unreachable site vs a privacy-scrub block) — render it
  // verbatim so the admin sees exactly which thing to fix (AC#5).
  const [error, setError] = useState<PublishError>(null);
  // The GBP channel surfaces its OWN distinct failure (not_connected vs
  // permission-denied vs unreachable) separately from the website's (AC#3, AC#5).
  const [gbpError, setGbpError] = useState<PublishError>(null);

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

  const handleGbpPublish = async () => {
    setGbpPublishing(true);
    setGbpError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/showcases/${showcase.id}/publish-gbp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent: true }),
        },
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setGbpView(data as ShowcaseGbpPublishView);
        return;
      }
      setGbpError({
        message:
          (data && typeof data.message === "string" && data.message) ||
          "Couldn't publish this Showcase to your Business Profile. Try again.",
        violations: data?.violations,
      });
    } catch {
      setGbpError({ message: "Couldn't reach the server. Try again." });
    } finally {
      setGbpPublishing(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>I have the customer&apos;s OK to show these photos</span>
      </label>

      <div role="group" aria-label="Website" className="space-y-2">
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

        <button
          type="button"
          onClick={handlePublish}
          disabled={!consent || publishing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {publishing && <Loader2 size={14} className="animate-spin" />}
          {view.state === "published"
            ? "Re-publish to website"
            : "Publish to website"}
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
      </div>

      <div
        role="group"
        aria-label="Google Business Profile"
        className="space-y-2"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Google Business Profile
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {gbpView.state === "published" ? "Published" : "Draft"}
          </span>
          {gbpView.state === "published" && gbpView.liveUrl && (
            <a
              href={gbpView.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[#2B5EA7] hover:underline"
            >
              View on Google
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={handleGbpPublish}
          disabled={!consent || gbpPublishing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-transparent text-text-secondary hover:bg-muted hover:text-foreground px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {gbpPublishing && <Loader2 size={14} className="animate-spin" />}
          {gbpView.state === "published"
            ? "Re-publish to Google Business Profile"
            : "Publish to Google Business Profile"}
        </button>

        {gbpError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <p>{gbpError.message}</p>
            {gbpError.violations && gbpError.violations.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {gbpError.violations.map((v, i) => (
                  <li key={`${v.field}-${i}`}>{v.match}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

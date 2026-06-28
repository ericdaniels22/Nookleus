"use client";

import { AlertTriangle } from "lucide-react";
import type { GoogleConnectionSummary } from "@/lib/google/types";
import {
  marketingGoogleIndicator,
  type MarketingGoogleIndicator,
} from "@/lib/google/connection";

// #789 — a proactive banner on the Marketing page for the per-org Google
// connection. While the consent screen is in Testing, Google expires the
// business.manage refresh token 7 days after consent, silently breaking the
// connection. This warns before that happens (amber within two days, red once
// expired or already broken) and offers a one-click reconnect. It renders
// nothing while the token is healthy — the header dot carries the quiet signal —
// and nothing at all once the app is published to Production (token_expires_at
// is null then, so the indicator resolves to 'none'). The when-to-show decision
// lives in marketingGoogleIndicator() (unit-tested); this is just presentation.
// nowMs is passed in (not read from Date.now() here) so render stays pure — the
// page snapshots the time in an effect.
export default function GoogleTokenBanner({
  summary,
  nowMs,
}: {
  summary: Pick<GoogleConnectionSummary, "state" | "token_expires_at"> | null;
  nowMs: number;
}) {
  const indicator = marketingGoogleIndicator(summary, nowMs);
  if (indicator.kind === "none" || indicator.kind === "ok") return null;

  const copy = bannerCopy(indicator);

  return (
    <div
      role="alert"
      className={`shrink-0 flex items-start gap-3 px-4 py-3 border-b ${copy.tone}`}
    >
      <AlertTriangle size={18} className={`${copy.icon} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="text-sm opacity-80 mt-0.5">{copy.body}</p>
      </div>
      <a
        href="/api/google/authorize"
        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4285F4] text-white text-sm font-medium hover:brightness-110 shadow-sm transition-all"
      >
        Reconnect Google
      </a>
    </div>
  );
}

function bannerCopy(
  indicator: Extract<
    MarketingGoogleIndicator,
    { kind: "expiring" | "expired" | "broken" }
  >,
): { tone: string; icon: string; title: string; body: string } {
  if (indicator.kind === "expiring") {
    const d = indicator.daysRemaining;
    return {
      tone: "border-amber-500/30 bg-amber-500/10 text-amber-700",
      icon: "text-amber-500",
      title: `Google connection expires in ${d} day${d === 1 ? "" : "s"}`,
      body: "Reconnect now to keep posts, reviews, and the marketing tools working without interruption.",
    };
  }
  if (indicator.kind === "expired") {
    return {
      tone: "border-red-500/30 bg-red-500/10 text-red-700",
      icon: "text-red-500",
      title: "Google connection expired",
      body: "Your Google access has lapsed. Reconnect to restore posts, reviews, and the marketing tools.",
    };
  }
  return {
    tone: "border-red-500/30 bg-red-500/10 text-red-700",
    icon: "text-red-500",
    title: "Google connection needs reconnecting",
    body: "Access was revoked or expired. Reconnect to resume the Google-powered marketing tools.",
  };
}

"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Megaphone } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MarketingChatTab from "@/components/marketing/MarketingChatTab";
import SocialMediaTab from "@/components/marketing/SocialMediaTab";
import ShowcasesTab from "@/components/marketing/ShowcasesTab";
import MarketingReviewsTab from "@/components/marketing/MarketingReviewsTab";
import MarketingInsightsTab from "@/components/marketing/MarketingInsightsTab";
import GoogleTokenBanner from "@/components/marketing/GoogleTokenBanner";
import { marketingGoogleIndicator } from "@/lib/google/connection";
import type { GoogleConnectionSummary } from "@/lib/google/types";

export default function MarketingPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  // The per-org Google connection, for the 7-day-token indicator (#789). Fetched
  // client-side from the admin-only summary endpoint; a failure just means no
  // banner (the marketing tools still load). nowMs is snapshotted in effects (not
  // read during render) so the render stays pure; the countdown is coarse (days),
  // so a snapshot is accurate enough. It stays 0 until the fetch resolves, which
  // is harmless: with no connection the indicator is always "none".
  const [connection, setConnection] = useState<GoogleConnectionSummary | null>(null);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/google/connection");
        if (!res.ok) return;
        const data = (await res.json()) as GoogleConnectionSummary;
        if (!cancelled) {
          setConnection(data);
          setNowMs(Date.now());
        }
      } catch {
        // non-blocking — leave the indicator silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // Keep the countdown live on a long-open tab: re-snapshot the clock hourly so
  // the indicator can cross the expiring/expired thresholds without a reload.
  // The display is day-coarse, so hourly is plenty. This runs in a timer callback
  // (not the effect body), so it sidesteps react-hooks/set-state-in-effect, and
  // it never reads Date.now() during render.
  useEffect(() => {
    if (!isAdmin) return;
    const id = setInterval(() => setNowMs(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">You don&apos;t have access to the Marketing page.</p>
      </div>
    );
  }

  // The header dot carries the quiet, always-on signal; the banner below it is
  // the loud one that only appears when a reconnect is actually needed.
  const indicator = marketingGoogleIndicator(connection, nowMs);
  const dotClass =
    indicator.kind === "expired" || indicator.kind === "broken"
      ? "bg-red-500"
      : indicator.kind === "expiring"
        ? "bg-amber-400"
        : "bg-teal-400";
  const dotTitle =
    indicator.kind === "expired"
      ? "Google connection expired — reconnect"
      : indicator.kind === "broken"
        ? "Google connection needs reconnecting"
        : indicator.kind === "expiring"
          ? `Google connection expires in ${indicator.daysRemaining} day${indicator.daysRemaining === 1 ? "" : "s"}`
          : indicator.kind === "ok"
            ? `Google connected — ${indicator.daysRemaining} day${indicator.daysRemaining === 1 ? "" : "s"} left`
            : "Active";

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:h-screen flex flex-col -m-6 lg:-m-8">
      <Tabs defaultValue={0} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-teal-500/20 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone size={20} className="text-teal-400" />
            <h1 className="text-lg font-semibold text-foreground">Marketing</h1>
            <span className={`w-2 h-2 rounded-full ${dotClass}`} title={dotTitle} />
          </div>
          <TabsList>
            <TabsTrigger value={0}>Social Media</TabsTrigger>
            <TabsTrigger value={1}>Showcases</TabsTrigger>
            <TabsTrigger value={2}>Reviews</TabsTrigger>
            <TabsTrigger value={3}>Insights</TabsTrigger>
            <TabsTrigger value={4}>Chat</TabsTrigger>
          </TabsList>
        </div>

        {/* 7-day-token reconnect warning (#789) — silent unless action is needed */}
        <GoogleTokenBanner summary={connection} nowMs={nowMs} />

        {/* Tab content */}
        <TabsContent value={0} className="flex-1 min-h-0 overflow-y-auto">
          <SocialMediaTab />
        </TabsContent>
        <TabsContent value={1} className="flex-1 min-h-0 overflow-y-auto">
          <ShowcasesTab />
        </TabsContent>
        <TabsContent value={2} className="flex-1 min-h-0 overflow-y-auto">
          <MarketingReviewsTab />
        </TabsContent>
        <TabsContent value={3} className="flex-1 min-h-0 overflow-y-auto">
          <MarketingInsightsTab />
        </TabsContent>
        <TabsContent value={4} className="flex-1 min-h-0">
          <MarketingChatTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { GoogleConnectionSummary } from "@/lib/google/types";

// The Google connection card: one of three states — disconnected (Connect),
// connected (account + Disconnect), or broken (reconnect prompt). All token
// material stays server-side; this only ever sees the token-free summary.
export default function GoogleConnectionCard({
  initial,
  configured,
}: {
  initial: GoogleConnectionSummary;
  // Whether the server has the OAuth client credentials (#611). When false the
  // flow can't start, so we surface that instead of a Connect button that would
  // bounce straight back with ?google_error=not_configured.
  configured: boolean;
}) {
  const [summary, setSummary] = useState<GoogleConnectionSummary>(initial);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/google/connection");
    if (!res.ok) return;
    setSummary((await res.json()) as GoogleConnectionSummary);
  }, []);

  // Surface the OAuth round-trip result the callback redirected back with.
  useEffect(() => {
    if (searchParams.get("google") === "connected") {
      toast.success("Google account connected.");
    }
    const err = searchParams.get("google_error");
    if (err === "not_configured") {
      toast.error("Google sign-in isn't set up on this server yet.");
    } else if (err) {
      toast.error(`Google connection failed: ${err.replace(/_/g, " ")}`);
    }
  }, [searchParams]);

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnecting revokes Nookleus's access to your Google account and removes the stored credential. Reviews and other Google features will stop until you reconnect.",
      )
    )
      return;
    setDisconnecting(true);
    const res = await fetch("/api/google/disconnect", { method: "POST" });
    if (res.ok) {
      toast.success("Disconnected from Google.");
      await refresh();
    } else {
      toast.error("Failed to disconnect");
    }
    setDisconnecting(false);
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-lg bg-accent-tint flex items-center justify-center shrink-0">
          <span className="text-2xl font-bold text-accent-text">G</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-foreground">Google</h2>
            <StatusBadge state={summary.state} />
          </div>

          {/* Disconnected — invite to connect. */}
          {summary.state === "disconnected" && (
            <>
              <p className="text-sm text-muted-foreground mt-1">
                Connect your company&apos;s Google account once to bring Business
                Profile reviews, posts, and performance into Nookleus. You control
                this link and can disconnect any time.
              </p>
              {configured ? (
                <a
                  href="/api/google/authorize"
                  className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 shadow-sm transition-all"
                >
                  Connect Google
                </a>
              ) : (
                <p className="text-xs text-muted-foreground/70 mt-4">
                  Google sign-in isn&apos;t set up on this server yet — the Google
                  connection setup has to be finished before an account can be
                  linked.
                </p>
              )}
            </>
          )}

          {/* Connected — show the account + disconnect. */}
          {summary.state === "connected" && (
            <>
              <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 size={18} className="text-primary shrink-0" />
                <span className="truncate">
                  Connected{summary.account_email ? ` as ${summary.account_email}` : ""}
                </span>
              </div>
              {summary.connected_at && (
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Linked {new Date(summary.connected_at).toLocaleDateString()}
                </p>
              )}
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 disabled:opacity-50"
              >
                {disconnecting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Disconnect
              </button>
            </>
          )}

          {/* Broken — credential revoked/expired remotely; prompt to reconnect. */}
          {summary.state === "broken" && (
            <>
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Google connection needs reconnecting
                  </p>
                  <p className="text-sm text-destructive/80 mt-0.5">
                    Access was revoked or expired
                    {summary.account_email ? ` for ${summary.account_email}` : ""}.
                    Reconnect to resume Google features.
                  </p>
                </div>
              </div>
              <a
                href="/api/google/authorize"
                className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 shadow-sm transition-all"
              >
                Reconnect Google
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: GoogleConnectionSummary["state"] }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Connected
      </span>
    );
  }
  if (state === "broken") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
        <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> Needs reconnect
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      Not connected
    </span>
  );
}

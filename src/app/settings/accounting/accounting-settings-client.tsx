"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import PreLaunchChecklist from "@/components/accounting/pre-launch-checklist";

interface ConnectionSummary {
  id: string;
  company_name: string | null;
  realm_id: string;
  sync_start_date: string | null;
  setup_completed_at: string | null;
  dry_run_mode: boolean;
  is_active: boolean;
  last_sync_at: string | null;
  refresh_token_expires_at: string;
}

export default function AccountingSettingsClient({
  initialConnection,
}: {
  initialConnection: ConnectionSummary | null;
}) {
  const [conn, setConn] = useState<ConnectionSummary | null>(initialConnection);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglingDryRun, setTogglingDryRun] = useState(false);
  const [showGoLive, setShowGoLive] = useState<"step1" | "step2" | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const searchParams = useSearchParams();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/qb/connection");
    if (!res.ok) return;
    const data = (await res.json()) as { connected: boolean } & ConnectionSummary;
    setConn(data.connected ? data : null);
  }, []);

  useEffect(() => {
    const err = searchParams.get("oauth_error");
    if (err) {
      toast.error(`QuickBooks connection failed: ${err.replace(/_/g, " ")}`);
    }
  }, [searchParams]);

  async function handleDisconnect() {
    if (!confirm(
      "Disconnecting will stop all QuickBooks sync. Previously synced records in QuickBooks will remain but no further changes will be pushed. You can reconnect at any time.",
    )) return;
    setDisconnecting(true);
    const res = await fetch("/api/qb/disconnect", { method: "POST" });
    if (res.ok) {
      toast.success("Disconnected from QuickBooks.");
      await refresh();
    } else {
      toast.error("Failed to disconnect");
    }
    setDisconnecting(false);
  }

  async function handleGoLive() {
    if (confirmText !== "CONFIRM") {
      toast.error('Type "CONFIRM" exactly to proceed');
      return;
    }
    setTogglingDryRun(true);
    const res = await fetch("/api/qb/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run_mode: false }),
    });
    if (res.ok) {
      toast.success("Live mode enabled. Sync will now write to QuickBooks.");
      setShowGoLive(null);
      setConfirmText("");
      await refresh();
    } else {
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      toast.error(`Failed to enable live mode: ${data.error}`);
    }
    setTogglingDryRun(false);
  }

  const setupIncomplete = conn?.is_active && !conn.setup_completed_at;
  // One-shot mount time — good enough for an "expired banner" check and
  // keeps render pure (lint rule react-hooks/purity).
  const [mountedAt] = useState(() => Date.now());
  const refreshExpired =
    !!conn && !conn.is_active &&
    Date.parse(conn.refresh_token_expires_at) < mountedAt;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-foreground flex items-center gap-2">
          <Link2 size={24} /> QuickBooks Integration
        </h1>
        <p className="text-muted-foreground mt-1">
          Connect your QuickBooks Online account to sync customers, invoices, and payments.
        </p>
      </div>

      {/* Not connected yet */}
      {!conn?.is_active && (
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-[#2CA01C]/10 flex items-center justify-center">
              <span className="text-2xl font-bold text-[#2CA01C]">qb</span>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-foreground">Connect to QuickBooks</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Connecting will allow Nookleus to create customers, invoices, and payments in your QuickBooks Online account. You&apos;ll configure a start date and review mappings before anything syncs.
              </p>
              <a
                href="/api/qb/authorize"
                className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-lg bg-[#2CA01C] text-white text-sm font-medium hover:brightness-110 shadow-sm transition-all"
              >
                <Link2 size={16} /> Connect to QuickBooks
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Connected, setup incomplete */}
      {conn?.is_active && setupIncomplete && (
        <div className="bg-card rounded-xl border border-amber-300 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-500 shrink-0" size={22} />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-foreground">Finish setup</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Connected to <span className="font-medium">{conn.company_name ?? conn.realm_id}</span>. One more step: pick a sync start date and map damage types and payment methods to QuickBooks accounts.
              </p>
              <Link
                href="/settings/accounting/setup"
                className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-lg bg-[var(--brand-primary,#0F6E56)] text-white text-sm font-medium hover:brightness-110 shadow-sm transition-all"
              >
                <SettingsIcon size={16} /> Continue setup
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Connected, setup complete */}
      {conn?.is_active && !setupIncomplete && (
        <div className="space-y-4">
          {/* Status card */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#2CA01C]/10 flex items-center justify-center">
                  <CheckCircle2 size={22} className="text-[#2CA01C]" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Connected</p>
                  <p className="text-sm text-muted-foreground">
                    {conn.company_name ?? "QuickBooks Online"} · Realm {conn.realm_id}
                  </p>
                  {conn.last_sync_at && (
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Last sync {timeAgo(conn.last_sync_at)}
                    </p>
                  )}
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-green-500/10 text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Active
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>Sync start date: <span className="text-foreground">{conn.sync_start_date}</span></div>
              <div>Setup completed: <span className="text-foreground">{conn.setup_completed_at ? new Date(conn.setup_completed_at).toLocaleDateString() : "—"}</span></div>
            </div>
          </div>

          {conn.dry_run_mode && <PreLaunchChecklist />}

          {/* Dry-run toggle */}
          <div className={`bg-card rounded-xl border p-5 ${conn.dry_run_mode ? "border-amber-300" : "border-border"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">Dry-run mode</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${conn.dry_run_mode ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"}`}>
                    {conn.dry_run_mode ? "ON" : "OFF"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {conn.dry_run_mode
                    ? "Nothing is being written to QuickBooks. Review the log on the Accounting page's QuickBooks tab."
                    : "Live mode is enabled. Sync writes to QuickBooks. To re-enable dry run, disconnect and reconnect."}
                </p>
              </div>
              {conn.dry_run_mode && (
                <button
                  onClick={() => setShowGoLive("step1")}
                  className="shrink-0 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent"
                >
                  Switch to live mode
                </button>
              )}
            </div>
          </div>

          {/* Mapping link */}
          <Link
            href="/settings/accounting/setup?tab=mappings"
            className="block bg-card rounded-xl border border-border p-5 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">Edit mappings</p>
                <p className="text-sm text-muted-foreground">Damage types → QB Classes, payment methods → deposit accounts</p>
              </div>
              <RefreshCw size={18} className="text-muted-foreground" />
            </div>
          </Link>

          {/* Disconnect */}
          <div className="bg-card rounded-xl border border-red-500/20 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-foreground">Disconnect</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Stops sync but keeps history. Reconnect at any time.
                </p>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="shrink-0 px-4 py-2 rounded-lg bg-red-500/10 text-red-600 text-sm font-medium hover:bg-red-500/20 disabled:opacity-50 flex items-center gap-2"
              >
                {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reconnect required */}
      {!conn?.is_active && refreshExpired && (
        <div className="mt-4 bg-red-500/10 rounded-xl border border-red-500/30 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-500 shrink-0" size={22} />
            <div>
              <p className="font-medium text-red-700">QuickBooks connection expired</p>
              <p className="text-sm text-red-600/80 mt-1">
                The refresh token (100-day lifetime) has expired. Reconnect to resume sync.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Go-live confirmation modal */}
      {showGoLive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card rounded-xl border border-border p-6 max-w-md w-full">
            {showGoLive === "step1" ? (
              <>
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="text-amber-500" size={20} /> Confirm live mode
                </h3>
                <p className="text-sm text-muted-foreground mt-3">
                  This will start writing to your live QuickBooks books. Are you sure you&apos;ve reviewed the dry-run log? Are the mappings correct?
                </p>
                <div className="flex items-center justify-end gap-2 mt-5">
                  <button
                    onClick={() => setShowGoLive(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setShowGoLive("step2")}
                    className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:brightness-110"
                  >
                    Yes, I&apos;ve reviewed
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-foreground">
                  Type &quot;CONFIRM&quot; to enable
                </h3>
                <p className="text-sm text-muted-foreground mt-3">
                  This action cannot be undone on the same connection.
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="CONFIRM"
                  autoFocus
                  className="w-full mt-4 border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
                <div className="flex items-center justify-end gap-2 mt-5">
                  <button
                    onClick={() => {
                      setShowGoLive(null);
                      setConfirmText("");
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGoLive}
                    disabled={confirmText !== "CONFIRM" || togglingDryRun}
                    className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
                  >
                    {togglingDryRun && <Loader2 size={14} className="animate-spin" />}
                    Enable live mode
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

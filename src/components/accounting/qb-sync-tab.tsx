"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import QbFixModal from "./qb-fix-modal";
import type { QbSyncLogRow } from "@/lib/qb/types";

interface ConnectionSummary {
  connected: boolean;
  id?: string;
  company_name?: string | null;
  realm_id?: string;
  dry_run_mode?: boolean;
  is_active?: boolean;
  last_sync_at?: string | null;
  refresh_token_expires_at?: string;
  setup_completed_at?: string | null;
}

interface Stats {
  syncedToday: number;
  pending: number;
  failed: number;
  syncedThisMonth: number;
  skippedToday: number; // for dry-run label
}

type EntityFilter = "all" | "customer" | "sub_customer" | "invoice" | "payment" | "void";
type StatusFilter = "all" | "synced" | "queued" | "failed" | "skipped_dry_run";

export default function QbSyncTab() {
  const [conn, setConn] = useState<ConnectionSummary | null>(null);
  const [stats, setStats] = useState<Stats>({
    syncedToday: 0,
    pending: 0,
    failed: 0,
    syncedThisMonth: 0,
    skippedToday: 0,
  });
  const [rows, setRows] = useState<QbSyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fixingRow, setFixingRow] = useState<QbSyncLogRow | null>(null);
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [cleaning, setCleaning] = useState(false);
  // Mount timestamp for refresh-expiry check. The banner doesn't need to
  // be precise to the second; re-renders during a long session may show
  // an older boundary, which is fine.
  const [mountedAt] = useState(() => Date.now());

  // Manual refresh helper used by the "Sync now" button. The initial
  // load happens in the mount effect below (inline to satisfy the
  // react-hooks/set-state-in-effect lint rule).
  const refreshAll = async () => {
    const [connRes, logRes] = await Promise.all([
      fetch("/api/qb/connection"),
      fetch("/api/qb/sync-log?limit=50"),
    ]);
    if (connRes.ok) {
      const data = (await connRes.json()) as ConnectionSummary;
      setConn(data);
    }
    if (logRes.ok) {
      const data = (await logRes.json()) as { rows: QbSyncLogRow[] };
      setRows(data.rows ?? []);
      setStats(computeStats(data.rows ?? []));
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [connRes, logRes] = await Promise.all([
        fetch("/api/qb/connection"),
        fetch("/api/qb/sync-log?limit=50"),
      ]);
      if (cancelled) return;
      if (connRes.ok) {
        const data = (await connRes.json()) as ConnectionSummary;
        if (!cancelled) setConn(data);
      }
      if (logRes.ok) {
        const data = (await logRes.json()) as { rows: QbSyncLogRow[] };
        if (!cancelled) {
          setRows(data.rows ?? []);
          setStats(computeStats(data.rows ?? []));
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCleanup() {
    if (!window.confirm("Delete synced sync-log entries older than 90 days?")) return;
    setCleaning(true);
    const res = await fetch("/api/qb/sync-log/cleanup", { method: "POST" });
    setCleaning(false);
    if (!res.ok) {
      toast.error("Cleanup failed");
      return;
    }
    const data = await res.json();
    toast.success(`Deleted ${data.deleted} log entries`);
    await refreshAll();
  }

  async function handleSyncNow() {
    setSyncing(true);
    const res = await fetch("/api/qb/sync-now", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data.reason === "setup_incomplete") {
        toast.error("Setup is not complete yet.");
      } else if (data.reason === "connection_inactive") {
        toast.error("Connection expired — reconnect to resume sync.");
      } else {
        toast.success(
          `Processed ${data.processed}: ${data.synced} synced, ${data.skipped} dry-run, ${data.failed} failed.`,
        );
      }
      await refreshAll();
    } else {
      toast.error("Sync failed");
    }
    setSyncing(false);
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto mb-2" size={22} /> Loading…
      </div>
    );
  }

  if (!conn?.connected) {
    // Shouldn't normally render — parent gates this tab on conn.is_active.
    // But guard anyway.
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">QuickBooks is not connected.</p>
        <Link
          href="/settings/money?tab=quickbooks"
          className="text-primary hover:underline text-sm mt-2 inline-block"
        >
          Connect in Settings →
        </Link>
      </div>
    );
  }

  const expired = conn.refresh_token_expires_at
    ? Date.parse(conn.refresh_token_expires_at) < mountedAt
    : false;

  const filteredRows = rows.filter((r) => {
    if (entityFilter === "void") {
      if (r.action !== "void") return false;
    } else if (entityFilter !== "all") {
      if (r.entity_type !== entityFilter) return false;
    }
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [r.entity_id, r.qb_entity_id, r.error_message]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Connection status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-card rounded-xl border border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#2CA01C]/10 flex items-center justify-center">
            <span className="font-bold text-[#2CA01C] text-sm">qb</span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              Connected to QuickBooks Online
              {conn.is_active && !expired && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {conn.company_name ?? conn.realm_id}
              {conn.last_sync_at ? ` · Last sync ${timeAgo(conn.last_sync_at)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncNow}
            disabled={syncing || !conn.is_active}
            className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync now
          </button>
          <Link
            href="/settings/money?tab=quickbooks"
            className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent flex items-center gap-1.5"
          >
            <SettingsIcon size={14} /> Settings
          </Link>
        </div>
      </div>

      {/* Dry-run banner */}
      {conn.dry_run_mode && conn.is_active && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-xl border border-amber-500/30">
          <AlertTriangle className="text-amber-600 shrink-0" size={20} />
          <div>
            <p className="font-medium text-amber-700">Dry run mode — nothing is being written to QuickBooks</p>
            <p className="text-sm text-amber-600/90 mt-1">
              Review the log below. Switch to live mode in{" "}
              <Link href="/settings/money?tab=quickbooks" className="underline">
                Settings
              </Link>{" "}
              when you&apos;re ready.
            </p>
          </div>
        </div>
      )}

      {/* Expired banner */}
      {(!conn.is_active || expired) && (
        <div className="flex items-start gap-3 p-4 bg-red-500/10 rounded-xl border border-red-500/30">
          <AlertTriangle className="text-red-600 shrink-0" size={20} />
          <div className="flex-1">
            <p className="font-medium text-red-700">QuickBooks connection expired</p>
            <p className="text-sm text-red-600/90 mt-1">Reconnect to resume sync.</p>
          </div>
          <Link
            href="/api/qb/authorize"
            className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:brightness-110"
          >
            Reconnect
          </Link>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={conn.dry_run_mode ? "Would sync today" : "Synced today"}
          value={conn.dry_run_mode ? stats.skippedToday : stats.syncedToday}
          tone="default"
          icon={<CheckCircle2 size={16} />}
        />
        <StatCard
          label="Pending"
          value={stats.pending}
          tone="default"
          icon={<Clock size={16} />}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          tone={stats.failed > 0 ? "red" : "default"}
          icon={<XCircle size={16} />}
        />
        <StatCard
          label="Synced this month"
          value={stats.syncedThisMonth}
          tone="default"
          icon={<CheckCircle2 size={16} />}
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          value={entityFilter}
          onChange={(v) => setEntityFilter(v as EntityFilter)}
          options={[
            { value: "all", label: "All entities" },
            { value: "customer", label: "Customers" },
            { value: "sub_customer", label: "Sub-customers" },
            { value: "invoice", label: "Invoices" },
            { value: "payment", label: "Payments" },
            { value: "void", label: "Voids" },
          ]}
        />
        <FilterGroup
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={[
            { value: "all", label: "All statuses" },
            { value: "synced", label: "Synced" },
            { value: "queued", label: "Queued" },
            { value: "failed", label: "Failed" },
            { value: "skipped_dry_run", label: "Dry run" },
          ]}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search record / error…"
          className="ml-auto border border-border rounded-lg px-3 py-1.5 bg-background text-sm w-72"
        />
        <button
          onClick={handleCleanup}
          disabled={cleaning}
          className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
          title="Delete synced logs older than 90 days"
        >
          {cleaning ? "Cleaning…" : "Clear old logs"}
        </button>
      </div>

      {/* Recent activity table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Recent activity</h3>
          <Link
            href="/accounting/sync-log"
            className="text-sm text-primary hover:underline"
          >
            View full sync log →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Entity</th>
                <th className="text-left px-4 py-2 font-medium">Record</th>
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-right px-4 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    No sync activity matches the current filters.
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-border ${row.status === "failed" ? "bg-red-500/5" : ""}`}
                >
                  <td className="px-4 py-2">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-2 text-foreground">
                    {entityLabel(row.entity_type)}
                    {row.action === "void" && (
                      <span className="ml-1 text-xs text-red-600">(void)</span>
                    )}
                    {row.action === "delete" && (
                      <span className="ml-1 text-xs text-muted-foreground">(delete)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {row.qb_entity_id
                      ? `QB ${row.qb_entity_id}`
                      : row.entity_id.slice(0, 8)}
                    {row.status === "failed" && row.error_message && (
                      <div className="text-xs text-red-600 mt-0.5">
                        {row.error_message}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {timeAgo(row.synced_at ?? row.created_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {row.status === "failed" && (
                      <button
                        onClick={() => setFixingRow(row)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Fix
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {fixingRow && (
        <QbFixModal
          row={fixingRow}
          onClose={() => setFixingRow(null)}
          onRetried={refreshAll}
        />
      )}
    </div>
  );
}

function computeStats(rows: QbSyncLogRow[]): Stats {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let syncedToday = 0;
  let pending = 0;
  let failed = 0;
  let syncedThisMonth = 0;
  let skippedToday = 0;
  for (const r of rows) {
    const syncedTs = r.synced_at ? Date.parse(r.synced_at) : NaN;
    if (r.status === "queued") pending += 1;
    if (r.status === "failed") failed += 1;
    if (r.status === "synced" && syncedTs >= todayStart) syncedToday += 1;
    if (r.status === "synced" && syncedTs >= monthStart) syncedThisMonth += 1;
    if (r.status === "skipped_dry_run" && syncedTs >= todayStart) skippedToday += 1;
  }
  return { syncedToday, pending, failed, syncedThisMonth, skippedToday };
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "default" | "red";
  icon: React.ReactNode;
}) {
  return (
    <div
      className={`p-4 rounded-xl border ${tone === "red" ? "border-red-500/30 bg-red-500/5" : "border-border bg-card"}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-bold ${tone === "red" && value > 0 ? "text-red-600" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: QbSyncLogRow["status"] }) {
  const map: Record<QbSyncLogRow["status"], { label: string; className: string }> = {
    queued: {
      label: "Pending",
      className: "bg-amber-500/10 text-amber-700",
    },
    synced: {
      label: "Synced",
      className: "bg-green-500/10 text-green-700",
    },
    failed: {
      label: "Failed",
      className: "bg-red-500/10 text-red-700",
    },
    skipped_dry_run: {
      label: "Dry run",
      className: "bg-blue-500/10 text-blue-700",
    },
  };
  const v = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${v.className}`}
    >
      {v.label}
    </span>
  );
}

function entityLabel(type: QbSyncLogRow["entity_type"]): string {
  if (type === "customer") return "Customer";
  if (type === "sub_customer") return "Sub-customer";
  if (type === "invoice") return "Invoice";
  if (type === "payment") return "Payment";
  return type;
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

function FilterGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-border rounded-lg px-3 py-1.5 bg-background text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

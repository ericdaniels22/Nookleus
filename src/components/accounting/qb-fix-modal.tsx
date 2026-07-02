"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, Loader2, RefreshCw, Settings as SettingsIcon, X } from "lucide-react";
import { toast } from "sonner";
import type { QbSyncLogRow } from "@/lib/qb/types";

type ErrorClass =
  | "class_not_mapped"
  | "deposit_account_not_mapped"
  | "auth_failure"
  | "rate_limit"
  | "duplicate"
  | "unknown";

function classify(row: QbSyncLogRow): ErrorClass {
  const code = row.error_code ?? "";
  const msg = row.error_message ?? "";
  if (code === "class_not_mapped" || /class.*(not|un)mapped|ClassRef/i.test(msg)) return "class_not_mapped";
  if (code === "deposit_account_not_mapped" || /deposit.*account.*(not|un)mapped/i.test(msg)) return "deposit_account_not_mapped";
  if (code === "AuthenticationFailure" || /authentic/i.test(msg)) return "auth_failure";
  if (code === "ThrottleExceeded" || /429|rate limit|too many/i.test(msg)) return "rate_limit";
  if (code === "DuplicateNameExists" || /duplicate|already exists/i.test(msg)) return "duplicate";
  return "unknown";
}

export default function QbFixModal({
  row,
  onClose,
  onRetried,
}: {
  row: QbSyncLogRow;
  onClose: () => void;
  onRetried: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [marking, setMarking] = useState(false);
  const [manualId, setManualId] = useState("");
  const cls = classify(row);

  async function retry() {
    setRetrying(true);
    const res = await fetch(`/api/qb/sync-log/${row.id}/retry`, { method: "POST" });
    setRetrying(false);
    if (res.ok) {
      toast.success("Re-queued.");
      onRetried();
      onClose();
    } else toast.error("Failed to re-queue");
  }

  async function markSynced() {
    setMarking(true);
    const res = await fetch(`/api/qb/sync-log/${row.id}/mark-synced`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qbEntityId: manualId.trim() || undefined }),
    });
    setMarking(false);
    if (res.ok) {
      toast.success("Marked as synced.");
      onRetried();
      onClose();
    } else toast.error("Failed to mark synced");
  }

  function copyError() {
    navigator.clipboard.writeText(row.error_message ?? "").then(
      () => toast.success("Error copied"),
      () => toast.error("Copy failed"),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card rounded-xl border border-border p-6 max-w-lg w-full">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="text-red-500" size={20} />
            Fix sync error
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="text-xs text-muted-foreground mb-3">
          {row.entity_type} · retry {row.retry_count} of 5 · action {row.action}
        </div>

        {cls === "class_not_mapped" && (
          <Panel tone="amber">
            <p className="font-medium">QuickBooks Class is not mapped.</p>
            <p className="text-sm mt-1 opacity-90">
              Pick a Class for this damage type, then retry.
            </p>
            <Link
              href="/settings/accounting/setup?tab=mappings"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
            >
              <SettingsIcon size={14} /> Go to mappings
            </Link>
          </Panel>
        )}

        {cls === "deposit_account_not_mapped" && (
          <Panel tone="amber">
            <p className="font-medium">Deposit account is not mapped.</p>
            <p className="text-sm mt-1 opacity-90">
              Map this payment method to a QB deposit account.
            </p>
            <Link
              href="/settings/accounting/setup?tab=mappings"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
            >
              <SettingsIcon size={14} /> Go to mappings
            </Link>
          </Panel>
        )}

        {cls === "auth_failure" && (
          <Panel tone="red">
            <p className="font-medium">QuickBooks connection expired.</p>
            <p className="text-sm mt-1 opacity-90">Reconnect to resume sync.</p>
            <Link
              href="/api/qb/authorize"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
            >
              Reconnect →
            </Link>
          </Panel>
        )}

        {cls === "rate_limit" && (
          <Panel tone="blue">
            <p className="font-medium">QuickBooks rate limit reached.</p>
            <p className="text-sm mt-1 opacity-90">
              Will auto-retry shortly. You can also retry now below.
            </p>
          </Panel>
        )}

        {cls === "duplicate" && (
          <Panel tone="amber">
            <p className="font-medium">QuickBooks reports a duplicate.</p>
            <p className="text-sm mt-1 opacity-90">
              If the record already exists in QB, paste its id to mark this log synced.
            </p>
            <input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="QB entity id"
              className="mt-2 w-full border border-border rounded-md px-2 py-1 bg-background text-sm"
            />
          </Panel>
        )}

        {cls === "unknown" && (
          <Panel tone="red">
            <p className="font-medium">Error</p>
            <pre className="mt-1 text-xs whitespace-pre-wrap break-words">
              {row.error_message ?? "Unknown error"}
            </pre>
            {row.error_code && (
              <p className="mt-1 text-xs opacity-70">Code: {row.error_code}</p>
            )}
          </Panel>
        )}

        <div className="flex items-center justify-end gap-2 pt-4">
          {cls === "unknown" && (
            <button
              onClick={copyError}
              className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent flex items-center gap-1.5"
            >
              <Copy size={14} /> Copy error
            </button>
          )}
          {cls === "duplicate" && (
            <button
              onClick={markSynced}
              disabled={marking || !manualId.trim()}
              className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {marking ? <Loader2 size={14} className="animate-spin" /> : "Mark as synced"}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Close
          </button>
          <button
            onClick={retry}
            disabled={retrying}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
          >
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Retry now
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({ tone, children }: { tone: "amber" | "red" | "blue"; children: React.ReactNode }) {
  const map = {
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-700",
    red: "bg-red-500/10 border-red-500/30 text-red-700",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-700",
  };
  return <div className={`p-3 rounded-lg border ${map[tone]} text-sm`}>{children}</div>;
}

"use client";

// Referral Partners list page (PRD #249, issues #250, #251).
// Renders every non-deleted partner in the Active Organization with the
// Lifecycle-status color chip, company name, and industry. The "+ Add
// Target" button opens the New Target dialog.
//
// Filtering (#251) — Lifecycle-status chips, an industry dropdown, and a
// search-by-company-name box — composes via the pure
// `referral-partner-filter` module. The page does not encode the filter
// rule; it just owns the form state and delegates.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Handshake, Loader2, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import NewTargetDialog from "@/components/referral-partners/new-target-dialog";
import {
  distinctIndustries,
  filterReferralPartners,
  type LifecycleStatus,
} from "@/lib/referral-partner-filter";
import type { CallOutcome } from "@/lib/referral-partner-call";

const RETENTION_DAYS = 30;

interface ReferralPartner {
  id: string;
  company_name: string;
  status: LifecycleStatus;
  industry: string | null;
  last_called_at: string | null;
  last_call_outcome: CallOutcome | null;
  next_follow_up_at: string | null;
  deleted_at?: string | null;
}

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  spoke: "Spoke",
  not_interested: "Not interested",
  interested: "Interested",
  scheduled_followup: "Scheduled follow-up",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const STATUS_CHIP_CLASS: Record<LifecycleStatus, string> = {
  grey:   "bg-gray-200 text-gray-700",
  yellow: "bg-yellow-200 text-yellow-900",
  green:  "bg-green-200 text-green-900",
  red:    "bg-red-200 text-red-900",
};

const STATUS_LABEL: Record<LifecycleStatus, string> = {
  grey:   "Uncontacted",
  yellow: "In progress",
  green:  "Active",
  red:    "Declined",
};

const ALL_STATUSES: ReadonlyArray<LifecycleStatus> = ["grey", "yellow", "green", "red"];

type View = "active" | "trash";

export default function ReferralPartnersPage() {
  const [partners, setPartners] = useState<ReferralPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Active vs Trash view (issue #256). Mirrors the Build 66 jobs pattern —
  // a single tab toggle on the list page swaps which endpoint feeds the
  // rows. No separate route segment.
  const [view, setView] = useState<View>("active");

  // Filter state — every chip on by default so the user sees everything
  // before narrowing. Industry and query empty until the user picks one.
  const [activeStatuses, setActiveStatuses] = useState<Set<LifecycleStatus>>(
    () => new Set(ALL_STATUSES),
  );
  const [industry, setIndustry] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const endpoint =
      view === "trash"
        ? "/api/referral-partners/trash"
        : "/api/referral-partners";
    const res = await fetch(endpoint);
    if (!res.ok) {
      setError(res.status === 403 ? "You don't have access to Referral Partners." : "Could not load partners.");
      setLoading(false);
      return;
    }
    const body = await res.json();
    setPartners(body.referral_partners ?? []);
    setLoading(false);
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  const industries = useMemo(() => distinctIndustries(partners), [partners]);

  // Trash uses the API's own ordering (deleted_at desc) and bypasses the
  // status/industry/query filters — Trash is its own slice of the dataset
  // and gets a different row treatment (with Restore + Delete forever).
  const visiblePartners = useMemo(
    () =>
      view === "trash"
        ? partners
        : filterReferralPartners(partners, {
            status: Array.from(activeStatuses),
            industry,
            query,
          }),
    [view, partners, activeStatuses, industry, query],
  );

  const toggleStatus = (s: LifecycleStatus) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Handshake size={24} className="text-primary" />
          <h1 className="text-2xl font-heading font-semibold">Referral Partners</h1>
        </div>
        {view === "active" && (
          <button
            onClick={() => setDialogOpen(true)}
            className="btn btn-primary inline-flex items-center gap-2"
          >
            <Plus size={16} />
            Add Target
          </button>
        )}
      </header>

      {/* ── View tabs (Active / Trash) — issue #256 ─────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "active"}
          onClick={() => setView("active")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
            view === "active"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground hover:bg-muted/40"
          }`}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          data-testid="referral-partners-trash-tab"
          aria-selected={view === "trash"}
          onClick={() => setView("trash")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
            view === "trash"
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground hover:bg-muted/40"
          }`}
        >
          <Trash2 size={14} />
          Trash
        </button>
      </div>

      {view === "active" && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by Lifecycle status"
        >
          {ALL_STATUSES.map((s) => {
            const active = activeStatuses.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                aria-pressed={active}
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition ${
                  STATUS_CHIP_CLASS[s]
                } ${active ? "ring-2 ring-primary" : "opacity-40"}`}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>

        <select
          aria-label="Filter by industry"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="rounded-md border border-border bg-card px-2 py-1 text-sm"
        >
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>

        <label className="relative flex items-center flex-1 min-w-[12rem] max-w-sm">
          <Search size={14} className="absolute left-2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            placeholder="Search company name"
            aria-label="Search by company name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-card pl-7 pr-2 py-1 text-sm"
          />
        </label>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : view === "trash" ? (
        visiblePartners.length === 0 ? (
          <p className="text-sm text-muted-foreground">Trash is empty.</p>
        ) : (
          <div className="space-y-3">
            {visiblePartners.map((p) => (
              <TrashRow key={p.id} partner={p} onChange={load} />
            ))}
          </div>
        )
      ) : partners.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No partners yet. Click <strong>Add Target</strong> to start your cold-call list.
        </p>
      ) : visiblePartners.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No partners match the current filters.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border border-border bg-card">
          {visiblePartners.map((p) => (
            <li key={p.id}>
              <Link
                href={`/referral-partners/${p.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CHIP_CLASS[p.status]}`}
                >
                  {STATUS_LABEL[p.status]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{p.company_name}</p>
                  {p.industry && (
                    <p className="text-xs text-muted-foreground truncate">{p.industry}</p>
                  )}
                </div>
                {/* Denormalized last-call / next-follow-up surface
                    (PRD #249, issue #254 AC: list page surfaces last
                    called, last call outcome, next follow-up). */}
                <div className="hidden sm:flex flex-col text-right text-xs text-muted-foreground min-w-[12rem]">
                  {p.last_called_at && (
                    <span>
                      Last call: {formatDate(p.last_called_at)}
                      {p.last_call_outcome && (
                        <> — {OUTCOME_LABEL[p.last_call_outcome]}</>
                      )}
                    </span>
                  )}
                  {p.next_follow_up_at && (
                    <span>
                      Next follow-up: {formatDate(p.next_follow_up_at)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewTargetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => void load()}
      />
    </div>
  );
}

// One Trash row — mirrors the Build 66 jobs Trash row shape so the platform
// has one Trash visual language across surfaces. Restore nulls `deleted_at`;
// "Delete forever" hard-deletes (FK CASCADE on calls + SET NULL on contacts).
function TrashRow({
  partner,
  onChange,
}: {
  partner: ReferralPartner;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<"restore" | "purge" | null>(null);

  // Capture "now" at mount so the rendered "N days until permanent delete"
  // is stable across re-renders — same pattern as JobsPage TrashRow.
  const [mountedAt] = useState(() => Date.now());
  const daysRemaining = partner.deleted_at
    ? Math.max(
        0,
        RETENTION_DAYS -
          Math.floor((mountedAt - new Date(partner.deleted_at).getTime()) / 86_400_000),
      )
    : null;

  async function handleRestore() {
    setBusy("restore");
    const res = await fetch(
      `/api/referral-partners/${partner.id}/restore`,
      { method: "POST" },
    );
    setBusy(null);
    if (!res.ok) {
      alert("Couldn't restore Referral Partner");
      return;
    }
    onChange();
  }

  async function handlePurge() {
    if (
      !confirm(
        `Permanently delete "${partner.company_name}" and all its Call log entries? Linked contacts will be preserved but unlinked. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy("purge");
    const res = await fetch(`/api/referral-partners/${partner.id}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!res.ok) {
      alert("Couldn't delete Referral Partner");
      return;
    }
    onChange();
  }

  return (
    <div
      data-testid={`referral-partners-trash-row-${partner.id}`}
      className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-foreground truncate">
          {partner.company_name}
        </p>
        {partner.industry && (
          <p className="text-sm text-muted-foreground truncate">{partner.industry}</p>
        )}
        <p className="text-xs text-muted-foreground/70 mt-1">
          {daysRemaining !== null
            ? daysRemaining === 0
              ? "Auto-purges today"
              : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} until permanent deletion`
            : null}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          data-testid={`referral-partners-trash-restore-${partner.id}`}
          onClick={handleRestore}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {busy === "restore" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Restore
        </button>
        <button
          type="button"
          data-testid={`referral-partners-trash-purge-${partner.id}`}
          onClick={handlePurge}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
        >
          {busy === "purge" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Delete forever
        </button>
      </div>
    </div>
  );
}

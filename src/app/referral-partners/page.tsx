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
import { Handshake, Plus, Search } from "lucide-react";
import NewTargetDialog from "@/components/referral-partners/new-target-dialog";
import {
  distinctIndustries,
  filterReferralPartners,
  type LifecycleStatus,
} from "@/lib/referral-partner-filter";

interface ReferralPartner {
  id: string;
  company_name: string;
  status: LifecycleStatus;
  industry: string | null;
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

export default function ReferralPartnersPage() {
  const [partners, setPartners] = useState<ReferralPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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
    const res = await fetch("/api/referral-partners");
    if (!res.ok) {
      setError(res.status === 403 ? "You don't have access to Referral Partners." : "Could not load partners.");
      setLoading(false);
      return;
    }
    const body = await res.json();
    setPartners(body.referral_partners ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const industries = useMemo(() => distinctIndustries(partners), [partners]);

  const visiblePartners = useMemo(
    () =>
      filterReferralPartners(partners, {
        status: Array.from(activeStatuses),
        industry,
        query,
      }),
    [partners, activeStatuses, industry, query],
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
        <button
          onClick={() => setDialogOpen(true)}
          className="btn btn-primary inline-flex items-center gap-2"
        >
          <Plus size={16} />
          Add Target
        </button>
      </header>

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

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
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
            <li key={p.id} className="flex items-center gap-4 px-4 py-3">
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

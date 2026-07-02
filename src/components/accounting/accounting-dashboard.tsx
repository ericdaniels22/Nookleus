// src/components/accounting/accounting-dashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import DateRangeSelector from "./date-range-selector";
import ExportMenu from "./export-menu";
import StatCards from "./stat-cards";
import JobProfitabilityTab from "./job-profitability-tab";
import ArAgingTab from "./ar-aging-tab";
import GlobalExpensesTab from "./global-expenses-tab";
import ByDamageTypeTab from "./by-damage-type-tab";
import QbSyncTab from "./qb-sync-tab";
import QbExpiredBanner from "./qb-expired-banner";

type Tab = "profitability" | "ar-aging" | "expenses" | "damage-type" | "quickbooks";
const BASE_TABS: { id: Tab; label: string }[] = [
  { id: "profitability", label: "Job profitability" },
  { id: "ar-aging", label: "AR aging" },
  { id: "expenses", label: "Expenses" },
  { id: "damage-type", label: "By damage type" },
];
const QB_TAB: { id: Tab; label: string } = { id: "quickbooks", label: "QuickBooks sync" };

export default function AccountingDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [range, setRange] = useState<RangePreset>((searchParams.get("range") as RangePreset) ?? "last_30");
  const [tab, setTab] = useState<Tab>((searchParams.get("tab") as Tab) ?? "profitability");
  // QB tab visibility gated on an active + setup-complete connection.
  // Single GET to /api/qb/connection on mount; if it isn't there, the 5th
  // tab simply doesn't render.
  const [qbVisible, setQbVisible] = useState(false);

  useEffect(() => {
    fetch("/api/qb/connection")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.connected && data?.is_active && data?.setup_completed_at) {
          setQbVisible(true);
        }
      })
      .catch(() => {});
  }, []);

  const TABS = qbVisible ? [...BASE_TABS, QB_TAB] : BASE_TABS;

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    params.set("tab", tab);
    router.replace(`/accounting?${params.toString()}`, { scroll: false });
  }, [range, tab, router]); // intentionally omit searchParams — would cause a loop

  return (
    <div className="p-6 space-y-6">
      <QbExpiredBanner />
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounting</h1>
          <p className="text-sm text-muted-foreground">Revenue, expenses, and profitability across all jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeSelector value={range} onChange={setRange} />
          <ExportMenu range={range} />
        </div>
      </div>

      <StatCards range={range} />

      <div className="border-b border-border flex gap-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm ${tab === t.id ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profitability" && <JobProfitabilityTab range={range} />}
      {tab === "ar-aging" && <ArAgingTab />}
      {tab === "expenses" && <GlobalExpensesTab range={range} />}
      {tab === "damage-type" && <ByDamageTypeTab range={range} />}
      {tab === "quickbooks" && qbVisible && <QbSyncTab />}
    </div>
  );
}

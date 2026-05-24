"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Download,
  Briefcase,
  Users,
  CreditCard,
  FileText,
  Mail,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

const EXPORT_TYPES = [
  {
    key: "jobs",
    label: "Jobs",
    icon: Briefcase,
    description: "All jobs with status, damage type, address, insurance",
  },
  {
    key: "contacts",
    label: "Contacts",
    icon: Users,
    description: "Names, phone, email, role, company",
  },
  {
    key: "payments",
    label: "Payments",
    icon: CreditCard,
    description: "Payment amounts, sources, methods, dates",
  },
  {
    key: "invoices",
    label: "Invoices",
    icon: FileText,
    description: "Invoice numbers, totals, statuses",
  },
  {
    key: "emails",
    label: "Emails",
    icon: Mail,
    description: "Email metadata (subject, sender, folder)",
  },
  {
    key: "activities",
    label: "Activity Log",
    icon: Clock,
    description: "Job activities, notes, milestones",
  },
];

export function ExportTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  async function handleExport(type: string) {
    setExporting(type);

    const params = new URLSearchParams({ type });
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    try {
      const res = await fetch(`/api/settings/export?${params}`);
      if (!res.ok) {
        toast.error("Export failed");
        setExporting(null);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aaa-${type}-export.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${type} exported`);
    } catch {
      toast.error("Export failed");
    }

    setExporting(null);
  }

  async function handleExportAll() {
    for (const t of EXPORT_TYPES) {
      await handleExport(t.key);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Data Export</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Export your data as CSV files.
        </p>
      </div>

      {/* Date range filter */}
      <div className="bg-card rounded-xl border border-border p-4">
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          Date Range (optional)
        </label>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
          />
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Export buttons */}
      <div className="space-y-2">
        {EXPORT_TYPES.map((t) => {
          const Icon = t.icon;
          const isExporting = exporting === t.key;

          return (
            <div
              key={t.key}
              className="bg-card rounded-xl border border-border p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Icon size={18} className="text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.description}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleExport(t.key)}
                disabled={!!exporting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
              >
                {isExporting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {isExporting ? "Exporting..." : "Export CSV"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Export all */}
      <div className="flex justify-end">
        <button
          onClick={handleExportAll}
          disabled={!!exporting}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
        >
          {exporting && <Loader2 size={16} className="animate-spin" />}
          <Download size={16} />
          Export All
        </button>
      </div>
    </div>
  );
}

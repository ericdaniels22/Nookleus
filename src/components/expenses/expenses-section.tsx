"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, Plus, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import type { Expense, ExpenseCategory, Vendor } from "@/lib/types";
import { formatAmount } from "@/lib/expenses-constants";
import LogExpenseModal from "./log-expense-modal";
import ReceiptDetailModal from "./receipt-detail-modal";

type ExpenseRow = Expense & {
  vendor?: Vendor | null;
  category?: ExpenseCategory | null;
};

interface Props {
  jobId: string;
  onChanged?: () => void;
}

export default function ExpensesSection({ jobId, onChanged }: Props) {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [logOpen, setLogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const { hasPermission } = useAuth();

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/expenses/by-job/${jobId}`);
    if (res.ok) setRows(await res.json());
    else { toast.error("Failed to load expenses"); setRows([]); }
    onChanged?.();
  }, [jobId, onChanged]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeCategories = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, ExpenseCategory>();
    for (const r of rows) if (r.category) seen.set(r.category.id, r.category);
    return Array.from(seen.values()).sort((a, b) => a.sort_order - b.sort_order);
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (filter === "all") return rows;
    return rows.filter((r) => r.category_id === filter);
  }, [rows, filter]);

  const canLog = hasPermission("log_expenses");

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground inline-flex items-center gap-2">
          <Receipt size={16} /> Expenses ({rows?.length ?? 0})
        </h3>
        {canLog && (
          <button onClick={() => { setSelected(null); setLogOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus size={14} /> Log Expense
          </button>
        )}
      </div>

      {activeCategories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <button onClick={() => setFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
              filter === "all"
                ? "bg-accent-tint text-accent-text border-transparent"
                : "bg-transparent text-muted-foreground border-border",
            )}>
            All
          </button>
          {activeCategories.map((c) => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                filter === c.id
                  ? "bg-accent-tint text-accent-text border-transparent"
                  : "bg-transparent text-muted-foreground border-border",
              )}>
              {c.display_label}
            </button>
          ))}
        </div>
      )}

      {rows && rows.length === 0 ? (
        <div className="text-center py-8">
          <Receipt size={28} className="mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground mt-2">No expenses logged yet</p>
          {canLog && (
            <button onClick={() => { setSelected(null); setLogOpen(true); }}
              className="text-sm text-primary hover:underline mt-1">
              Log the first expense
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered?.map((r) => (
            <ExpenseRowView key={r.id} row={r}
              onClick={() => { setSelected(r); setDetailOpen(true); }} />
          ))}
        </div>
      )}

      <LogExpenseModal
        open={logOpen}
        onOpenChange={setLogOpen}
        jobId={jobId}
        onSaved={refresh}
      />
      <ReceiptDetailModal
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setSelected(null); }}
        expense={selected}
        onChanged={refresh}
      />
    </div>
  );
}

function ExpenseRowView({ row, onClick }: { row: ExpenseRow; onClick: () => void }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!row.thumbnail_path) return;
    let cancelled = false;
    fetch(`/api/expenses/${row.id}/thumbnail-url`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j?.url) setThumbUrl(j.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [row.id, row.thumbnail_path]);

  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/50 text-left transition-colors">
      <div className="w-10 h-10 rounded-lg bg-accent/30 flex items-center justify-center overflow-hidden flex-shrink-0">
        {thumbUrl
          ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
          : <ImageIcon size={16} className="text-muted-foreground/50" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{row.vendor?.name ?? row.vendor_name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {row.category && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: row.category.bg_color, color: row.category.text_color }}>
              {row.category.display_label}
            </span>
          )}
          <span>{format(new Date(row.expense_date), "MMM d")}</span>
          <span>·</span>
          <span>{row.submitter_name}</span>
        </div>
      </div>
      <div className="text-sm font-semibold text-foreground flex-shrink-0">{formatAmount(row.amount)}</div>
    </button>
  );
}

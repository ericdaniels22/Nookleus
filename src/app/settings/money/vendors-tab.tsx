"use client";

// #230 — extracted body of the pre-redesign /settings/vendors page. The
// only change from the original is renaming the default export to a
// named `VendorsTab` so the /settings/money shell can compose it
// alongside the other three Money tabs. UI and behavior are unchanged.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Ban, RotateCcw, FileBadge } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Vendor, VendorType, ExpenseCategory } from "@/lib/types";
import { VENDOR_TYPES, vendorTypeConfig } from "@/lib/expenses-constants";

type Filter = "all" | VendorType | "1099";

export function VendorsTab() {
  const [vendors, setVendors] = useState<(Vendor & { default_category?: ExpenseCategory | null })[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    const [vRes, cRes] = await Promise.all([
      fetch("/api/settings/vendors"),
      fetch("/api/settings/expense-categories"),
    ]);
    if (vRes.ok) setVendors(await vRes.json());
    if (cRes.ok) setCategories(await cRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "all": return vendors;
      case "1099": return vendors.filter((v) => v.is_1099);
      default: return vendors.filter((v) => v.vendor_type === filter);
    }
  }, [vendors, filter]);

  async function toggleActive(v: Vendor) {
    const path = v.is_active ? "deactivate" : "reactivate";
    const res = await fetch(`/api/settings/vendors/${v.id}/${path}`, { method: "POST" });
    if (res.ok) { toast.success(v.is_active ? "Vendor deactivated" : "Vendor reactivated"); load(); }
    else { toast.error("Failed to update vendor"); }
  }

  const filterTabs: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "subcontractor", label: "Subcontractors" },
    { value: "supplier", label: "Suppliers" },
    { value: "equipment_rental", label: "Equipment Rental" },
    { value: "other", label: "Other" },
    { value: "1099", label: "1099 Vendors" },
  ];

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Vendors</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage suppliers, subcontractors, and equipment rentals.
          </p>
        </div>
        <button onClick={() => { setEditing(null); setModalOpen(true); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all">
          <Plus size={16} /> Add Vendor
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {filterTabs.map((t) => {
          const active = filter === t.value;
          return (
            <button key={t.value} onClick={() => setFilter(t.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "bg-accent-tint text-accent-text border-transparent"
                  : "bg-transparent text-muted-foreground border-border hover:text-foreground",
              )}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-accent/30">
            <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Default Category</th>
              <th className="px-4 py-2.5 text-center">1099</th>
              <th className="px-4 py-2.5">Last Used</th>
              <th className="px-4 py-2.5 text-center">Active</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No vendors match this filter.</td></tr>
            )}
            {filtered.map((v) => {
              const tcfg = vendorTypeConfig(v.vendor_type);
              return (
                <tr key={v.id} className="border-t border-border hover:bg-accent/20">
                  <td className="px-4 py-3 font-medium text-foreground">{v.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ backgroundColor: tcfg.bg, color: tcfg.text }}>
                      {tcfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {v.default_category ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{ backgroundColor: v.default_category.bg_color, color: v.default_category.text_color }}>
                        {v.default_category.display_label}
                      </span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {v.is_1099 ? <FileBadge size={14} className="inline text-primary" /> : ""}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {v.last_used_at ? format(new Date(v.last_used_at), "MMM d, yyyy") : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(v)}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-colors",
                        v.is_active ? "bg-primary" : "bg-muted-foreground/20",
                      )}>
                      <span className={cn(
                        "absolute top-0.5 w-3 h-3 bg-background rounded-full transition-transform",
                        v.is_active ? "translate-x-4" : "translate-x-0.5",
                      )} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => { setEditing(v); setModalOpen(true); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => toggleActive(v)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title={v.is_active ? "Deactivate" : "Reactivate"}>
                        {v.is_active ? <Ban size={14} /> : <RotateCcw size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <VendorModal
        open={modalOpen}
        onOpenChange={(o) => { setModalOpen(o); if (!o) setEditing(null); }}
        vendor={editing}
        categories={categories}
        onSaved={load}
      />
    </div>
  );
}

function VendorModal({
  open, onOpenChange, vendor, categories, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendor: Vendor | null;
  categories: ExpenseCategory[];
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<VendorType>("supplier");
  const [categoryId, setCategoryId] = useState<string>("");
  const [taxId, setTaxId] = useState("");
  const [is1099, setIs1099] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(vendor?.name ?? "");
    setType(vendor?.vendor_type ?? "supplier");
    setCategoryId(vendor?.default_category_id ?? "");
    setTaxId(vendor?.tax_id ?? "");
    setIs1099(vendor?.is_1099 ?? false);
    setNotes(vendor?.notes ?? "");
  }, [open, vendor]);

  async function handleSave() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const body = {
      name: name.trim(),
      vendor_type: type,
      default_category_id: categoryId || null,
      is_1099: is1099,
      tax_id: taxId || null,
      notes: notes || null,
    };
    const res = vendor
      ? await fetch(`/api/settings/vendors/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/settings/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) { toast.success(vendor ? "Vendor updated" : "Vendor added"); onSaved(); onOpenChange(false); }
    else { const err = await res.json().catch(() => ({})); toast.error(err.error || "Failed to save"); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{vendor ? "Edit Vendor" : "Add Vendor"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {VENDOR_TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => setType(t.value)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    type === t.value ? "border-transparent" : "border-border bg-transparent text-muted-foreground hover:text-foreground",
                  )}
                  style={type === t.value ? { backgroundColor: t.bg, color: t.text } : undefined}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Default Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-transparent border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.display_label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Tax ID</label>
            <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="EIN or SSN" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIs1099(!is1099)}
              className={cn("w-8 h-4 rounded-full relative transition-colors", is1099 ? "bg-primary" : "bg-muted-foreground/20")}>
              <span className={cn("absolute top-0.5 w-3 h-3 bg-background rounded-full transition-transform", is1099 ? "translate-x-4" : "translate-x-0.5")} />
            </button>
            <span className="text-sm text-foreground">Requires 1099-NEC</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saving ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

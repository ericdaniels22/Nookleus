"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Library, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ItemForm } from "@/components/item-library/item-form";
import { ItemTable } from "@/components/item-library/item-table";
import type { DamageType, ItemCategory, ItemLibraryItem } from "@/lib/types";

type EditTarget = ItemLibraryItem | "new" | null;

const CATEGORY_OPTIONS: { value: ItemCategory; label: string }[] = [
  { value: "labor", label: "Labor" },
  { value: "equipment", label: "Equipment" },
  { value: "materials", label: "Materials" },
  { value: "services", label: "Services" },
  { value: "other", label: "Other" },
];

const ALL_VALUE = "__all__";

export default function ItemLibrarySettingsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const allowed =
    hasPermission("view_estimates") ||
    hasPermission("view_invoices") ||
    hasPermission("manage_item_library");
  const canManage = hasPermission("manage_item_library");

  const [items, setItems] = useState<ItemLibraryItem[] | null>(null);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "">("");
  const [damageType, setDamageType] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);

  // Track in-flight fetches so out-of-order responses don't clobber state.
  const fetchSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (category) params.set("category", category);
    if (damageType) params.set("damage_type", damageType);
    if (showInactive) params.set("is_active", "false");

    const qs = params.toString();
    const url = qs ? `/api/item-library?${qs}` : "/api/item-library";
    try {
      const res = await fetch(url);
      if (seq !== fetchSeq.current) return; // a newer request is in flight
      if (res.ok) {
        const data = (await res.json()) as { items: ItemLibraryItem[] };
        setItems(data.items);
      } else {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errBody.error || "Failed to load items");
        setItems([]);
      }
    } catch {
      if (seq !== fetchSeq.current) return;
      toast.error("Network error loading items");
      setItems([]);
    }
  }, [debouncedSearch, category, damageType, showInactive]);

  // Debounce the search input → debouncedSearch (300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch when allowed + filters change.
  useEffect(() => {
    if (!authLoading && allowed) {
      refresh();
    }
  }, [authLoading, allowed, refresh]);

  // Load damage types once for the filter dropdown.
  useEffect(() => {
    if (authLoading || !allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/damage-types");
        if (!cancelled && res.ok) {
          const data = (await res.json()) as DamageType[];
          setDamageTypes(data);
        }
      } catch {
        // Non-fatal — filter just won't show damage types.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, allowed]);

  const handleEdit = useCallback(
    (item: ItemLibraryItem) => {
      if (!canManage) return; // ItemTable always renders Edit; gate the action.
      setEditTarget(item);
    },
    [canManage],
  );

  const handleToggleActive = useCallback(
    async (item: ItemLibraryItem) => {
      if (!canManage) return; // table renders, but writes are gated
      const next = !item.is_active;

      // Optimistic update.
      setItems((prev) =>
        prev
          ? prev.map((row) =>
              row.id === item.id ? { ...row, is_active: next } : row,
            )
          : prev,
      );

      const res = next
        ? await fetch(`/api/item-library/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: true }),
          })
        : await fetch(`/api/item-library/${item.id}`, { method: "DELETE" });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errBody.error || "Failed to update");
        // Invalidate to get the canonical state back.
        refresh();
      } else {
        toast.success(next ? "Item reactivated" : "Item deactivated");
      }
    },
    [canManage, refresh],
  );

  const handleSaved = useCallback(() => {
    setEditTarget(null);
    refresh();
  }, [refresh]);

  const handleCancel = useCallback(() => {
    setEditTarget(null);
  }, []);

  // ---- Render gates ----

  if (authLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Lock size={28} className="mx-auto text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          You don&apos;t have permission to view the Item Library. Ask an admin to grant you
          <span className="font-mono text-xs"> view_estimates</span>,
          <span className="font-mono text-xs"> view_invoices</span>, or
          <span className="font-mono text-xs"> manage_item_library</span> in Users &amp; Crew.
        </p>
      </div>
    );
  }

  // ---- Main render ----

  const dialogOpen = editTarget !== null;
  const editingItem = editTarget && editTarget !== "new" ? editTarget : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Library size={18} className="text-[var(--brand-primary)]" />
            Item Library
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Catalog of reusable line items for estimates and invoices. Tag items by damage type and
            section to surface them in the right place.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditTarget("new")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
          >
            <Plus size={16} />
            New Item
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end rounded-xl border border-border bg-card p-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, code, description…"
          />
        </div>

        <div className="w-full sm:w-44">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Category
          </label>
          <Select
            value={category === "" ? ALL_VALUE : category}
            onValueChange={(v) => {
              const next = (v as string | null) ?? ALL_VALUE;
              setCategory(next === ALL_VALUE ? "" : (next as ItemCategory));
            }}
          >
            <SelectTrigger className="w-full h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All categories</SelectItem>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full sm:w-48">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Damage type
          </label>
          <Select
            value={damageType === "" ? ALL_VALUE : damageType}
            onValueChange={(v) => {
              const next = (v as string | null) ?? ALL_VALUE;
              setDamageType(next === ALL_VALUE ? "" : next);
            }}
          >
            <SelectTrigger className="w-full h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All damage types</SelectItem>
              {damageTypes.map((dt) => (
                <SelectItem key={dt.id} value={dt.name}>
                  {dt.display_label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 pb-1.5">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <label
            htmlFor="show-inactive"
            className="text-sm text-foreground cursor-pointer select-none"
          >
            Show inactive
          </label>
        </div>
      </div>

      {/* Table area */}
      {items === null ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 size={20} className="inline animate-spin mr-2" /> Loading items…
        </div>
      ) : (
        <ItemTable
          items={items}
          onEdit={handleEdit}
          onToggleActive={handleToggleActive}
        />
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Edit item" : "New item"}
            </DialogTitle>
          </DialogHeader>
          {dialogOpen && canManage && (
            <ItemForm
              item={editingItem}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

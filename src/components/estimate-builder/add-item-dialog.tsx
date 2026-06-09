"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";
import type { BuilderMode, EstimateLineItem, ItemCategory, ItemLibraryItem } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The entity's ID regardless of mode (estimate, invoice, or template). */
  estimateId: string;
  sectionId: string;
  jobDamageType?: string;
  onAdded: (item: EstimateLineItem) => void;
  mode?: BuilderMode;
}

const CATEGORY_OPTIONS: { value: ItemCategory; label: string }[] = [
  { value: "labor", label: "Labor" },
  { value: "equipment", label: "Equipment" },
  { value: "materials", label: "Materials" },
  { value: "services", label: "Services" },
  { value: "other", label: "Other" },
];

const ALL_CATEGORY_VALUE = "__all__";

// ─────────────────────────────────────────────────────────────────────────────
// Library tab inner component
// ─────────────────────────────────────────────────────────────────────────────

function LibraryTab({
  estimateId,
  sectionId,
  jobDamageType,
  onAdded,
  open,
  onClose,
  mode = "estimate",
}: {
  estimateId: string;
  sectionId: string;
  jobDamageType?: string;
  onAdded: (item: EstimateLineItem) => void;
  open: boolean;
  onClose: () => void;
  mode?: BuilderMode;
}) {
  // Template mode has no granular line-item routes — see Part 2 plan deviation;
  // parent's rootPut auto-save handles persistence.
  const entityBase = mode === "invoice" ? "invoices" : "estimates";
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "">("");
  const [damageTypeFilter, setDamageTypeFilter] = useState<string>(
    jobDamageType ?? ""
  );
  const [items, setItems] = useState<ItemLibraryItem[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const fetchSeq = useRef(0);

  // Reset filters when dialog opens.
  useEffect(() => {
    if (open) {
      setSearchInput("");
      setDebouncedSearch("");
      setCategory("");
      setDamageTypeFilter(jobDamageType ?? "");
      setItems(null);
    }
  }, [open, jobDamageType]);

  // Debounce searchInput → debouncedSearch (300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch items whenever filters change AND dialog is open.
  useEffect(() => {
    if (!open) return;

    const seq = ++fetchSeq.current;
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (category) params.set("category", category);
    if (damageTypeFilter) params.set("damage_type", damageTypeFilter);
    // is_active defaults to true server-side; no need to pass it.

    const qs = params.toString();
    const url = qs ? `/api/item-library?${qs}` : "/api/item-library";

    setItems(null); // show loading state

    fetch(url)
      .then(async (res) => {
        if (seq !== fetchSeq.current) return; // out-of-order guard
        if (res.ok) {
          const data = (await res.json()) as { items: ItemLibraryItem[] };
          setItems(data.items);
        } else {
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(errBody.error || "Failed to load items");
          setItems([]);
        }
      })
      .catch(() => {
        if (seq !== fetchSeq.current) return;
        toast.error("Network error loading library items");
        setItems([]);
      });
  }, [open, debouncedSearch, category, damageTypeFilter]);

  async function handleAddFromLibrary(libItem: ItemLibraryItem) {
    setAddingId(libItem.id);
    try {
      // Template mode has no granular line-item routes — see Part 2 plan
      // deviation; parent's rootPut auto-save persists via setEntity callback.
      if (mode === "template") {
        // Template mode: build only fields onLineItemAdded actually reads
        // (see estimate-builder onLineItemAdded template branch). Cast through
        // unknown — callback param is widened to EstimateLineItem | InvoiceLineItem.
        const localItem = {
          id: crypto.randomUUID(),
          section_id: sectionId,
          library_item_id: libItem.id,
          name: libItem.name,
          description: libItem.description,
          code: libItem.code ?? null,
          quantity: libItem.default_quantity,
          unit: libItem.default_unit ?? null,
          unit_price: libItem.unit_price,
          sort_order: 0,
        } as unknown as EstimateLineItem;
        onAdded(localItem);
        toast.success(`Added: ${libItem.name}`);
        return;
      }

      const res = await fetch(`/api/${entityBase}/${estimateId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_id: sectionId,
          library_item_id: libItem.id,
          quantity: libItem.default_quantity,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error || "Failed to add item");
        return;
      }
      const data = (await res.json()) as { line_item: EstimateLineItem };
      onAdded(data.line_item);
      toast.success(`Added: ${libItem.name}`);
      // Multi-add UX: dialog stays open.
    } catch {
      toast.error("Network error adding item");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            placeholder="Search items…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        {/* Category select */}
        <Select
          value={category || ALL_CATEGORY_VALUE}
          onValueChange={(v) =>
            setCategory(v === ALL_CATEGORY_VALUE ? "" : (v as ItemCategory))
          }
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORY_VALUE}>All categories</SelectItem>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Damage type chip */}
        {damageTypeFilter && (
          <div className="flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">
            <span>{damageTypeFilter}</span>
            <button
              onClick={() => setDamageTypeFilter("")}
              className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
              aria-label="Clear damage type filter"
            >
              <X size={10} />
            </button>
          </div>
        )}
      </div>

      {/* Item list */}
      <div className="overflow-y-auto max-h-[50vh] rounded-lg border border-border">
        {items === null ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            No matching items in your library.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-sm text-foreground truncate">
                      {item.name}
                    </span>
                    {item.code && (
                      <span className="text-xs font-mono text-muted-foreground shrink-0">
                        {item.code}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {formatCurrency(item.unit_price)}
                      {item.default_unit ? ` / ${item.default_unit}` : ""}
                    </span>
                    {item.description && (
                      <span className="text-xs text-muted-foreground truncate max-w-xs">
                        · {item.description}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1"
                  disabled={addingId === item.id}
                  onClick={() => void handleAddFromLibrary(item)}
                >
                  <Plus size={12} />
                  {addingId === item.id ? "Adding…" : "Add"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer: Done button */}
      <div className="-mx-4 -mb-4 flex justify-end rounded-b-xl border-t bg-muted/50 p-4">
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom tab inner component
// ─────────────────────────────────────────────────────────────────────────────

function CustomTab({
  estimateId,
  sectionId,
  onAdded,
  onClose,
  mode = "estimate",
}: {
  estimateId: string;
  sectionId: string;
  onAdded: (item: EstimateLineItem) => void;
  onClose: () => void;
  mode?: BuilderMode;
}) {
  // Template mode has no granular line-item routes — see Part 2 plan deviation;
  // parent's rootPut auto-save handles persistence.
  const entityBase = mode === "invoice" ? "invoices" : "estimates";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAddCustom() {
    // Client-side validation
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (description.length > 2000) {
      toast.error("Description too long (max 2000)");
      return;
    }
    const nameTrimmed = name.trim();
    if (nameTrimmed.length > 200) {
      toast.error("Name too long (max 200)");
      return;
    }
    const namePayload = nameTrimmed.length > 0 ? nameTrimmed : null;
    const qtyTrimmed = quantity.trim();
    const priceTrimmed = unitPrice.trim();
    const qty = qtyTrimmed === "" ? NaN : Number(qtyTrimmed);
    const price = priceTrimmed === "" ? NaN : Number(priceTrimmed);
    if (!Number.isFinite(qty)) {
      toast.error(qtyTrimmed === "" ? "Quantity is required" : "Quantity must be a number");
      return;
    }
    if (!Number.isFinite(price)) {
      toast.error(priceTrimmed === "" ? "Unit price is required" : "Unit price must be a number");
      return;
    }

    setSubmitting(true);
    try {
      // Template mode has no granular line-item routes — see Part 2 plan
      // deviation; parent's rootPut auto-save persists via setEntity callback.
      if (mode === "template") {
        // Template mode: build only fields onLineItemAdded actually reads
        // (see estimate-builder onLineItemAdded template branch). Cast through
        // unknown — callback param is widened to EstimateLineItem | InvoiceLineItem.
        const localItem = {
          id: crypto.randomUUID(),
          section_id: sectionId,
          library_item_id: null,
          name: namePayload,
          description: description.trim(),
          code: code.trim() || null,
          quantity: qty,
          unit: unit.trim() || null,
          unit_price: price,
          sort_order: 0,
        } as unknown as EstimateLineItem;
        onAdded(localItem);
        toast.success("Item added");
        onClose();
        return;
      }

      const res = await fetch(`/api/${entityBase}/${estimateId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_id: sectionId,
          library_item_id: null,
          name: namePayload,
          description: description.trim(),
          code: code.trim() || null,
          quantity: qty,
          unit: unit.trim() || null,
          unit_price: price,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error || "Failed to add custom item");
        return;
      }
      const data = (await res.json()) as { line_item: EstimateLineItem };
      onAdded(data.line_item);
      toast.success("Item added");
      onClose(); // Custom tab closes after a single add per spec.
    } catch {
      toast.error("Network error adding item");
    } finally {
      setSubmitting(false);
    }
  }

  const isValid = (() => {
    const qtyTrimmed = quantity.trim();
    const priceTrimmed = unitPrice.trim();
    const qty = qtyTrimmed === "" ? NaN : Number(qtyTrimmed);
    const price = priceTrimmed === "" ? NaN : Number(priceTrimmed);
    return (
      description.trim().length > 0 &&
      description.length <= 2000 &&
      Number.isFinite(qty) &&
      Number.isFinite(price)
    );
  })();

  return (
    <div className="flex flex-col gap-4">
      {/* Name (optional) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="custom-name" className="text-sm font-medium">
          Name
        </Label>
        <Input
          id="custom-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="Optional title (e.g. Asbestos Testing)"
          className="text-sm"
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="custom-description" className="text-sm font-medium">
          Description <span className="text-destructive">*</span>
        </Label>
        <Input
          id="custom-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          placeholder="Item description"
          className="text-sm"
        />
      </div>

      {/* Code */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="custom-code" className="text-sm font-medium">
          Code
        </Label>
        <Input
          id="custom-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. LAB-001"
          className="text-sm"
        />
      </div>

      {/* Quantity + Unit row */}
      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <Label htmlFor="custom-quantity" className="text-sm font-medium">
            Quantity <span className="text-destructive">*</span>
          </Label>
          <Input
            id="custom-quantity"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1"
            className="text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <Label htmlFor="custom-unit" className="text-sm font-medium">
            Unit
          </Label>
          <Input
            id="custom-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. hr, sqft"
            className="text-sm"
          />
        </div>
      </div>

      {/* Unit price */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="custom-unit-price" className="text-sm font-medium">
          Unit Price <span className="text-destructive">*</span>
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            id="custom-unit-price"
            type="number"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="0.00"
            step="0.01"
            className="pl-6 text-sm"
          />
        </div>
      </div>

      {/* Submit button */}
      <div className="-mx-4 -mb-4 flex justify-end rounded-b-xl border-t bg-muted/50 p-4">
        <Button
          onClick={() => void handleAddCustom()}
          disabled={submitting || !isValid}
          className="gap-1.5"
        >
          <Plus size={14} />
          {submitting ? "Adding…" : "Add Item"}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddItemDialog — main export
// ─────────────────────────────────────────────────────────────────────────────

export function AddItemDialog({
  open,
  onOpenChange,
  estimateId,
  sectionId,
  jobDamageType,
  onAdded,
  mode = "estimate",
}: AddItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add line item</DialogTitle>
          <DialogDescription>
            Pick from your library or enter a custom item.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={0}>
          <TabsList>
            <TabsTrigger value={0}>From Library</TabsTrigger>
            <TabsTrigger value={1}>Custom Item</TabsTrigger>
          </TabsList>

          <TabsContent value={0} className="mt-3">
            <LibraryTab
              estimateId={estimateId}
              sectionId={sectionId}
              jobDamageType={jobDamageType}
              onAdded={onAdded}
              open={open}
              onClose={() => onOpenChange(false)}
              mode={mode}
            />
          </TabsContent>

          <TabsContent value={1} className="mt-3">
            <CustomTab
              estimateId={estimateId}
              sectionId={sectionId}
              onAdded={onAdded}
              onClose={() => onOpenChange(false)}
              mode={mode}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState, useCallback, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DamageType, ItemCategory, ItemLibraryItem } from "@/lib/types";

interface ItemFormProps {
  item?: ItemLibraryItem;
  onSaved: (item: ItemLibraryItem) => void;
  onCancel: () => void;
}

const CATEGORIES: { value: ItemCategory; label: string }[] = [
  { value: "labor", label: "Labor" },
  { value: "equipment", label: "Equipment" },
  { value: "materials", label: "Materials" },
  { value: "services", label: "Services" },
  { value: "other", label: "Other" },
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function ItemForm({ item, onSaved, onCancel }: ItemFormProps) {
  const isEditMode = !!item;

  // Form state
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [category, setCategory] = useState<ItemCategory>(item?.category ?? "labor");
  const [defaultQuantity, setDefaultQuantity] = useState<string>(
    item ? String(item.default_quantity) : "1",
  );
  const [defaultUnit, setDefaultUnit] = useState(item?.default_unit ?? "");
  const [unitPrice, setUnitPrice] = useState<string>(
    item ? String(item.unit_price) : "0",
  );
  const [damageTypeTags, setDamageTypeTags] = useState<string[]>(
    item?.damage_type_tags ?? [],
  );
  const [sectionTags, setSectionTags] = useState<string[]>(item?.section_tags ?? []);
  const [sectionTagInput, setSectionTagInput] = useState("");
  const [isActive, setIsActive] = useState(item?.is_active ?? true);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [damageTypesLoading, setDamageTypesLoading] = useState(true);

  const fetchDamageTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/damage-types");
      if (res.ok) {
        const data = (await res.json()) as DamageType[];
        setDamageTypes(data);
      }
    } catch {
      // Non-fatal: chips just won't render. Toast is excessive on a sub-load.
    } finally {
      setDamageTypesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDamageTypes();
  }, [fetchDamageTypes]);

  function toggleDamageType(name: string) {
    setDamageTypeTags((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  function commitSectionTag() {
    const trimmed = sectionTagInput.trim();
    if (!trimmed) return;
    if (!sectionTags.includes(trimmed)) {
      setSectionTags([...sectionTags, trimmed]);
    }
    setSectionTagInput("");
  }

  function handleSectionTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitSectionTag();
    } else if (e.key === "Backspace" && !sectionTagInput && sectionTags.length > 0) {
      setSectionTags(sectionTags.slice(0, -1));
    }
  }

  function removeSectionTag(tag: string) {
    setSectionTags(sectionTags.filter((t) => t !== tag));
  }

  function validate(): { ok: true; payload: PayloadFields } | { ok: false; error: string } {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) return { ok: false, error: "Name is required." };
    if (trimmedName.length > 200) {
      return { ok: false, error: "Name must be 200 characters or fewer." };
    }
    if (!trimmedDescription) {
      return { ok: false, error: "Description is required." };
    }
    if (trimmedDescription.length > 2000) {
      return { ok: false, error: "Description must be 2000 characters or fewer." };
    }

    const qty = Number(defaultQuantity);
    if (!Number.isFinite(qty)) {
      return { ok: false, error: "Default quantity must be a number." };
    }
    const price = Number(unitPrice);
    if (!Number.isFinite(price)) {
      return { ok: false, error: "Unit price must be a number." };
    }

    const trimmedCode = code.trim();
    const trimmedUnit = defaultUnit.trim();

    return {
      ok: true,
      payload: {
        name: trimmedName,
        description: trimmedDescription,
        code: trimmedCode ? trimmedCode : null,
        category,
        default_quantity: qty,
        default_unit: trimmedUnit ? trimmedUnit : null,
        unit_price: price,
        damage_type_tags: damageTypeTags,
        section_tags: sectionTags,
      },
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // If user typed a section tag but didn't press Enter, capture it.
    let pendingSectionTags = sectionTags;
    if (sectionTagInput.trim()) {
      const trimmed = sectionTagInput.trim();
      if (!pendingSectionTags.includes(trimmed)) {
        pendingSectionTags = [...pendingSectionTags, trimmed];
        setSectionTags(pendingSectionTags);
      }
      setSectionTagInput("");
    }

    const result = validate();
    if (!result.ok) {
      setFormError(result.error);
      toast.error(result.error);
      return;
    }
    setFormError(null);

    const payload = { ...result.payload, section_tags: pendingSectionTags };
    const editPayload = isEditMode ? { ...payload, is_active: isActive } : payload;

    setSubmitting(true);
    try {
      const url = isEditMode ? `/api/item-library/${item!.id}` : "/api/item-library";
      const method = isEditMode ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editPayload),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = errBody.error || `Failed to ${isEditMode ? "update" : "create"} item`;
        setFormError(msg);
        toast.error(msg);
        return;
      }

      const data = (await res.json()) as { item: ItemLibraryItem };
      toast.success(isEditMode ? "Item updated" : "Item created");
      onSaved(data.item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const previewPrice = Number(unitPrice);
  const previewQty = Number(defaultQuantity);
  const showPreview = Number.isFinite(previewPrice) && Number.isFinite(previewQty);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="item-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="item-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Senior Technician"
          maxLength={200}
          required
          disabled={submitting}
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="item-description">
          Description <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="item-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this line item covers, when to use it, scope notes..."
          maxLength={2000}
          rows={3}
          required
          disabled={submitting}
        />
        <p className="text-[11px] text-muted-foreground">
          {description.length} / 2000
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Code */}
        <div className="space-y-1.5">
          <Label htmlFor="item-code">Code</Label>
          <Input
            id="item-code"
            value={code ?? ""}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Optional SKU or code"
            disabled={submitting}
          />
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <Label htmlFor="item-category">
            Category <span className="text-destructive">*</span>
          </Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as ItemCategory)}
            disabled={submitting}
          >
            <SelectTrigger id="item-category" className="w-full h-9">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Default quantity */}
        <div className="space-y-1.5">
          <Label htmlFor="item-default-quantity">
            Default qty <span className="text-destructive">*</span>
          </Label>
          <Input
            id="item-default-quantity"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={defaultQuantity}
            onChange={(e) => setDefaultQuantity(e.target.value)}
            required
            disabled={submitting}
          />
        </div>

        {/* Default unit */}
        <div className="space-y-1.5">
          <Label htmlFor="item-default-unit">Unit</Label>
          <Input
            id="item-default-unit"
            value={defaultUnit ?? ""}
            onChange={(e) => setDefaultUnit(e.target.value)}
            placeholder="hr, sq ft, each"
            disabled={submitting}
          />
        </div>

        {/* Unit price */}
        <div className="space-y-1.5">
          <Label htmlFor="item-unit-price">
            Unit price <span className="text-destructive">*</span>
          </Label>
          <Input
            id="item-unit-price"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            required
            disabled={submitting}
          />
        </div>
      </div>

      {/* Live preview */}
      {showPreview && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Preview:</span>{" "}
          {previewQty} {defaultUnit.trim() || "unit"}
          {previewQty === 1 ? "" : "s"} ×{" "}
          <span className="font-medium text-foreground">
            {currencyFormatter.format(previewPrice)}
          </span>
          {" = "}
          <span className="font-medium text-foreground">
            {currencyFormatter.format(previewQty * previewPrice)}
          </span>
        </div>
      )}

      {/* Damage-type tags */}
      <div className="space-y-1.5">
        <Label>Damage types</Label>
        {damageTypesLoading ? (
          <p className="text-xs text-muted-foreground">Loading damage types...</p>
        ) : damageTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No damage types configured. You can manage them in Settings.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {damageTypes.map((dt) => {
              const selected = damageTypeTags.includes(dt.name);
              return (
                <button
                  key={dt.id}
                  type="button"
                  onClick={() => toggleDamageType(dt.name)}
                  disabled={submitting}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    selected
                      ? "border-transparent shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  style={
                    selected
                      ? { backgroundColor: dt.bg_color, color: dt.text_color }
                      : undefined
                  }
                  aria-pressed={selected}
                >
                  {dt.display_label}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Tap to toggle. Items show up in suggestions when a job matches one of these damage types.
        </p>
      </div>

      {/* Section tags */}
      <div className="space-y-1.5">
        <Label htmlFor="item-section-tag-input">Section tags</Label>
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20">
          {sectionTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeSectionTag(tag)}
                disabled={submitting}
                className="text-primary/70 hover:text-primary disabled:opacity-50"
                aria-label={`Remove ${tag}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            id="item-section-tag-input"
            value={sectionTagInput}
            onChange={(e) => setSectionTagInput(e.target.value)}
            onKeyDown={handleSectionTagKeyDown}
            onBlur={commitSectionTag}
            placeholder={
              sectionTags.length === 0
                ? "Type a tag and press Enter..."
                : "Add another..."
            }
            disabled={submitting}
            className="flex-1 min-w-[8rem] bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Free-text tags used to group items into estimate sections (e.g. &quot;demolition&quot;, &quot;cleanup&quot;).
        </p>
      </div>

      {/* Active toggle (edit mode only) */}
      {isEditMode && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
          <div>
            <Label htmlFor="item-is-active" className="cursor-pointer">
              Active
            </Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Inactive items are hidden from the catalog but kept for historical estimates.
            </p>
          </div>
          <Switch
            id="item-is-active"
            checked={isActive}
            onCheckedChange={setIsActive}
            disabled={submitting}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" variant="gradient" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving...
            </>
          ) : isEditMode ? (
            "Save changes"
          ) : (
            "Create item"
          )}
        </Button>
      </div>
    </form>
  );
}

interface PayloadFields {
  name: string;
  description: string;
  code: string | null;
  category: ItemCategory;
  default_quantity: number;
  default_unit: string | null;
  unit_price: number;
  damage_type_tags: string[];
  section_tags: string[];
}

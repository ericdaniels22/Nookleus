"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ItemCategory, ItemLibraryItem } from "@/lib/types";

interface ItemTableProps {
  items: ItemLibraryItem[];
  onEdit: (item: ItemLibraryItem) => void;
  onToggleActive: (item: ItemLibraryItem) => void;
}

type SortKey = "name" | "category" | "unit_price";
type SortDir = "asc" | "desc";

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  labor: "Labor",
  equipment: "Equipment",
  materials: "Materials",
  services: "Services",
  other: "Other",
};

export function ItemTable({ items, onEdit, onToggleActive }: ItemTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "unit_price") {
        cmp = a.unit_price - b.unit_price;
      } else {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        cmp = String(av).localeCompare(String(bv), undefined, {
          sensitivity: "base",
        });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [items, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" aria-hidden />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" aria-hidden />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" aria-hidden />
    );
  };

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
        No items yet — add your first one.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <button
                type="button"
                onClick={() => toggleSort("name")}
                className="inline-flex items-center font-medium hover:text-foreground/70"
              >
                Name
                {renderSortIcon("name")}
              </button>
            </TableHead>
            <TableHead>Code</TableHead>
            <TableHead>
              <button
                type="button"
                onClick={() => toggleSort("category")}
                className="inline-flex items-center font-medium hover:text-foreground/70"
              >
                Category
                {renderSortIcon("category")}
              </button>
            </TableHead>
            <TableHead className="text-right">
              <button
                type="button"
                onClick={() => toggleSort("unit_price")}
                className="inline-flex items-center font-medium hover:text-foreground/70"
              >
                Unit Price
                {renderSortIcon("unit_price")}
              </button>
            </TableHead>
            <TableHead>Damage Types</TableHead>
            <TableHead>Active</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedItems.map((item) => (
            <TableRow
              key={item.id}
              className={cn(!item.is_active && "opacity-50")}
            >
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <span>{item.name}</span>
                  {!item.is_active && (
                    <Badge variant="outline" className="text-xs">
                      Inactive
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {item.code ?? "—"}
              </TableCell>
              <TableCell>{CATEGORY_LABELS[item.category]}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(item.unit_price)}
              </TableCell>
              <TableCell>
                {item.damage_type_tags.length === 0 ? null : (
                  <div className="flex flex-wrap gap-1">
                    {item.damage_type_tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-xs"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Switch
                  checked={item.is_active}
                  onCheckedChange={() => onToggleActive(item)}
                  aria-label={
                    item.is_active
                      ? `Deactivate ${item.name}`
                      : `Reactivate ${item.name}`
                  }
                />
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(item)}
                  aria-label={`Edit ${item.name}`}
                >
                  <Pencil className="h-4 w-4" />
                  <span className="ml-1">Edit</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

"use client";

import { Briefcase, Layers, Inbox, Tag, Users, ShoppingBag, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Category } from "@/lib/email-categorizer";

// "starred" and "all" are reading views, not stored buckets: "starred" filters
// the inbox to starred mail; "all" is the cross-bucket view (no category
// filter). Everything else maps to a stored `category` value. (#954)
export type CategoryFilter = Category | "starred" | "all";

interface CategoryTabsProps {
  category: CategoryFilter;
  categoryCounts: Record<string, number>;
  onChange: (cat: CategoryFilter) => void;
}

const TABS: { key: CategoryFilter; label: string; icon: LucideIcon }[] = [
  { key: "jobs", label: "Jobs", icon: Briefcase },
  { key: "all", label: "All", icon: Layers },
  { key: "general", label: "General", icon: Inbox },
  { key: "promotions", label: "Promotions", icon: Tag },
  { key: "social", label: "Social", icon: Users },
  { key: "purchases", label: "Purchases", icon: ShoppingBag },
  { key: "starred", label: "Starred", icon: Star },
];

export default function CategoryTabs({
  category,
  categoryCounts,
  onChange,
}: CategoryTabsProps) {
  return (
    <div className="flex overflow-x-auto border-b border-border/50 shrink-0">
      {TABS.map(({ key, label, icon: Icon }) => {
        const isActive = category === key;
        const unread = categoryCounts[key] || 0;

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            title={label}
            aria-label={label}
            className={`px-3 py-2 text-sm flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              isActive
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={16} />
            {isActive && <span>{label}</span>}
            {unread > 0 && (
              <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

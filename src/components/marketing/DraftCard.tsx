"use client";

import { Badge } from "@/components/ui/badge";
import type { MarketingDraft } from "@/lib/types";
import { format } from "date-fns";
import { ImageIcon } from "lucide-react";

const platformClasses: Record<MarketingDraft["platform"], string> = {
  instagram: "bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0",
  facebook: "bg-blue-600 text-white border-0",
  linkedin: "bg-blue-800 text-white border-0",
  gbp: "bg-primary text-primary-foreground border-0",
};

const statusConfig: Record<
  MarketingDraft["status"],
  { label: string; variant?: "outline"; className?: string }
> = {
  draft: { label: "Draft", variant: "outline" },
  ready: {
    label: "Ready",
    className: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  },
  posted: {
    label: "Posted",
    className: "bg-muted text-muted-foreground",
  },
};

interface DraftCardProps {
  draft: MarketingDraft;
  onClick: () => void;
}

export default function DraftCard({ draft, onClick }: DraftCardProps) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const status = statusConfig[draft.status];

  return (
    <div
      onClick={onClick}
      className="cursor-pointer overflow-hidden rounded-xl border bg-card transition hover:border-teal-500/30"
    >
      {/* Image area */}
      {draft.image ? (
        <img
          src={`${supabaseUrl}/storage/v1/object/public/marketing-assets/${draft.image.storage_path}`}
          alt=""
          className="h-32 w-full object-cover"
        />
      ) : draft.image_brief ? (
        <div className="flex h-32 w-full items-center justify-center gap-2 bg-muted/50 text-muted-foreground">
          <ImageIcon className="h-5 w-5" />
          <span className="text-sm">Image suggestion</span>
        </div>
      ) : null}

      {/* Body */}
      <div className="p-4">
        {/* Platform badge */}
        <Badge className={platformClasses[draft.platform]}>
          {draft.platform === "gbp" ? "GBP" : draft.platform.charAt(0).toUpperCase() + draft.platform.slice(1)}
        </Badge>

        {/* Caption preview */}
        <p className="mt-2 text-sm leading-snug">
          {draft.caption.length > 120
            ? draft.caption.slice(0, 120) + "\u2026"
            : draft.caption}
        </p>

        {/* Hashtags preview */}
        {draft.hashtags && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {draft.hashtags}
          </p>
        )}

        {/* Status + date */}
        <div className="mt-3 flex items-center justify-between">
          <Badge variant={status.variant} className={status.className}>
            {status.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {format(new Date(draft.created_at), "MMM d, yyyy")}
          </span>
        </div>
      </div>
    </div>
  );
}

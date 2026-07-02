"use client";

import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2 } from "lucide-react";

export type QbSyncStatus =
  | "pending"
  | "synced"
  | "failed"
  | "not_applicable"
  | null;

export function QbSyncBadge({ status }: { status: QbSyncStatus }) {
  if (status === null || status === "not_applicable") return null;
  if (status === "synced")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <Check className="h-3 w-3 mr-1" />
        Synced to QB
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge className="bg-red-500/15 text-red-300 border border-red-500/30">
        <X className="h-3 w-3 mr-1" />
        QB sync failed
      </Badge>
    );
  if (status === "pending")
    return (
      <Badge className="bg-muted text-muted-foreground">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Syncing to QB&hellip;
      </Badge>
    );
  return null;
}

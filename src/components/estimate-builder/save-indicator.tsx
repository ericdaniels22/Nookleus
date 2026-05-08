"use client";

import { Loader2, Check, AlertTriangle } from "lucide-react";
import type { BuilderMode } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveIndicatorProps {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  mode?: BuilderMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// SaveIndicator
// ─────────────────────────────────────────────────────────────────────────────

export function SaveIndicator({ status, lastSavedAt, mode = "estimate" }: SaveIndicatorProps) {
  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Saving…
      </span>
    );
  }

  if (status === "saved") {
    const timeStr =
      lastSavedAt !== null
        ? lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : null;

    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <Check size={12} />
        {timeStr !== null ? `Saved at ${timeStr}` : "Saved"}
      </span>
    );
  }

  // status === "error"
  return (
    <span className="flex items-center gap-1 text-xs text-destructive">
      <AlertTriangle size={12} />
      Save failed — retrying
    </span>
  );
}

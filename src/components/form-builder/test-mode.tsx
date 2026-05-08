"use client";

import { ArrowLeft } from "lucide-react";
import IntakeForm from "@/components/intake-form";

export function TestMode({ onExit }: { onExit: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back to edit
        </button>
        <span className="text-xs text-muted-foreground">
          Test mode — submissions are not saved
        </span>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <IntakeForm testMode />
      </div>
    </div>
  );
}

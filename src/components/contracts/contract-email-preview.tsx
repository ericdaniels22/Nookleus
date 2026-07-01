"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, FileText, Bell } from "lucide-react";
import type { ContractEmailSettings } from "@/lib/contracts/types";
import type { ContractEmailFrameInput } from "@/lib/contracts/email-frame";

type PreviewKind = ContractEmailFrameInput["kind"];

interface Props {
  // The live editor state, including unsaved edits — passed straight through as
  // draftSettings so the preview mirrors exactly what the contractor is typing.
  settings: Partial<ContractEmailSettings>;
}

const KINDS: Array<{ value: PreviewKind; label: string; Icon: typeof FileText }> = [
  { value: "signing_request", label: "Signing request", Icon: FileText },
  { value: "reminder", label: "Reminder", Icon: Bell },
];

// Live preview of the branded contract email in the Settings editor. It POSTs
// the current (unsaved) settings to /api/contracts/email-preview and shows the
// rendered card in an isolated iframe — the same engine the real send uses, so
// what you see here is what recipients get (#695, ADR 0017 §6). Job-less, so
// merge fields resolve to sample values.
export default function ContractEmailPreview({ settings }: Props) {
  const [kind, setKind] = useState<PreviewKind>("signing_request");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce so a burst of keystrokes collapses into one render request.
  const draft = JSON.stringify(settings);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setError(null);
      fetch("/api/contracts/email-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, draftSettings: JSON.parse(draft) }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((data as { error?: string }).error || "Preview failed");
          return data as { html: string };
        })
        .then((data) => {
          if (!cancelled) setHtml(data.html);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Preview failed");
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, kind]);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Live preview</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            The real branded email with sample recipient data. Updates as you edit.
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {KINDS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                kind === value
                  ? "bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-border bg-white">
        {error ? (
          <div className="flex items-center justify-center gap-2 text-sm text-amber-600 py-20">
            <AlertTriangle size={16} /> {error}
          </div>
        ) : html === null ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-20 bg-background/40">
            <Loader2 size={16} className="animate-spin" /> Rendering preview…
          </div>
        ) : (
          <iframe
            srcDoc={html}
            title="Contract email preview"
            className="w-full h-[560px] border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}

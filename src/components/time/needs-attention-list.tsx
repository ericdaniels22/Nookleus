"use client";

// src/components/time/needs-attention-list.tsx — the lead's "needs attention"
// list for a Job (#706, AC5/AC4/AC6).
//
// The server (GET /api/time/sessions/needs-attention) returns the Open sessions
// past ~12h (the classic forgotten clock-out) for THIS Job across all workers,
// plus the ONE Organization timezone to display them in (ADR 0020). Each entry
// is amber and is the ENTRY POINT to a Correction: opening one reveals the
// Correction form inline. Hand-entered sessions are marked here too (AC4).
//
// Gated on manage_timesheets (AC6): a crew member never sees this surface — and,
// because the gate short-circuits before the effect's fetch, never even asks
// the server for it.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { captureLabel } from "@/lib/timesheets/capture-marker";
import { CorrectionForm, type CorrectionFormSession } from "./correction-form";

interface NeedsAttentionSession {
  sessionId: string;
  jobId: string;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  capture: "live" | "hand";
  workerName: string | null;
}

/** Render a UTC instant as a wall-clock in the Org timezone (display only). */
function showInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function NeedsAttentionList({ jobId }: { jobId: string }) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission("manage_timesheets");

  const [sessions, setSessions] = useState<NeedsAttentionSession[]>([]);
  const [timeZone, setTimeZone] = useState("UTC");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    // AC6 — never fetch the lead surface for an ungated user.
    if (!allowed) return;
    // setState lives in the .then() callback, not the effect body, so the
    // react-hooks/set-state-in-effect lint rule stays satisfied (same pattern
    // as job-cover-picker.tsx).
    fetch(`/api/time/sessions/needs-attention?jobId=${encodeURIComponent(jobId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { sessions?: NeedsAttentionSession[]; timeZone?: string } | null) => {
        if (!body) return;
        setSessions(body.sessions ?? []);
        setTimeZone(body.timeZone ?? "UTC");
      })
      .catch(() => {
        // Network/parse failure — leave the last good state in place.
      });
  }, [allowed, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  // AC6 — a crew member sees nothing at all.
  if (!allowed) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">
        Needs attention ({sessions.length})
      </h3>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing needs attention right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const marker = captureLabel(s.capture);
            const open = selectedId === s.sessionId;
            return (
              <li
                key={s.sessionId}
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {s.workerName ?? "Unknown worker"}
                      </span>
                      {marker ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          {marker}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Clocked in {showInZone(s.startedAt, timeZone)} — still open
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(open ? null : s.sessionId)}
                    className="shrink-0 text-sm font-medium text-amber-700 hover:underline"
                  >
                    {open ? "Close" : "Correct"}
                  </button>
                </div>

                {open ? (
                  <div className="mt-4 border-t border-amber-500/20 pt-4">
                    <CorrectionForm
                      session={s as CorrectionFormSession}
                      timeZone={timeZone}
                      onCorrected={() => {
                        setSelectedId(null);
                        void load();
                      }}
                      onCancel={() => setSelectedId(null)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

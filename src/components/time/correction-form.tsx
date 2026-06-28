"use client";

// src/components/time/correction-form.tsx — the Correction form (#706, AC1).
//
// A lead/admin opens a recorded Time session and TYPES the real clock-in/out.
// Integrity rules (ADR 0019): the app NEVER pre-fills, suggests, rounds, or
// fabricates a time — the inputs start empty and stay empty until the lead
// types. A blank field means "leave this side unchanged", so a lead can correct
// just the clock-in OR just the clock-out.
//
// A typed value is a civil wall-clock with no zone ("YYYY-MM-DDTHH:mm"). ADR
// 0020 forbids reading it against the device clock: it is anchored in the ONE
// Organization timezone (passed in from the server) before becoming the UTC
// instant we PATCH. The server validates the span and rejects a bad one; we
// surface that. A good save refetches and closes.

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { instantFromZonedWallClock } from "@/lib/timesheets/zoned-wall-clock";
import { captureLabel } from "@/lib/timesheets/capture-marker";

export interface CorrectionFormSession {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  workerName?: string | null;
  capture?: "live" | "hand";
}

/** Render a UTC instant as a wall-clock in the Org timezone (display only). */
function showInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function CorrectionForm({
  session,
  timeZone,
  onCorrected,
  onCancel,
}: {
  session: CorrectionFormSession;
  timeZone: string;
  onCorrected: () => void;
  onCancel?: () => void;
}) {
  // Never pre-filled (ADR 0019): the inputs begin empty and the lead types.
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marker = captureLabel(session.capture ?? "live");

  async function handleSave() {
    setError(null);

    // Build the body from only the fields the lead actually typed. A blank
    // field is "unchanged" — anchor a typed one in the Org zone (ADR 0020).
    const body: { startedAt?: string; endedAt?: string } = {};
    try {
      if (startedAt.trim()) {
        body.startedAt = instantFromZonedWallClock(startedAt, timeZone);
      }
      if (endedAt.trim()) {
        body.endedAt = instantFromZonedWallClock(endedAt, timeZone);
      }
    } catch {
      setError("Enter a valid time.");
      return;
    }

    // The app never fabricates: an empty Correction changes nothing, so refuse
    // it here rather than posting an a-no-op (ADR 0019).
    if (body.startedAt === undefined && body.endedAt === undefined) {
      setError("Enter a corrected clock-in or clock-out time.");
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/time/sessions/${session.sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Couldn't save the correction.");
      setSaving(false);
      return;
    }

    toast.success("Correction saved.");
    setSaving(false);
    onCorrected();
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Correcting{" "}
        <span className="font-medium text-foreground">
          {session.workerName ?? "this worker"}
        </span>
        ’s session.
        {marker ? (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            {marker}
          </span>
        ) : null}
      </div>

      <div className="text-xs text-muted-foreground">
        Currently recorded: {showInZone(session.startedAt, timeZone)} —{" "}
        {session.endedAt ? showInZone(session.endedAt, timeZone) : "still open"}
      </div>

      <div>
        <label
          htmlFor="correction-started"
          className="mb-1 block text-sm font-medium text-muted-foreground"
        >
          Clock in
        </label>
        <Input
          id="correction-started"
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
        />
      </div>

      <div>
        <label
          htmlFor="correction-ended"
          className="mb-1 block text-sm font-medium text-muted-foreground"
        >
          Clock out
        </label>
        <Input
          id="correction-ended"
          type="datetime-local"
          value={endedAt}
          onChange={(e) => setEndedAt(e.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button variant="gradient" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save correction"}
        </Button>
      </div>
    </div>
  );
}

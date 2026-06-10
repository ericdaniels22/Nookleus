"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { RECORDING_CONSENT_NOTICE } from "@/lib/phone/recording-consent";

// PRD #304 — Nookleus Phone. Slice 11 (#315).
//
// Settings → Phone → Recording tab. The org-level "Record calls by default"
// toggle, backed by organizations.recording_enabled_default. Any teammate with
// view_phone sees the current state; only an admin can flip it (ADR 0005 —
// org-wide recording is a Shared-scope admin action). Existing recordings are
// unaffected by toggling off; only NEW calls stop recording.

export function RecordingSettingsTab() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/phone/recording-settings");
      if (!res.ok) {
        setError("Failed to load recording setting");
        return;
      }
      const body = (await res.json()) as { recording_enabled_default: boolean };
      setEnabled(body.recording_enabled_default);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = useCallback(async () => {
    if (!isAdmin || saving) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/phone/recording-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recording_enabled_default: next }),
      });
      if (!res.ok) {
        setEnabled(!next); // revert
        setError("Failed to save");
      }
    } catch {
      setEnabled(!next); // revert
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [enabled, isAdmin, saving]);

  if (loading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-3 p-4">
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!isAdmin || saving}
          onChange={() => void onToggle()}
          aria-label="Record calls by default"
          className="h-4 w-4"
        />
        <span className="font-medium text-foreground">
          Record calls by default
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        When on, every voice call is recorded and both parties hear a consent
        notice at the start: “{RECORDING_CONSENT_NOTICE}” Turning it off stops
        new calls from recording; existing recordings are unaffected.
        {isAdmin ? "" : " Only an admin can change this."}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  TIMEZONE_SETTING_KEY,
  TIMEZONE_OPTIONS,
  isValidIanaZone,
  stateToDefaultZone,
  resolveOrganizationTimezone,
} from "@/lib/timesheets/org-timezone";

// #704 (ADR 0020) — the authoritative Organization timezone, the single zone all
// labor-hour classification buckets into server-side. It lives alongside the
// business profile/address as one `timezone` key in `company_settings`. When the
// key is unset the UI PROPOSES a default derived purely from the saved
// business-address state (the static US-state → IANA map in
// `resolveOrganizationTimezone`); the proposal is never persisted until the
// owner explicitly Saves. Editing is gated by `access_settings`, the same as the
// rest of Company Settings (the GET/PUT route enforces it server-side).

// When a saved zone isn't one of the curated options (an owner could have an
// exotic stored value), surface it so the <select> can still show it selected.
function optionsIncluding(zone: string) {
  if (TIMEZONE_OPTIONS.some((o) => o.value === zone)) return TIMEZONE_OPTIONS;
  return [{ value: zone, label: zone }, ...TIMEZONE_OPTIONS];
}

export function TimezoneSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(""); // the zone shown in the dropdown
  const [hasSaved, setHasSaved] = useState(false); // a valid stored value exists
  const [addressState, setAddressState] = useState(""); // saved business state

  useEffect(() => {
    fetch("/api/settings/company")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Record<string, string> | null) => {
        if (!data) return;
        const storedValid = isValidIanaZone(data[TIMEZONE_SETTING_KEY]);
        setHasSaved(storedValid);
        setAddressState(data.address_state || "");
        // A valid stored value shows as-is; otherwise the dropdown opens on the
        // resolver's proposal (address-derived default, else UTC) — but nothing
        // is persisted until Save.
        setSelected(resolveOrganizationTimezone(data));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [TIMEZONE_SETTING_KEY]: selected }),
      });
      if (res.ok) {
        setHasSaved(true);
        toast.success("Organization timezone saved");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save timezone");
      }
    } catch {
      toast.error("Failed to save timezone");
    }
    setSaving(false);
  }

  if (loading) return null;

  const proposedFromState = stateToDefaultZone(addressState);
  // The helper line: confirm a saved value, or explain where the proposal came
  // from so the owner knows it isn't persisted yet.
  const hint = hasSaved
    ? "Saved. Labor hours on timesheets are classified in this zone."
    : proposedFromState
      ? `Proposed from your ${addressState.trim().toUpperCase()} business address. Save to confirm.`
      : "No business-address state saved — defaulting to UTC. Pick a zone and Save.";

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <label
        htmlFor="org-timezone"
        className="block text-sm font-medium text-foreground mb-1"
      >
        Organization Timezone
      </label>
      <p className="text-xs text-muted-foreground mb-3">
        Crew hours are classified into Regular and Premium time in this single
        zone, no matter which device recorded them.
      </p>
      <select
        id="org-timezone"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
      >
        {optionsIncluding(selected).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted-foreground mt-2">{hint}</p>

      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? "Saving..." : "Save Timezone"}
        </button>
      </div>
    </div>
  );
}

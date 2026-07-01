"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const DEFAULTS = {
  brand_primary: "#0F6E56",
  brand_secondary: "#1B2B4B",
  brand_accent: "#C41E2A",
};

export function AppearanceSection() {
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [primary, setPrimary] = useState(DEFAULTS.brand_primary);
  const [secondary, setSecondary] = useState(DEFAULTS.brand_secondary);
  const [accent, setAccent] = useState(DEFAULTS.brand_accent);

  // Load saved brand colors
  useEffect(() => {
    fetch("/api/settings/appearance")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: Record<string, string> | null) => {
        if (!data) return;
        if (data.brand_primary) setPrimary(data.brand_primary);
        if (data.brand_secondary) setSecondary(data.brand_secondary);
        if (data.brand_accent) setAccent(data.brand_accent);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Apply colors live as they change
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--brand-primary", primary);
    root.style.setProperty("--brand-secondary", secondary);
    root.style.setProperty("--brand-accent", accent);
  }, [primary, secondary, accent]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/appearance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_primary: primary,
          brand_secondary: secondary,
          brand_accent: accent,
        }),
      });
      if (res.ok) {
        toast.success("Appearance settings saved");
      } else {
        toast.error("Failed to save appearance settings");
      }
    } catch {
      toast.error("Failed to save appearance settings");
    }
    setSaving(false);
  }

  function handleReset() {
    setPrimary(DEFAULTS.brand_primary);
    setSecondary(DEFAULTS.brand_secondary);
    setAccent(DEFAULTS.brand_accent);
    toast.success("Colors reset to defaults");
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Customize the look and feel of your platform.
        </p>
      </div>

      {/* Brand Colors */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-foreground">
            Brand Colors
          </label>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw size={12} />
            Reset to Defaults
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          These colors are used across buttons, badges, and accents throughout the app.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ColorPicker
            label="Primary"
            description="Buttons, active states, progress bars"
            value={primary}
            onChange={setPrimary}
            defaultValue={DEFAULTS.brand_primary}
          />
          <ColorPicker
            label="Secondary"
            description="Headings, sidebar background"
            value={secondary}
            onChange={setSecondary}
            defaultValue={DEFAULTS.brand_secondary}
          />
          <ColorPicker
            label="Accent"
            description="Alerts, highlights, badges"
            value={accent}
            onChange={setAccent}
            defaultValue={DEFAULTS.brand_accent}
          />
        </div>
      </div>

      {/* Live Preview */}
      <div className="bg-card rounded-xl border border-border p-6">
        <label className="block text-sm font-medium text-foreground mb-4">
          Preview
        </label>
        <div className="space-y-4">
          {/* Sample buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: primary }}
            >
              Primary Button
            </button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: secondary }}
            >
              Secondary Button
            </button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: accent }}
            >
              Accent Button
            </button>
          </div>

          {/* Sample badges */}
          <div className="flex flex-wrap gap-2">
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: primary + "1A", color: primary }}
            >
              In Progress
            </span>
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: secondary + "1A", color: secondary }}
            >
              Scheduled
            </span>
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: accent + "1A", color: accent }}
            >
              Emergency
            </span>
          </div>

          {/* Sample card */}
          <div
            className="rounded-lg border p-4"
            style={{ borderLeftWidth: 4, borderLeftColor: primary }}
          >
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Jobs</p>
            <p className="text-2xl font-bold text-foreground mt-1">12</p>
          </div>

          {/* Sample progress bar */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Payment progress</p>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
              <div className="h-full rounded-l-full" style={{ width: "45%", backgroundColor: primary }} />
              <div className="h-full" style={{ width: "25%", backgroundColor: secondary }} />
              <div className="h-full rounded-r-full" style={{ width: "10%", backgroundColor: accent }} />
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-50 transition-all"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function ColorPicker({
  label,
  description,
  value,
  onChange,
  defaultValue,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  defaultValue: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {value !== defaultValue && (
          <button
            onClick={() => onChange(defaultValue)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-10 h-10 rounded-lg border border-border cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
          />
        </div>
        <div className="flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-card text-sm font-mono text-foreground uppercase focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            maxLength={7}
          />
          <p className="text-[10px] text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
    </div>
  );
}

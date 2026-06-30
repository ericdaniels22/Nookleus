"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Plus, Check } from "lucide-react";
import { toast } from "sonner";
import type { QuickPickLabel } from "@/lib/types";

// Quick-pick labels (#819) — reusable phrases an org saves so a user can later
// tap one to apply as a Label on an Annotation. This page lists the org's
// labels (shared defaults + the org's own rows) and lets an admin add one.
// Mirrors the damage-types catalog tab (list + add); edit/reorder/delete land
// in later slices.
export function QuickPickLabelsTab() {
  const [labels, setLabels] = useState<QuickPickLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const fetchLabels = useCallback(async () => {
    const res = await fetch("/api/settings/quick-pick-labels");
    if (res.ok) {
      const data = await res.json();
      setLabels(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  async function handleAdd() {
    if (!newLabel.trim()) {
      toast.error("Label is required");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/settings/quick-pick-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim() }),
    });
    if (res.ok) {
      toast.success("Quick-pick label added");
      setNewLabel("");
      setShowAdd(false);
      fetchLabels();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to add label");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Quick-pick Labels
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reusable phrases your team can tap to label a photo annotation.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        >
          <Plus size={16} />
          Add Label
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">New Quick-pick Label</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Label
              </label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                placeholder="e.g. Source of loss"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all disabled:opacity-50"
            >
              <Check size={14} /> Add
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Label list */}
      {labels.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No quick-pick labels yet.
        </div>
      ) : (
        <div className="space-y-1">
          {labels.map((ql) => (
            <div
              key={ql.id}
              className="bg-card rounded-xl border border-border p-3 flex items-center gap-3"
            >
              <span className="text-sm text-foreground font-medium">
                {ql.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

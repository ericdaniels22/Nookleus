"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil, GripVertical, Check, X, Lock } from "lucide-react";
import { toast } from "sonner";
import { QUICK_PICK_LABEL_MAX_LENGTH, type QuickPickLabel } from "@/lib/types";
import {
  buildReorderPayload,
  isDefaultLabel,
  moveOrgLabel,
} from "@/lib/jobs/quick-pick-labels";

// Quick-pick labels (#819, #820) — reusable phrases an org saves so a user can
// later tap one to apply as a Label on an Annotation. This page lists the org's
// labels (shared NULL-org defaults + the org's own rows) and lets an admin add,
// rename (inline), reorder, and delete the org-owned ones. Built-in defaults
// stay protected: they show a lock and expose no delete control. Mirrors the
// damage-types catalog tab.
export function QuickPickLabelsTab() {
  const [labels, setLabels] = useState<QuickPickLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

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

  function startEdit(ql: QuickPickLabel) {
    setEditId(ql.id);
    setEditLabel(ql.label);
  }

  // Inline edit sends the single-object PUT (id + new text + its position).
  async function handleSaveEdit() {
    const trimmed = editLabel.trim();
    if (!editId || !trimmed) {
      toast.error("Label is required");
      return;
    }
    const current = labels.find((ql) => ql.id === editId);
    setSaving(true);
    const res = await fetch("/api/settings/quick-pick-labels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editId, label: trimmed, sort_order: current?.sort_order }),
    });
    if (res.ok) {
      toast.success("Quick-pick label updated");
      setEditId(null);
      fetchLabels();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to update");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/settings/quick-pick-labels?id=${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Quick-pick label deleted");
      fetchLabels();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to delete");
    }
  }

  // `orgIndex` is the position among the org's own (movable) rows — the
  // defaults are pinned on top and never move. moveOrgLabel returns a no-op
  // order at the boundaries, so the optimistic update is a clean skip there.
  function moveUp(orgIndex: number) {
    applyReorder(moveOrgLabel(labels, orgIndex, "up"));
  }

  function moveDown(orgIndex: number) {
    applyReorder(moveOrgLabel(labels, orgIndex, "down"));
  }

  // Optimistically show the new order, then await the write. On failure, snap
  // the UI back to the true persisted order (re-fetch) and surface a toast —
  // no silent fire-and-forget, no optimistic order that the DB never accepted.
  async function applyReorder(reordered: QuickPickLabel[]) {
    setLabels(reordered);
    const ok = await saveSortOrder(reordered);
    if (!ok) {
      toast.error("Failed to reorder labels");
      fetchLabels();
    }
  }

  // Reorder sends the array (bulk) PUT scoped to the org's own rows, each given
  // a collision-free sort_order above every default's. Returns whether the
  // write succeeded so the caller can revert on failure.
  async function saveSortOrder(items: QuickPickLabel[]): Promise<boolean> {
    try {
      const res = await fetch("/api/settings/quick-pick-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildReorderPayload(items)),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  // Shared defaults pin to the top; the org's own rows follow and are movable.
  const defaults = labels.filter(isDefaultLabel);
  const orgRows = labels.filter((ql) => !isDefaultLabel(ql));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Quick-pick Labels
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reusable phrases your team can tap to label a photo annotation.
            Default labels cannot be deleted.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
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
                maxLength={QUICK_PICK_LABEL_MAX_LENGTH}
                placeholder="e.g. Source of loss"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
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
          {/* Defaults are pinned on top (immovable); the org's own rows follow
              and are the only ones that can be reordered (#856). */}
          {[...defaults, ...orgRows].map((ql) => {
            const isDefault = isDefaultLabel(ql);
            const orgIndex = isDefault ? -1 : orgRows.indexOf(ql);
            return (
              <div
                key={ql.id}
                className="bg-card rounded-xl border border-border p-3 flex items-center gap-3"
              >
                {/* Reorder — org rows only; defaults keep an empty slot for
                    alignment and show a Lock alongside their text instead. */}
                <div className="flex flex-col gap-0.5 w-[14px]">
                  {!isDefault && (
                    <>
                      <button
                        aria-label={`Move ${ql.label} up`}
                        onClick={() => moveUp(orgIndex)}
                        disabled={orgIndex === 0}
                        className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        <GripVertical size={14} className="rotate-180" />
                      </button>
                      <button
                        aria-label={`Move ${ql.label} down`}
                        onClick={() => moveDown(orgIndex)}
                        disabled={orgIndex === orgRows.length - 1}
                        className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        <GripVertical size={14} />
                      </button>
                    </>
                  )}
                </div>

                {/* Edit or display */}
                {editId === ql.id ? (
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <Input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") setEditId(null);
                      }}
                      maxLength={QUICK_PICK_LABEL_MAX_LENGTH}
                      autoFocus
                      className="h-8 text-sm flex-1 min-w-[120px]"
                    />
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      aria-label="Save label"
                      className="p-1.5 rounded-lg text-primary hover:bg-primary/10"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      aria-label="Cancel edit"
                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm text-foreground font-medium">
                      {ql.label}
                    </span>
                    <div className="flex items-center gap-1">
                      {/* Default rows are read-only: the route 403s mutations to
                          them, so showing Edit/Delete would only ever no-op. The
                          Lock signals that; no Edit or Delete control here (#857). */}
                      {isDefault ? (
                        <Lock size={12} className="text-muted-foreground/40 mr-1" />
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(ql)}
                            aria-label={`Edit ${ql.label}`}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(ql.id)}
                            aria-label={`Delete ${ql.label}`}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

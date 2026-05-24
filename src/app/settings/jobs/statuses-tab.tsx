"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Trash2,
  Pencil,
  GripVertical,
  Check,
  X,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import type { JobStatus } from "@/lib/types";

export function StatusesTab() {
  const [statuses, setStatuses] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newBg, setNewBg] = useState("#E1F5EE");
  const [newText, setNewText] = useState("#085041");

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editBg, setEditBg] = useState("");
  const [editText, setEditText] = useState("");

  const fetchStatuses = useCallback(async () => {
    const res = await fetch("/api/settings/statuses");
    if (res.ok) {
      const data = await res.json();
      setStatuses(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  async function handleAdd() {
    if (!newLabel.trim()) {
      toast.error("Display label is required");
      return;
    }
    const name = newLabel.trim().toLowerCase().replace(/\s+/g, "_");
    const res = await fetch("/api/settings/statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        display_label: newLabel.trim(),
        bg_color: newBg,
        text_color: newText,
      }),
    });
    if (res.ok) {
      toast.success("Status added");
      setNewLabel("");
      setShowAdd(false);
      fetchStatuses();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to add status");
    }
  }

  function startEdit(s: JobStatus) {
    setEditId(s.id);
    setEditLabel(s.display_label);
    setEditBg(s.bg_color);
    setEditText(s.text_color);
  }

  async function handleSaveEdit() {
    if (!editId || !editLabel.trim()) return;
    const updated = statuses.map((s) =>
      s.id === editId
        ? { ...s, display_label: editLabel.trim(), bg_color: editBg, text_color: editText }
        : s
    );
    setSaving(true);
    const res = await fetch("/api/settings/statuses", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        updated.map((s, i) => ({
          id: s.id,
          display_label: s.display_label,
          bg_color: s.bg_color,
          text_color: s.text_color,
          sort_order: i + 1,
        }))
      ),
    });
    if (res.ok) {
      toast.success("Status updated");
      setEditId(null);
      fetchStatuses();
    } else {
      toast.error("Failed to update");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/settings/statuses?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Status deleted");
      fetchStatuses();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to delete");
    }
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const updated = [...statuses];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setStatuses(updated);
    saveSortOrder(updated);
  }

  function moveDown(index: number) {
    if (index === statuses.length - 1) return;
    const updated = [...statuses];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setStatuses(updated);
    saveSortOrder(updated);
  }

  async function saveSortOrder(items: JobStatus[]) {
    await fetch("/api/settings/statuses", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        items.map((s, i) => ({
          id: s.id,
          display_label: s.display_label,
          bg_color: s.bg_color,
          text_color: s.text_color,
          sort_order: i + 1,
        }))
      ),
    });
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Job Statuses</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure the statuses available for jobs. Default statuses cannot be deleted.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        >
          <Plus size={16} />
          Add Status
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">New Status</p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Display Label</label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Waiting on Adjuster"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Background</label>
              <input type="color" value={newBg} onChange={(e) => setNewBg(e.target.value)}
                className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Text</label>
              <input type="color" value={newText} onChange={(e) => setNewText(e.target.value)}
                className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <div className="flex gap-1.5">
              <span
                className="px-2.5 py-1 rounded-full text-xs font-medium self-center"
                style={{ backgroundColor: newBg, color: newText }}
              >
                {newLabel || "Preview"}
              </span>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleAdd}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all">
              <Check size={14} /> Add
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status list */}
      <div className="space-y-1">
        {statuses.map((status, index) => (
          <div
            key={status.id}
            className="bg-card rounded-xl border border-border p-3 flex items-center gap-3"
          >
            {/* Reorder */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => moveUp(index)}
                disabled={index === 0}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <GripVertical size={14} className="rotate-180" />
              </button>
              <button
                onClick={() => moveDown(index)}
                disabled={index === statuses.length - 1}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <GripVertical size={14} />
              </button>
            </div>

            {/* Badge preview */}
            <span
              className="px-2.5 py-1 rounded-full text-xs font-medium shrink-0 min-w-[100px] text-center"
              style={{
                backgroundColor: editId === status.id ? editBg : status.bg_color,
                color: editId === status.id ? editText : status.text_color,
              }}
            >
              {editId === status.id ? editLabel : status.display_label}
            </span>

            {/* Name */}
            {editId === status.id ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="h-8 text-sm"
                />
                <input type="color" value={editBg} onChange={(e) => setEditBg(e.target.value)}
                  className="w-8 h-8 rounded border border-border cursor-pointer shrink-0" />
                <input type="color" value={editText} onChange={(e) => setEditText(e.target.value)}
                  className="w-8 h-8 rounded border border-border cursor-pointer shrink-0" />
                <button onClick={handleSaveEdit} disabled={saving}
                  className="p-1.5 rounded-lg text-primary hover:bg-primary/10">
                  <Check size={16} />
                </button>
                <button onClick={() => setEditId(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground font-medium">{status.display_label}</span>
                  <span className="text-xs text-muted-foreground ml-2">({status.name})</span>
                </div>
                <div className="flex items-center gap-1">
                  {status.is_default && (
                    <Lock size={12} className="text-muted-foreground/40 mr-1" />
                  )}
                  <button onClick={() => startEdit(status)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
                    <Pencil size={14} />
                  </button>
                  {!status.is_default && (
                    <button onClick={() => handleDelete(status.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

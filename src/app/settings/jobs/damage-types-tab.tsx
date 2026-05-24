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
import type { DamageType } from "@/lib/types";

export function DamageTypesTab() {
  const [types, setTypes] = useState<DamageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newBg, setNewBg] = useState("#E6F1FB");
  const [newText, setNewText] = useState("#0C447C");
  const [newIcon, setNewIcon] = useState("");

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editBg, setEditBg] = useState("");
  const [editText, setEditText] = useState("");
  const [editIcon, setEditIcon] = useState("");

  const fetchTypes = useCallback(async () => {
    const res = await fetch("/api/settings/damage-types");
    if (res.ok) {
      const data = await res.json();
      setTypes(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  async function handleAdd() {
    if (!newLabel.trim()) {
      toast.error("Display label is required");
      return;
    }
    const name = newLabel.trim().toLowerCase().replace(/\s+/g, "_");
    const res = await fetch("/api/settings/damage-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        display_label: newLabel.trim(),
        bg_color: newBg,
        text_color: newText,
        icon: newIcon.trim() || null,
      }),
    });
    if (res.ok) {
      toast.success("Damage type added");
      setNewLabel("");
      setNewIcon("");
      setShowAdd(false);
      fetchTypes();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to add damage type");
    }
  }

  function startEdit(dt: DamageType) {
    setEditId(dt.id);
    setEditLabel(dt.display_label);
    setEditBg(dt.bg_color);
    setEditText(dt.text_color);
    setEditIcon(dt.icon || "");
  }

  async function handleSaveEdit() {
    if (!editId || !editLabel.trim()) return;
    const updated = types.map((dt) =>
      dt.id === editId
        ? { ...dt, display_label: editLabel.trim(), bg_color: editBg, text_color: editText, icon: editIcon.trim() || null }
        : dt
    );
    setSaving(true);
    const res = await fetch("/api/settings/damage-types", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        updated.map((dt, i) => ({
          id: dt.id,
          display_label: dt.display_label,
          bg_color: dt.bg_color,
          text_color: dt.text_color,
          icon: dt.icon,
          sort_order: i + 1,
        }))
      ),
    });
    if (res.ok) {
      toast.success("Damage type updated");
      setEditId(null);
      fetchTypes();
    } else {
      toast.error("Failed to update");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/settings/damage-types?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Damage type deleted");
      fetchTypes();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to delete");
    }
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const updated = [...types];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setTypes(updated);
    saveSortOrder(updated);
  }

  function moveDown(index: number) {
    if (index === types.length - 1) return;
    const updated = [...types];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setTypes(updated);
    saveSortOrder(updated);
  }

  async function saveSortOrder(items: DamageType[]) {
    await fetch("/api/settings/damage-types", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        items.map((dt, i) => ({
          id: dt.id,
          display_label: dt.display_label,
          bg_color: dt.bg_color,
          text_color: dt.text_color,
          icon: dt.icon,
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
          <h2 className="text-lg font-semibold text-foreground">Damage Types</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure the damage types available for jobs. Default types cannot be deleted.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        >
          <Plus size={16} />
          Add Type
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">New Damage Type</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Display Label</label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Sewage" />
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Icon (Lucide name)</label>
              <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="e.g. Droplets" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">BG</label>
              <input type="color" value={newBg} onChange={(e) => setNewBg(e.target.value)}
                className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Text</label>
              <input type="color" value={newText} onChange={(e) => setNewText(e.target.value)}
                className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <span
              className="px-2.5 py-1 rounded-full text-xs font-medium self-center"
              style={{ backgroundColor: newBg, color: newText }}
            >
              {newLabel || "Preview"}
            </span>
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

      {/* Type list */}
      <div className="space-y-1">
        {types.map((dtype, index) => (
          <div
            key={dtype.id}
            className="bg-card rounded-xl border border-border p-3 flex items-center gap-3"
          >
            {/* Reorder */}
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveUp(index)} disabled={index === 0}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed">
                <GripVertical size={14} className="rotate-180" />
              </button>
              <button onClick={() => moveDown(index)} disabled={index === types.length - 1}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed">
                <GripVertical size={14} />
              </button>
            </div>

            {/* Badge preview */}
            <span
              className="px-2.5 py-1 rounded-full text-xs font-medium shrink-0 min-w-[80px] text-center"
              style={{
                backgroundColor: editId === dtype.id ? editBg : dtype.bg_color,
                color: editId === dtype.id ? editText : dtype.text_color,
              }}
            >
              {editId === dtype.id ? editLabel : dtype.display_label}
            </span>

            {/* Edit or display */}
            {editId === dtype.id ? (
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-8 text-sm flex-1 min-w-[120px]" />
                <Input value={editIcon} onChange={(e) => setEditIcon(e.target.value)} placeholder="Icon" className="h-8 text-sm w-24" />
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
                  <span className="text-sm text-foreground font-medium">{dtype.display_label}</span>
                  <span className="text-xs text-muted-foreground ml-2">({dtype.name})</span>
                  {dtype.icon && <span className="text-xs text-muted-foreground/60 ml-1.5">{dtype.icon}</span>}
                </div>
                <div className="flex items-center gap-1">
                  {dtype.is_default && <Lock size={12} className="text-muted-foreground/40 mr-1" />}
                  <button onClick={() => startEdit(dtype)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
                    <Pencil size={14} />
                  </button>
                  {!dtype.is_default && (
                    <button onClick={() => handleDelete(dtype.id)}
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

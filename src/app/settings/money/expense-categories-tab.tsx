"use client";

// #230 — extracted body of the pre-redesign /settings/expense-categories
// page. The only change from the original is renaming the default export
// to a named `ExpenseCategoriesTab`. UI and behavior are unchanged.

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil, GripVertical, Check, X, Lock } from "lucide-react";
import { toast } from "sonner";
import type { ExpenseCategory } from "@/lib/types";

export function ExpenseCategoriesTab() {
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newBg, setNewBg] = useState("#E6F1FB");
  const [newText, setNewText] = useState("#0C447C");
  const [newIcon, setNewIcon] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editBg, setEditBg] = useState("");
  const [editText, setEditText] = useState("");
  const [editIcon, setEditIcon] = useState("");

  const fetchCats = useCallback(async () => {
    const res = await fetch("/api/settings/expense-categories");
    if (res.ok) setCats(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchCats(); }, [fetchCats]);

  async function handleAdd() {
    if (!newLabel.trim()) { toast.error("Display label is required"); return; }
    const name = newLabel.trim().toLowerCase().replace(/\s+/g, "_");
    const res = await fetch("/api/settings/expense-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, display_label: newLabel.trim(),
        bg_color: newBg, text_color: newText,
        icon: newIcon.trim() || null,
      }),
    });
    if (res.ok) { toast.success("Category added"); setNewLabel(""); setNewIcon(""); setShowAdd(false); fetchCats(); }
    else { const err = await res.json().catch(() => ({})); toast.error(err.error || "Failed to add"); }
  }

  function startEdit(c: ExpenseCategory) {
    setEditId(c.id); setEditLabel(c.display_label);
    setEditBg(c.bg_color); setEditText(c.text_color);
    setEditIcon(c.icon || "");
  }

  async function saveOrder(items: ExpenseCategory[]) {
    await fetch("/api/settings/expense-categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items.map((c, i) => ({
        id: c.id, display_label: c.display_label,
        bg_color: c.bg_color, text_color: c.text_color,
        icon: c.icon, sort_order: i + 1,
      }))),
    });
  }

  async function handleSaveEdit() {
    if (!editId || !editLabel.trim()) return;
    const updated = cats.map((c) => c.id === editId
      ? { ...c, display_label: editLabel.trim(), bg_color: editBg, text_color: editText, icon: editIcon.trim() || null }
      : c
    );
    setSaving(true);
    await saveOrder(updated);
    toast.success("Category updated");
    setEditId(null);
    fetchCats();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/settings/expense-categories?id=${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Category deleted"); fetchCats(); }
    else { const err = await res.json().catch(() => ({})); toast.error(err.error || "Failed to delete"); }
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const u = [...cats]; [u[i - 1], u[i]] = [u[i], u[i - 1]]; setCats(u); saveOrder(u);
  }
  function moveDown(i: number) {
    if (i === cats.length - 1) return;
    const u = [...cats]; [u[i], u[i + 1]] = [u[i + 1], u[i]]; setCats(u); saveOrder(u);
  }

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Expense Categories</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure categories for job-linked expenses. Default categories cannot be deleted.
          </p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all">
          <Plus size={16} /> Add Category
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">New Category</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Display Label</label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Signage" />
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Icon (Lucide)</label>
              <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="e.g. Hammer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">BG</label>
              <input type="color" value={newBg} onChange={(e) => setNewBg(e.target.value)} className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Text</label>
              <input type="color" value={newText} onChange={(e) => setNewText(e.target.value)} className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium self-center" style={{ backgroundColor: newBg, color: newText }}>
              {newLabel || "Preview"}
            </span>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleAdd}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90">
              <Check size={14} /> Add
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {cats.map((c, index) => (
          <div key={c.id} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveUp(index)} disabled={index === 0}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed">
                <GripVertical size={14} className="rotate-180" />
              </button>
              <button onClick={() => moveDown(index)} disabled={index === cats.length - 1}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed">
                <GripVertical size={14} />
              </button>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium shrink-0 min-w-[80px] text-center"
              style={{
                backgroundColor: editId === c.id ? editBg : c.bg_color,
                color: editId === c.id ? editText : c.text_color,
              }}>
              {editId === c.id ? editLabel : c.display_label}
            </span>

            {editId === c.id ? (
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-8 text-sm flex-1 min-w-[120px]" />
                <Input value={editIcon} onChange={(e) => setEditIcon(e.target.value)} placeholder="Icon" className="h-8 text-sm w-24" />
                <input type="color" value={editBg} onChange={(e) => setEditBg(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer shrink-0" />
                <input type="color" value={editText} onChange={(e) => setEditText(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer shrink-0" />
                <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 rounded-lg text-primary hover:bg-primary/10"><Check size={16} /></button>
                <button onClick={() => setEditId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent"><X size={16} /></button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground font-medium">{c.display_label}</span>
                  <span className="text-xs text-muted-foreground ml-2">({c.name})</span>
                  {c.icon && <span className="text-xs text-muted-foreground/60 ml-1.5">{c.icon}</span>}
                </div>
                <div className="flex items-center gap-1">
                  {c.is_default && <Lock size={12} className="text-muted-foreground/40 mr-1" />}
                  <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
                    <Pencil size={14} />
                  </button>
                  {!c.is_default && (
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DeleteTemplateConfirmDialog } from "./delete-template-confirm-dialog";
import type { EstimateTemplate } from "@/lib/types";

export default function TemplateListClient() {
  const router = useRouter();
  const [rows, setRows] = useState<EstimateTemplate[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<EstimateTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function load() {
    const res = await fetch(`/api/estimate-templates?_`);
    if (!res.ok) {
      toast.error("Failed to load templates");
      return;
    }
    const data = (await res.json()) as { rows: EstimateTemplate[] };
    setRows(data.rows);
  }
  useEffect(() => { void load(); }, []);

  async function handleNew() {
    const res = await fetch(`/api/estimate-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New template" }),
    });
    if (!res.ok) {
      toast.error("Failed to create template");
      return;
    }
    const tmpl = (await res.json()) as EstimateTemplate;
    router.push(`/settings/estimate-templates/${tmpl.id}/edit`);
  }

  async function handleToggleActive(t: EstimateTemplate, next: boolean) {
    setRows((prev) =>
      prev.map((row) => (row.id === t.id ? { ...row, is_active: next } : row)),
    );
    const res = await fetch(`/api/estimate-templates/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      toast.error("Failed to update");
      void load();
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/estimate-templates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Failed to delete template");
        return;
      }
      setRows((prev) => prev.filter((row) => row.id !== id));
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Estimate Templates</h1>
        <Button onClick={handleNew}>+ New Template</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((t) => (
          <div key={t.id} className={`rounded-lg border border-border p-4 ${t.is_active ? "" : "opacity-60"}`}>
            <label className="inline-flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={t.is_active}
                onChange={(e) => handleToggleActive(t, e.target.checked)}
                className="h-4 w-4 rounded border-border accent-[var(--brand-primary)]"
              />
              <span className="text-xs text-muted-foreground">Active</span>
            </label>
            <h3 className="font-semibold">{t.name}</h3>
            <div className="text-xs text-muted-foreground mt-1">
              {t.damage_type_tags.map((dt) => <span key={dt} className="mr-1 inline-block px-2 py-0.5 rounded bg-blue-100">{dt}</span>)}
            </div>
            <div className="text-sm mt-2 text-muted-foreground">
              {(t.structure?.sections?.length ?? 0)} sections
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Edited {new Date(t.updated_at).toLocaleDateString()}
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <div className="flex gap-2">
                <Link
                  href={`/settings/estimate-templates/${t.id}/edit`}
                  data-slot="button"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Edit
                </Link>
                <Button variant="ghost" size="sm" disabled title="Coming soon">Duplicate</Button>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete template"
                title="Delete template"
                className="hover:text-destructive"
                onClick={() => setDeleteTarget(t)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <div className="text-center text-muted-foreground py-12">
          No templates yet. Click &quot;+ New Template&quot; to create one.
        </div>
      )}
      <DeleteTemplateConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        templateName={deleteTarget?.name ?? ""}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}

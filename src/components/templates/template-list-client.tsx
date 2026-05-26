"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import type { EstimateTemplate } from "@/lib/types";

export default function TemplateListClient() {
  const router = useRouter();
  const [rows, setRows] = useState<EstimateTemplate[]>([]);

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

  async function handleDeactivate(id: string) {
    if (!confirm("Deactivate this template?")) return;
    const res = await fetch(`/api/estimate-templates/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Deactivated"); void load(); }
    else toast.error("Failed");
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
            <div className="mt-3 flex gap-2 text-sm">
              <Link
                href={`/settings/estimate-templates/${t.id}/edit`}
                data-slot="button"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Edit
              </Link>
              <Button variant="ghost" size="sm" disabled title="Coming soon">Duplicate</Button>
              {t.is_active
                ? <Button variant="ghost" size="sm" onClick={() => handleDeactivate(t.id)}>Deactivate</Button>
                : <Button variant="ghost" size="sm" onClick={async () => {
                    await fetch(`/api/estimate-templates/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: true }) });
                    void load();
                  }}>Reactivate</Button>
              }
            </div>
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <div className="text-center text-muted-foreground py-12">
          No templates yet. Click &quot;+ New Template&quot; to create one.
        </div>
      )}
    </div>
  );
}

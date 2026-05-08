// src/app/settings/pdf-presets/preset-list-client.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PdfPreset, DocumentType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

interface Props { initialPresets: PdfPreset[]; }

const TABS: { value: DocumentType; label: string }[] = [
  { value: "estimate", label: "Estimate Presets" },
  { value: "invoice", label: "Invoice Presets" },
];

export default function PresetListClient({ initialPresets }: Props) {
  const [presets, setPresets] = useState<PdfPreset[]>(initialPresets);
  const [tab, setTab] = useState<DocumentType>("estimate");
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_pdf_presets");

  const filtered = presets.filter((p) => p.document_type === tab);

  async function handleNew() {
    const res = await fetch("/api/pdf-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Preset",
        document_type: tab,
        document_title: tab === "estimate" ? "Estimate" : "Invoice",
      }),
    });
    if (!res.ok) {
      toast.error("Could not create preset");
      return;
    }
    const { preset } = (await res.json()) as { preset: PdfPreset };
    router.push(`/settings/pdf-presets/${preset.id}/edit`);
  }

  async function handleDelete(p: PdfPreset) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    const res = await fetch(`/api/pdf-presets/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? "Delete failed");
      return;
    }
    setPresets((prev) => prev.filter((x) => x.id !== p.id));
    toast.success("Preset deleted");
  }

  async function handleSetDefault(p: PdfPreset) {
    const res = await fetch(`/api/pdf-presets/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    if (!res.ok) {
      toast.error("Could not set default");
      return;
    }
    // Local recompute: clear is_default on others of same doc_type, set on this.
    setPresets((prev) =>
      prev.map((x) => {
        if (x.document_type !== p.document_type) return x;
        return { ...x, is_default: x.id === p.id };
      }),
    );
    toast.success("Default updated");
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">PDF Presets</h1>
        {canManage && <Button onClick={handleNew}>+ New Preset</Button>}
      </div>

      <div className="flex gap-2 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 ${
              tab === t.value
                ? "border-b-2 border-primary font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No presets yet for this type.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded border p-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.is_default && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-0.5">{p.document_title}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/settings/pdf-presets/${p.id}/edit`}>
                  <Button variant="outline" size="sm">{canManage ? "Edit" : "View"}</Button>
                </Link>
                {canManage && !p.is_default && (
                  <Button variant="outline" size="sm" onClick={() => handleSetDefault(p)}>
                    Set as default
                  </Button>
                )}
                {canManage && !p.is_default && (
                  <Button variant="outline" size="sm" onClick={() => handleDelete(p)}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

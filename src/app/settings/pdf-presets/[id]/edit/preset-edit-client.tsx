// src/app/settings/pdf-presets/[id]/edit/preset-edit-client.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PdfPreset } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

interface Props { initial: PdfPreset; }

const TOGGLES: { key: keyof PdfPreset; label: string; help?: string }[] = [
  { key: "show_markup", label: "Show markup row in totals" },
  { key: "show_overhead", label: "Show overhead row in totals" },
  { key: "show_profit", label: "Show profit row in totals" },
  { key: "show_discount", label: "Show discount row in totals" },
  { key: "show_tax", label: "Show tax row in totals" },
  { key: "show_opening_statement", label: "Show opening statement" },
  { key: "show_closing_statement", label: "Show closing statement" },
  { key: "show_category_subtotals", label: "Show per-section subtotals", help: "Adds a subtotal row at the end of each section" },
  { key: "show_code_column", label: "Show Code column" },
  { key: "show_item_notes", label: "Show item notes", help: "Renders each line item's note as an italic sub-line under the item" },
];

export default function PresetEditClient({ initial }: Props) {
  const [preset, setPreset] = useState<PdfPreset>(initial);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_pdf_presets");

  function setField<K extends keyof PdfPreset>(key: K, value: PdfPreset[K]) {
    setPreset((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/pdf-presets/${preset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: preset.name,
        document_title: preset.document_title,
        is_default: preset.is_default,
        show_markup: preset.show_markup,
        show_overhead: preset.show_overhead,
        show_profit: preset.show_profit,
        show_discount: preset.show_discount,
        show_tax: preset.show_tax,
        show_opening_statement: preset.show_opening_statement,
        show_closing_statement: preset.show_closing_statement,
        show_category_subtotals: preset.show_category_subtotals,
        show_code_column: preset.show_code_column,
        show_item_notes: preset.show_item_notes,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? "Save failed");
      return;
    }
    toast.success("Saved");
    router.refresh();
  }

  function handlePreview() {
    window.open(`/api/pdf-presets/${preset.id}/preview`, "_blank");
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-4">
        <Link href="/settings/pdf-presets" className="text-sm text-muted-foreground hover:underline">
          ← Back to PDF Presets
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-6">{canManage ? "Edit Preset" : "View Preset"}</h1>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Preset Name</Label>
          <Input
            id="name"
            value={preset.name}
            onChange={(e) => setField("name", e.target.value)}
            maxLength={200}
            disabled={!canManage}
          />
        </div>
        <div>
          <Label htmlFor="document_title">Document Title (large header text on PDF)</Label>
          <Input
            id="document_title"
            value={preset.document_title}
            onChange={(e) => setField("document_title", e.target.value)}
            maxLength={200}
            disabled={!canManage}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="is_default"
            checked={preset.is_default}
            onCheckedChange={(v) => setField("is_default", v)}
            disabled={!canManage}
          />
          <Label htmlFor="is_default" className="cursor-pointer">
            Set as default {preset.document_type} preset
          </Label>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-medium mb-3">Display options</h2>
        <div className="space-y-3">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-start gap-3">
              <Switch
                id={t.key as string}
                checked={Boolean(preset[t.key])}
                onCheckedChange={(v) => setField(t.key, v as PdfPreset[typeof t.key])}
                disabled={!canManage}
              />
              <div>
                <Label htmlFor={t.key as string} className="cursor-pointer">{t.label}</Label>
                {t.help && <p className="text-xs text-muted-foreground mt-0.5">{t.help}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        {canManage && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
        <Button variant="outline" onClick={handlePreview}>
          Preview sample PDF
        </Button>
      </div>
    </div>
  );
}

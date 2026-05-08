"use client";

import { useEffect, useState } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from "@/components/ui/combobox";
import { toast } from "sonner";

interface Template {
  id: string;
  name: string;
  damage_type_tags: string[];
  // structure fields excluded from list view
  structure_section_count?: number;
}

export interface TemplateBannerProps {
  estimateId: string;
  jobDamageType: string | null;
  onApplied: (result: {
    section_count: number;
    line_item_count: number;
    broken_refs: Array<{
      section_idx: number;
      item_idx: number;
      library_item_id: string | null;
      placeholder: boolean;
    }>;
  }) => void;
}

export default function TemplateBanner({
  estimateId,
  jobDamageType,
  onApplied,
}: TemplateBannerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/estimate-templates?is_active=true`);
      if (!res.ok) return;
      const data = (await res.json()) as { rows: Template[] };
      // Pin damage-type-matching templates to top
      const pinned: Template[] = [];
      const rest: Template[] = [];
      for (const t of data.rows) {
        if (
          jobDamageType &&
          Array.isArray(t.damage_type_tags) &&
          t.damage_type_tags.includes(jobDamageType)
        ) {
          pinned.push(t);
        } else {
          rest.push(t);
        }
      }
      setTemplates([...pinned, ...rest]);
    })();
  }, [jobDamageType]);

  async function handleApply(templateId: string) {
    setApplying(true);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to apply template");
        return;
      }
      const result = await res.json();
      // Set localStorage flag — banner stays hidden even if subsequent apply
      // results in zero sections (statements-only template).
      localStorage.setItem(`nookleus.template-applied.${estimateId}`, "1");
      toast.success(
        `Template applied — ${result.section_count} sections, ${result.line_item_count} items added.`
      );
      onApplied(result);
    } finally {
      setApplying(false);
    }
  }

  if (templates.length === 0) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 mb-4 flex items-center gap-3">
      <span className="text-sm">
        📋 <strong>Start from a template?</strong>
      </span>
      <Combobox<Template>
        items={templates}
        itemToStringLabel={(t) => t.name}
        value={templates.find((t) => t.id === selected) ?? null}
        onValueChange={(t) => {
          const id = t?.id ?? null;
          setSelected(id);
          if (id) void handleApply(id);
        }}
        disabled={applying}
      >
        <ComboboxInput placeholder="Search templates…" disabled={applying} />
        <ComboboxContent>
          <ComboboxList>
            {templates.map((t) => (
              <ComboboxItem key={t.id} value={t}>
                {t.name}
                {t.damage_type_tags.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({t.damage_type_tags.join(", ")})
                  </span>
                )}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <span className="text-xs text-muted-foreground">
        or click &quot;+ New Section&quot; to start blank.
      </span>
    </div>
  );
}

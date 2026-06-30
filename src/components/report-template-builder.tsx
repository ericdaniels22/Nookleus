"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { resolvePhotoAuthor } from "@/lib/jobs/resolve-photo-author";
import { PhotoReportTemplate } from "@/lib/types";
import { Input } from "@/components/ui/input";
import TiptapEditor from "@/components/tiptap-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";

// Issue #405 — Photo Report Rework: Photo Report templates upgraded + moved to
// Settings. A template is now just a name and an ordered list of Sections; each
// Section carries a heading plus boilerplate write-up text authored in the same
// TipTap editor a report Section uses (the boilerplate is stored as rich-text
// HTML in `description` and seeds a new report — see `buildInitialSections`).
//
// The pre-rework audience / cover-page / photos-per-page knobs are gone from the
// editor: they are dead at render time in the one-layout model (ADR 0009 / ADR
// 0003 amendment), so they are no longer written. The matching DB columns keep
// their defaults — dropping them is a separate cleanup migration.

interface TemplateSection {
  title: string;
  /** Boilerplate write-up as rich-text HTML (paragraphs + bullet lists). */
  description: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editTemplate?: PhotoReportTemplate | null;
}

export default function ReportTemplateBuilder({
  open,
  onOpenChange,
  onSaved,
  editTemplate,
}: Props) {
  const isEditing = !!editTemplate;

  const [name, setName] = useState(editTemplate?.name ?? "");
  const [sections, setSections] = useState<TemplateSection[]>(
    (editTemplate?.sections as TemplateSection[]) ?? [
      { title: "", description: "" },
    ],
  );
  const [saving, setSaving] = useState(false);

  function addSection() {
    setSections([...sections, { title: "", description: "" }]);
  }

  function removeSection(index: number) {
    setSections(sections.filter((_, i) => i !== index));
  }

  function updateSection(
    index: number,
    field: keyof TemplateSection,
    value: string,
  ) {
    const updated = [...sections];
    updated[index] = { ...updated[index], [field]: value };
    setSections(updated);
  }

  function moveSection(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sections.length) return;
    const updated = [...sections];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setSections(updated);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }

    const validSections = sections
      .filter((s) => s.title.trim())
      .map((s) => ({ title: s.title.trim(), description: s.description }));
    if (validSections.length === 0) {
      toast.error("Add at least one Section with a heading");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      sections: validSections,
    };

    let error;
    if (isEditing) {
      ({ error } = await supabase
        .from("photo_report_templates")
        .update(payload)
        .eq("id", editTemplate.id)
        .eq("organization_id", await getActiveOrganizationId(supabase)));
    } else {
      // Stamp the creating user the same way the photo-upload and annotator
      // surfaces do (#832, shared with #808). Resolved only on the insert: the
      // edit branch above sends `payload` alone, so editing never rewrites the
      // original author.
      ({ error } = await supabase.from("photo_report_templates").insert({
        ...payload,
        created_by: await resolvePhotoAuthor(supabase),
        organization_id: await getActiveOrganizationId(supabase),
      }));
    }

    if (error) {
      toast.error("Failed to save template");
      console.error(error);
    } else {
      toast.success(isEditing ? "Template updated" : "Template created");
      onSaved();
      onOpenChange(false);
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? "Edit Photo Report Template"
              : "Create Photo Report Template"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Template name */}
          <div>
            <label className="block text-xs font-medium text-[#666666] mb-1">
              Template Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Findings"
            />
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[#666666]">
                Sections ({sections.length})
              </label>
              <button
                type="button"
                onClick={addSection}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#2B5EA7] hover:text-[#1d4a8a] transition-colors"
              >
                <Plus size={14} />
                Add Section
              </button>
            </div>

            <div className="space-y-3">
              {sections.map((section, i) => (
                <div
                  key={i}
                  className="border border-gray-200 rounded-lg p-3 bg-gray-50/50"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5 pt-1">
                      <button
                        type="button"
                        onClick={() => moveSection(i, "up")}
                        disabled={i === 0}
                        className="text-[#999999] hover:text-[#1A1A1A] disabled:opacity-30 transition-colors"
                        aria-label="Move section up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSection(i, "down")}
                        disabled={i === sections.length - 1}
                        className="text-[#999999] hover:text-[#1A1A1A] disabled:opacity-30 transition-colors"
                        aria-label="Move section down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={section.title}
                        onChange={(e) =>
                          updateSection(i, "title", e.target.value)
                        }
                        placeholder="Section heading"
                        className="text-sm font-medium"
                      />
                      {/* Boilerplate write-up — the same rich-text editor a report
                          Section uses; its HTML seeds the new report's Section. */}
                      <TiptapEditor
                        content={section.description}
                        onChange={(html) =>
                          updateSection(i, "description", html)
                        }
                        placeholder="Boilerplate write-up — pre-filled into new reports (optional)"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSection(i)}
                      disabled={sections.length <= 1}
                      className="p-1.5 text-[#999999] hover:text-[#C41E2A] disabled:opacity-30 transition-colors"
                      aria-label="Remove section"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-[#666666] hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[#2B5EA7] text-white hover:bg-[#244d8a] disabled:opacity-50 transition-colors"
          >
            {saving
              ? "Saving..."
              : isEditing
                ? "Update Template"
                : "Create Template"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

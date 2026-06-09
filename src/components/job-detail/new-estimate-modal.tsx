"use client";

// New Estimate modal (#571). Replaces the create-and-redirect page: the
// estimator names the Estimate and picks a template (or none) BEFORE the
// document exists; one submit creates the draft, applies the template, and
// the parent navigates into the populated builder.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { pinTemplatesByDamageType } from "@/lib/pin-templates-by-damage-type";

interface TemplateRow {
  id: string;
  name: string;
  damage_type_tags: string[];
}

export interface NewEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobDamageType: string | null;
  /** Invoked with the new estimate's id — parent navigates to the builder. */
  onCreated: (estimateId: string) => void;
}

export function NewEstimateModal({
  open,
  onOpenChange,
  jobId,
  jobDamageType,
  onCreated,
}: NewEstimateModalProps) {
  const [title, setTitle] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each open re-seeds the form: the org's standard title into the name
  // field (editable), and the active template list for the picker.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/estimates/default-title");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { title: string };
      if (!cancelled) setTitle(data.title);
    })();
    void (async () => {
      const res = await fetch("/api/estimate-templates?is_active=true");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { rows: TemplateRow[] };
      if (!cancelled) {
        setTemplates(pinTemplatesByDamageType(data.rows, jobDamageType));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, jobDamageType]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/estimates/create-with-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          title: title.trim(),
          template_id: templateId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not create estimate");
        return;
      }
      const { id } = (await res.json()) as { id: string };
      onCreated(id);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Estimate</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Estimate name</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Template</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Estimate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

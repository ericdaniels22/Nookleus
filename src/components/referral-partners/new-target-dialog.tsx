"use client";

// New Target dialog (PRD #249, issue #250). A minimal 5-field create form
// for batch-adding cold-call targets off Google, Yelp, BBB. Every Target
// lands in `grey` Lifecycle status — the API pins that, the dialog does
// not negotiate. The Worksheet is where lifecycle progresses.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { isValidNewTarget } from "@/lib/referral-partner-form";

interface NewTargetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Invoked after a successful create — parent re-fetches the list. */
  onCreated?: () => void;
}

export default function NewTargetDialog({
  open,
  onOpenChange,
  onCreated,
}: NewTargetDialogProps) {
  const [companyName, setCompanyName] = useState("");
  const [officePhone, setOfficePhone] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [industry, setIndustry] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCompanyName("");
    setOfficePhone("");
    setLeadSource("");
    setIndustry("");
    setNotes("");
    setError(null);
  }

  const input = {
    company_name: companyName,
    office_phone: officePhone,
    lead_source: leadSource,
    industry,
    notes,
  };
  const canSubmit = !submitting && isValidNewTarget(input);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/referral-partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save target");
        return;
      }
      reset();
      onCreated?.();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new Target</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Company name *</span>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Office phone</span>
            <input
              type="text"
              value={officePhone}
              onChange={(e) => setOfficePhone(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Lead source</span>
            <input
              type="text"
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value)}
              placeholder="Google, Yelp, Thumbtack, website…"
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Industry</span>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn btn-primary"
            >
              {submitting ? "Adding…" : "Add Target"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

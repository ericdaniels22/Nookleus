"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

interface PdfPreset {
  id: string;
  name: string;
  document_type: "estimate" | "invoice";
  is_default: boolean;
}

interface PreviewResponse {
  from_unconfigured: boolean;
  subject?: string;
  body_text?: string;
  unresolvedFields?: string[];
}

export type SendModalProps =
  | {
      open: boolean;
      onOpenChange: (o: boolean) => void;
      mode: "estimate";
      documentId: string;
      jobId: string;
      onSent?: () => void;
    }
  | {
      open: boolean;
      onOpenChange: (o: boolean) => void;
      mode: "invoice";
      documentId: string;
      jobId: string;
      onSent?: () => void;
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendModal(props: SendModalProps) {
  const { open, onOpenChange, mode, documentId, jobId, onSent } = props;

  const [loading, setLoading] = useState(true);
  const [fromUnconfigured, setFromUnconfigured] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [unresolvedFields, setUnresolvedFields] = useState<string[]>([]);
  const [presets, setPresets] = useState<PdfPreset[]>([]);
  const [presetId, setPresetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setFromUnconfigured(false);
    setTo("");
    setSubject("");
    setBodyText("");
    setUnresolvedFields([]);
    setPresets([]);
    setPresetId("");

    Promise.all([
      fetch(`/api/${mode === "estimate" ? "estimates" : "invoices"}/${documentId}/send/preview`).then(
        (r) => (r.ok ? r.json() : { from_unconfigured: false }),
      ) as Promise<PreviewResponse>,
      fetch(`/api/jobs/${jobId}/contact-email`).then(
        (r) => (r.ok ? r.json() : { email: null, name: null }),
      ) as Promise<{ email: string | null; name: string | null }>,
      fetch(`/api/pdf-presets?document_type=${mode}`).then(
        (r) => (r.ok ? r.json() : { presets: [] }),
      ) as Promise<{ presets: PdfPreset[] }>,
    ]).then(([preview, contact, presetsResp]) => {
      if (cancelled) return;
      if (preview.from_unconfigured) {
        setFromUnconfigured(true);
      } else {
        setSubject(preview.subject ?? "");
        setBodyText(preview.body_text ?? "");
        setUnresolvedFields(preview.unresolvedFields ?? []);
      }
      setTo(contact.email ?? "");
      const list = presetsResp.presets ?? [];
      setPresets(list);
      const def = list.find((p) => p.is_default);
      setPresetId(def?.id ?? list[0]?.id ?? "");
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, mode, documentId, jobId]);

  async function onSubmit() {
    const trimmedTo = to.trim();
    if (!EMAIL_RE.test(trimmedTo)) {
      toast.error("Enter a valid recipient email");
      return;
    }
    if (!subject.trim()) {
      toast.error("Subject required");
      return;
    }
    if (!bodyText.trim()) {
      toast.error("Body required");
      return;
    }
    if (!presetId) {
      toast.error("Select a PDF preset");
      return;
    }

    setSubmitting(true);
    const url = `/api/${mode === "estimate" ? "estimates" : "invoices"}/${documentId}/send`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: trimmedTo, subject, body: bodyText, preset_id: presetId }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error || `Send failed (${res.status})`);
      return;
    }
    toast.success(`Sent to ${trimmedTo}`);
    onOpenChange(false);
    onSent?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Send {mode === "estimate" ? "Estimate" : "Invoice"}
          </DialogTitle>
          <DialogDescription>
            The PDF is generated and attached using the selected preset.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : fromUnconfigured ? (
          <div className="py-6 space-y-3">
            <p className="text-sm">
              Configure your sending email first.
            </p>
            <Link
              href="/settings/payments"
              className="text-sm font-medium text-[var(--brand-primary)] hover:underline"
              onClick={() => onOpenChange(false)}
            >
              Open Outgoing Emails settings →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="send-to">To</Label>
              <Input
                id="send-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
              />
            </div>
            <div>
              <Label htmlFor="send-subject">Subject</Label>
              <Input
                id="send-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="send-body">Body</Label>
              <Textarea
                id="send-body"
                rows={10}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="send-preset">PDF Preset</Label>
              <Select value={presetId} onValueChange={(v) => setPresetId(v ?? "")}>
                <SelectTrigger id="send-preset">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {unresolvedFields.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-900">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  Unresolved merge fields:{" "}
                  {unresolvedFields.map((f) => `{${f}}`).join(", ")}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          {!loading && !fromUnconfigured && (
            <Button onClick={onSubmit} disabled={submitting}>
              {submitting ? "Sending…" : "Send"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

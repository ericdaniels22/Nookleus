"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TiptapEditor from "@/components/tiptap-editor";
import PreviewContractModal from "./preview-contract-modal";
import { Loader2, Send, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ContractTemplateListItem, ContractEmailSettings } from "@/lib/contracts/types";

interface SignerRow {
  name: string;
  email: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  defaultSignerName: string | null;
  defaultSignerEmail: string | null;
  onSent: () => void | Promise<void>;
}

export default function SendContractModal({
  open,
  onOpenChange,
  jobId,
  defaultSignerName,
  defaultSignerEmail,
  onSent,
}: Props) {
  const [templates, setTemplates] = useState<ContractTemplateListItem[] | null>(null);
  const [settings, setSettings] = useState<ContractEmailSettings | null>(null);
  const [templateId, setTemplateId] = useState<string>("");
  const [signers, setSigners] = useState<SignerRow[]>([
    { name: defaultSignerName ?? "", email: defaultSignerEmail ?? "" },
  ]);
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // Mirrors the server-side guard at /api/contracts/send/route.ts: the body
  // must contain the signing-link merge field or the recipient's email goes
  // out with no way to sign.
  const bodyHasSigningLink =
    emailBody.includes("{{signing_link}}") ||
    /data-field-name=["']signing_link["']/i.test(emailBody);

  // Reset form whenever the modal reopens.
  useEffect(() => {
    if (!open) return;
    setSigners([{ name: defaultSignerName ?? "", email: defaultSignerEmail ?? "" }]);
  }, [open, defaultSignerName, defaultSignerEmail]);

  function updateSigner(idx: number, patch: Partial<SignerRow>) {
    setSigners((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function addSigner() {
    setSigners((prev) => (prev.length < 2 ? [...prev, { name: "", email: "" }] : prev));
  }
  function removeSigner(idx: number) {
    setSigners((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  const load = useCallback(async () => {
    const [tRes, sRes] = await Promise.all([
      fetch("/api/settings/contract-templates"),
      fetch("/api/settings/contract-email"),
    ]);
    if (tRes.ok) {
      const data = (await tRes.json()) as ContractTemplateListItem[];
      const active = data.filter((t) => t.is_active);
      setTemplates(active);
      if (active.length && !templateId) setTemplateId(active[0].id);
    }
    if (sRes.ok) {
      const data = (await sRes.json()) as ContractEmailSettings;
      setSettings(data);
      setExpiryDays(data.default_link_expiry_days);
      setEmailSubject(data.signing_request_subject_template);
      setEmailBody(data.signing_request_body_template);
    }
  }, [templateId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const setupIncomplete = !!settings && (!settings.send_from_email || !settings.send_from_name);

  function doPreview() {
    if (!templateId) return;
    setPreviewOpen(true);
  }

  async function doSend() {
    if (!templateId) {
      toast.error("Pick a template first");
      return;
    }
    for (const s of signers) {
      if (!s.name.trim() || !s.email.trim()) {
        toast.error("Every signer needs a name and email");
        return;
      }
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast.error("Email subject and body are required");
      return;
    }
    if (!bodyHasSigningLink) {
      toast.error("Email body must contain the {{signing_link}} placeholder");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/contracts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          templateId,
          signers: signers.map((s) => ({ name: s.name.trim(), email: s.email.trim() })),
          expiryDays,
          emailSubject,
          emailBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      toast.success("Contract sent for signature");
      await onSent();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-2rem,56rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send size={18} className="text-[var(--brand-primary)]" />
            Send for Signature
          </DialogTitle>
        </DialogHeader>

        {setupIncomplete && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            Contract email settings are incomplete — set a send-from address in Settings → Contracts first.
          </div>
        )}

        <div className="space-y-4">
          {/* Template */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Template</label>
            {templates === null ? (
              <div className="text-xs text-muted-foreground mt-1">
                <Loader2 size={12} className="inline animate-spin mr-1" /> Loading…
              </div>
            ) : templates.length === 0 ? (
              <div className="mt-1 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-center gap-2">
                <FileText size={14} /> No active templates. Create one in Settings → Contract Templates first.
              </div>
            ) : (
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Signers */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted-foreground">
                Signer{signers.length > 1 ? "s" : ""}
              </label>
              {signers.length < 2 && (
                <button
                  type="button"
                  onClick={addSigner}
                  className="text-[11px] text-[var(--brand-primary)] hover:underline inline-flex items-center gap-1"
                >
                  <Plus size={11} /> Add signer
                </button>
              )}
            </div>
            <div className="space-y-2">
              {signers.map((s, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center"
                >
                  <input
                    type="text"
                    placeholder={`Signer ${idx + 1} full name`}
                    value={s.name}
                    onChange={(e) => updateSigner(idx, { name: e.target.value })}
                    className="min-w-0 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={s.email}
                    onChange={(e) => updateSigner(idx, { email: e.target.value })}
                    className="min-w-0 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
                  />
                  {signers.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeSigner(idx)}
                      className="justify-self-end sm:justify-self-auto rounded-lg px-2 py-2 text-muted-foreground hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      aria-label={`Remove signer ${idx + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                </div>
              ))}
            </div>
            {signers.length > 1 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                The second signer receives their link after the first signs.
              </p>
            )}
          </div>

          {/* Expiry */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Link expiration (days)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={expiryDays}
              onChange={(e) => setExpiryDays(Math.max(1, Math.min(30, Number(e.target.value))))}
              className="mt-1 w-28 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>

          {/* Email subject + body */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Email body</label>
            <div className="mt-1">
              <TiptapEditor
                content={emailBody}
                onChange={setEmailBody}
                placeholder="Email body shown to the signer"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {`{{signing_link}}`} and {`{{document_title}}`} resolve automatically when sent.
            </p>
            {emailBody.trim() && !bodyHasSigningLink && (
              <p className="text-[11px] text-red-600 mt-1">
                Body is missing {`{{signing_link}}`} — the recipient won&apos;t have a way to sign. Add it back before sending.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={doPreview}
            disabled={!templateId}
            className="order-2 sm:order-1 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-foreground bg-muted/40 hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            <FileText size={14} />
            Preview Contract
          </button>
          <div className="order-1 sm:order-2 flex gap-2 ml-auto">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doSend}
              disabled={sending || setupIncomplete || !templateId || !bodyHasSigningLink}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all disabled:opacity-60"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send
            </button>
          </div>
        </div>

        <PreviewContractModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          templateId={templateId || null}
          title={templates?.find((t) => t.id === templateId)?.name ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

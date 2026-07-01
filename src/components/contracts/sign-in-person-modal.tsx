"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PreviewContractModal from "./preview-contract-modal";
import { Loader2, Users, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ContractTemplateListItem } from "@/lib/contracts/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  defaultSignerName: string | null;
  defaultSignerEmail: string | null;
}

interface SignerRow {
  name: string;
  email: string;
}

// Setup modal for the Sign In Person (tablet) flow. Structurally mirrors
// SendContractModal minus the email composition — when the user clicks
// Start Signing we POST the draft to /api/contracts/in-person/start and
// redirect them straight to the full-screen tablet signing view.
export default function SignInPersonModal({
  open,
  onOpenChange,
  jobId,
  defaultSignerName,
  defaultSignerEmail,
}: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ContractTemplateListItem[] | null>(null);
  const [templateId, setTemplateId] = useState<string>("");
  const [signers, setSigners] = useState<SignerRow[]>([{ name: "", email: "" }]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSigners([{ name: defaultSignerName ?? "", email: defaultSignerEmail ?? "" }]);
  }, [open, defaultSignerName, defaultSignerEmail]);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/contract-templates");
    if (res.ok) {
      const data = (await res.json()) as ContractTemplateListItem[];
      const active = data.filter((t) => t.is_active);
      setTemplates(active);
      if (active.length && !templateId) setTemplateId(active[0].id);
    }
  }, [templateId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function updateSigner(idx: number, patch: Partial<SignerRow>) {
    setSigners((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function addSigner() {
    setSigners((prev) => (prev.length < 2 ? [...prev, { name: "", email: "" }] : prev));
  }

  function removeSigner(idx: number) {
    setSigners((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  function doPreview() {
    if (!templateId) return;
    setPreviewOpen(true);
  }

  async function startSigning() {
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
    setStarting(true);
    try {
      const res = await fetch("/api/contracts/in-person/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          templateId,
          signers: signers.map((s) => ({ name: s.name.trim(), email: s.email.trim() })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to start signing");
      router.push(`/contracts/${data.contractId}/sign-in-person`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to start signing");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-2rem,42rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={18} className="text-[var(--brand-primary)]" />
            Sign In Person
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted-foreground">Signers</label>
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
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
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
            <p className="text-[11px] text-muted-foreground mt-2">
              Email is used for the signed-confirmation copy. No signing link will be sent for in-person signing.
            </p>
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
              onClick={startSigning}
              disabled={starting || !templateId}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {starting ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Start Signing
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

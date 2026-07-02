"use client";

import { useState } from "react";
import { Send, X } from "lucide-react";

// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page Text compose.
//
// Opened by the Job-page Text button with one of the Job's Contacts
// pre-filled. Sending posts to /api/phone/messages with
// sourceContext: { kind: 'job', jobId }, so smart-attach auto-tags the
// outbound to this Job. There is deliberately NO tagging-chip prompt here
// — on the Job page the tag is definite.

export interface ComposeContact {
  id: string;
  name: string;
  phone: string | null;
}

export function ComposeTextModal({
  open,
  onClose,
  jobId,
  contacts,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  contacts: ComposeContact[];
  onSent?: () => void;
}) {
  const [selectedId, setSelectedId] = useState(contacts[0]?.id ?? "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const selected = contacts.find((c) => c.id === selectedId) ?? contacts[0];

  async function handleSend() {
    if (sending || body.trim().length === 0 || !selected?.phone) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/phone/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        outsideE164: selected.phone,
        body,
        // Smart-attach Job branch — the outbound is auto-tagged to this
        // Job, no chip prompt. See decideJobTag().
        sourceContext: { kind: "job", jobId },
      }),
    });
    setSending(false);
    if (!res.ok) {
      setError("Could not send the text. Please try again.");
      return;
    }
    setBody("");
    onSent?.();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Text a contact"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Text</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          To
        </label>
        {contacts.length > 1 ? (
          <select
            aria-label="Recipient"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="mb-3 text-sm text-foreground">{selected?.name}</div>
        )}

        <textarea
          aria-label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Type a message…"
          className="mb-3 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {error ? (
          <p className="mb-3 text-xs text-destructive">{error}</p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || body.trim().length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:min-h-0"
          >
            <Send size={14} />
            Send Text
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Phone, X } from "lucide-react";

// PRD #304 — Nookleus Phone. Slice 10 (#314) — Job-page Call compose.
//
// Opened by the Job-page Call button with one of the Job's Contacts
// pre-selected. Placing the call POSTs to /api/phone/calls with
// sourceContext: { kind: 'job', jobId }, so smart-attach auto-tags the
// outbound call to this Job — no tagging-chip prompt; on the Job page the
// tag is definite. Mirrors ComposeTextModal, minus the message body (a call
// needs only a recipient). NOT gated on A2P 10DLC — voice has no 10DLC
// dependency.

export interface ComposeCallContact {
  id: string;
  name: string;
  phone: string | null;
}

export function ComposeCallModal({
  open,
  onClose,
  jobId,
  contacts,
  onPlaced,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  contacts: ComposeCallContact[];
  onPlaced?: () => void;
}) {
  const [selectedId, setSelectedId] = useState(contacts[0]?.id ?? "");
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const selected = contacts.find((c) => c.id === selectedId) ?? contacts[0];

  async function handleCall() {
    if (calling || !selected?.phone) return;
    setCalling(true);
    setError(null);
    const res = await fetch("/api/phone/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        outsideE164: selected.phone,
        // Smart-attach Job branch — the call is auto-tagged to this Job.
        sourceContext: { kind: "job", jobId },
      }),
    });
    setCalling(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not place the call. Please try again.");
      return;
    }
    onPlaced?.();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Call a contact"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Call</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
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
            className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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

        <p className="mb-3 text-xs text-muted-foreground">
          Your own phone will ring first; answer to connect to the customer.
          They&apos;ll see the Nookleus number, not your cell.
        </p>

        {error ? (
          <p className="mb-3 text-xs text-destructive">{error}</p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCall}
            disabled={calling || !selected?.phone}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Phone size={14} />
            {calling ? "Calling…" : "Call"}
          </button>
        </div>
      </div>
    </div>
  );
}

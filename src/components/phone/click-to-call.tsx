"use client";

import { useState } from "react";
import { Phone } from "lucide-react";

// PRD #304 — Nookleus Phone. Slice 10 (#314) — generic click-to-call.
//
// The one-line affordance any surface that renders a phone number wires up
// to place an outbound bridge call. Clicking POSTs to /api/phone/calls —
// the route rings the Crew Lead's own cell (from their profile) and bridges
// to the customer, presenting the Nookleus number as caller ID. Because the
// call rings the *user's* phone (not the page), the only visible feedback
// here is a short status line; the actual conversation happens on their cell.
//
// Unlike `ClickToText`, this is NOT gated on the A2P 10DLC flag: voice
// carries no 10DLC dependency, so Call is live wherever `view_phone` is.
//
// `sourceContext` drives smart-attach: pass `{ kind: 'job', jobId }` from a
// Job surface to auto-tag the call to that Job; the default `{ kind:
// 'contact' }` leaves it untagged (re-tag after the fact).

interface ClickToCallProps {
  e164: string | null | undefined;
  // Smart-attach source. Defaults to a Contact-card call (untagged).
  sourceContext?: unknown;
  // Visible label. Defaults to "Call".
  label?: string;
  className?: string;
}

export function ClickToCall({
  e164,
  sourceContext = { kind: "contact" },
  label = "Call",
  className,
}: ClickToCallProps) {
  const [calling, setCalling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!e164) return null;

  async function place() {
    if (calling) return;
    setCalling(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch("/api/phone/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outsideE164: e164, sourceContext }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Call failed (${res.status})`);
        return;
      }
      setStatus("Ringing your phone — answer to connect.");
    } catch {
      setError("Could not place the call. Please try again.");
    } finally {
      setCalling(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void place()}
        disabled={calling}
        className={
          className ??
          "inline-flex items-center gap-1 text-[var(--brand-primary)] hover:underline disabled:opacity-50"
        }
      >
        <Phone size={12} aria-hidden /> {calling ? "Calling…" : label}
      </button>
      {status ? (
        <span role="status" className="text-xs text-muted-foreground">
          {status}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </span>
  );
}

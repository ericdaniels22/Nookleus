// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Click-to-text: a Next.js <Link> to /phone?to=<E.164>. The Phone page
// reads the `to` query param on first render and opens the New
// Conversation form pre-filled. Centralized here so any surface that
// renders a phone number can wire up click-to-text in one line.
//
// Slice 5 wires this into the Contact card (which serves the Adjuster
// case via the `role === 'adjuster'` rows). Slice 7 adds the Job page
// Text button — that one auto-tags to the Job, so it doesn't go through
// this generic component.

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { isPhoneOutboundEnabled } from "@/lib/phone/feature-flags";

interface ClickToTextProps {
  e164: string | null | undefined;
  // Visible label when no children are provided. Defaults to "Text".
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ClickToText({
  e164,
  label = "Text",
  className,
  children,
}: ClickToTextProps) {
  if (!e164) return null;
  // #309 is gated on #305 (A2P 10DLC). When outbound is off, the
  // destination compose flow is hidden, so the click-to-text button is
  // dead-end UX. Render nothing instead.
  if (!isPhoneOutboundEnabled()) return null;
  const href = `/phone?to=${encodeURIComponent(e164)}`;
  return (
    <Link
      href={href}
      className={
        className ??
        "inline-flex items-center gap-1 text-accent-text hover:underline"
      }
    >
      {children ?? (
        <>
          <MessageSquare size={12} aria-hidden /> {label}
        </>
      )}
    </Link>
  );
}
